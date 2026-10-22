#!/usr/bin/env python3
"""Outbound-only authenticated live relay for fixed, public-site questions."""
import json
import multiprocessing as mp
import os
import re
import signal
import sys
import time
import urllib.request

import websocket  # Debian/Ubuntu package: python3-websocket
import daily_ai as ai


def stream_child(pipe, origin, model, prompt):
    try:
        options = ai.inference_options()
        options['num_predict'] = 2048
        body = {'model': model, 'stream': True, 'think': True, 'keep_alive': '2m',
                'messages': [{'role': 'system', 'content': ai.SYSTEM}, {'role': 'user', 'content': prompt}],
                'options': options}
        request = urllib.request.Request(origin + '/api/chat', data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json'})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), ai.NoRedirect())
        total = 0
        with opener.open(request, timeout=600) as response:
            while True:
                line = response.readline(8193)
                if not line:
                    raise RuntimeError('Ollama ended without completion')
                total += len(line)
                if len(line) > 8192 or total > 4 * 1024 * 1024:
                    raise ValueError('Ollama stream exceeded its bounds')
                data = json.loads(line)
                if data.get('error'):
                    raise RuntimeError('Ollama reported an error')
                for field, channel in [('thinking', 'thinking'), ('content', 'answer')]:
                    text = data.get('message', {}).get(field, '')
                    if text:
                        if not isinstance(text, str) or len(text) > 4096:
                            raise ValueError('Invalid stream delta')
                        pipe.send({'type': 'delta', 'channel': channel, 'text': text})
                if data.get('done'):
                    pipe.send({'type': 'done'})
                    break
    except Exception as error:
        pipe.send({'type': 'error', 'error': type(error).__name__})
    finally:
        pipe.close()


def valid_job(job):
    return (isinstance(job, dict) and job.get('type') == 'generate' and job.get('id') in ai.QUESTIONS
            and isinstance(job.get('job'), str) and re.fullmatch(r'[a-f0-9-]{36}', job['job'])
            and type(job.get('revision')) is int and job['revision'] >= 0
            and isinstance(job.get('day'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', job['day']))


def unload(origin, model):
    try:
        ai.http_json(origin + '/api/generate', {'model': model, 'keep_alive': 0}, timeout=30)
    except Exception:
        print('Could not confirm Ollama unload.', file=sys.stderr, flush=True)


def execute(ws, job, site, token, origin, model):
    control_url = site + '/api/internal/daily-ai'
    control = lambda: ai.http_json(control_url, token=token, timeout=10, maximum=4096)
    process = None
    parent = None
    try:
        lease = control()
        if not lease.get('enabled') or lease.get('day') != job['day'] or lease.get('revision') != job['revision']:
            raise RuntimeError('Disabled or expired job')
        context = ai.http_json(site + '/daily-ai-context.json')
        if context.get('version') != 1 or not isinstance(context.get('pages'), dict):
            raise ValueError('Invalid public context')
        metrics = {}
        if job['id'] == 'homelab':
            for path in ['/api/homelab', '/api/tokens']:
                try:
                    metrics[path] = ai.public_metrics(path, ai.http_json(site + path, timeout=15, maximum=128 * 1024))
                except Exception:
                    metrics[path] = {'unavailable': True}
        prompt, sources = ai.prompt_for(job['id'], context, job['day'], metrics)
        ctx = mp.get_context('spawn')
        parent, child = ctx.Pipe(duplex=False)
        process = ctx.Process(target=stream_child, args=(child, origin, model, prompt))
        process.start()
        child.close()
        started = last_control = last_ping = time.monotonic()
        completed = False
        while not completed:
            now = time.monotonic()
            if now - started > 580:
                raise RuntimeError('Inference deadline')
            if now - last_control > 3:
                current = control()
                if not current.get('enabled') or current.get('revision') != lease['revision'] or current.get('day') != job['day']:
                    raise RuntimeError('Generation lease changed')
                last_control = time.monotonic()
            if now - last_ping > 20:
                ws.send('{"type":"ping"}')
                last_ping = now
            # Keep the receive loop live while Ollama works, so admin reset and
            # the kill switch can interrupt a blocked local inference request.
            try:
                incoming = ws.recv()
                if not incoming:
                    raise RuntimeError('Relay disconnected')
                command = json.loads(incoming)
                if command.get('type') == 'cancel' and command.get('job') == job['job']:
                    raise RuntimeError('Generation cancelled')
            except websocket.WebSocketTimeoutException:
                pass
            while parent.poll():
                event = parent.recv()
                event['job'] = job['job']
                if event['type'] == 'error':
                    raise RuntimeError('Inference failed')
                if event['type'] == 'done':
                    event['sources'] = sources
                    completed = True
                ws.send(json.dumps(event, ensure_ascii=False))
                if completed:
                    break
            if not process.is_alive() and not completed and not parent.poll():
                raise RuntimeError('Inference process stopped')
    except Exception as error:
        print('Live generation stopped: ' + type(error).__name__, file=sys.stderr, flush=True)
        try:
            ws.send(json.dumps({'type': 'error', 'job': job['job']}))
        except Exception:
            pass
    finally:
        if process:
            if process.is_alive():
                process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()
                process.join()
        if parent:
            parent.close()
        unload(origin, model)


def run():
    site = os.environ.get('DAILY_AI_SITE', 'https://leodeng.dev').rstrip('/')
    if site != 'https://leodeng.dev':
        raise ValueError('Expected the configured public site origin')
    origin = ai.ollama_base(os.environ.get('DAILY_AI_OLLAMA', 'http://127.0.0.1:11434'))
    token, model = os.environ['DAILY_AI_TOKEN'], os.environ['DAILY_AI_MODEL']
    if not re.fullmatch(r'[\w./:-]{1,120}', model):
        raise ValueError('Invalid local model tag')
    ai.inference_options()  # Validate the GPU bound before connecting.
    while True:
        ws = None
        try:
            ws = websocket.create_connection(site.replace('https://', 'wss://') + '/api/internal/daily-ai-live',
                header={'Authorization': 'Bearer ' + token}, origin=site, timeout=10,
                http_no_proxy=['leodeng.dev'])
            ws.settimeout(0.1)
            print('Private live relay connected.', flush=True)
            last_ping = time.monotonic()
            while True:
                if time.monotonic() - last_ping > 20:
                    ws.send('{"type":"ping"}')
                    last_ping = time.monotonic()
                try:
                    raw = ws.recv()
                    if not raw:
                        raise RuntimeError('Relay disconnected')
                    if len(raw) > 4096:
                        raise ValueError('Oversized relay command')
                    job = json.loads(raw)
                    if valid_job(job):
                        execute(ws, job, site, token, origin, model)
                except websocket.WebSocketTimeoutException:
                    continue
        except Exception as error:
            print('Live relay reconnecting: ' + type(error).__name__, file=sys.stderr, flush=True)
            time.sleep(5)
        finally:
            if ws:
                ws.close()


def main():
    # SIGTERM must unwind execute() so its child cannot outlive this service.
    def stop(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    run()


if __name__ == '__main__':
    main()
