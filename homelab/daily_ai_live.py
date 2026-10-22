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

THINKING_BUDGET = 2048
ANSWER_BUDGET = 512


class GenerationFailure(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def stream_child(pipe, origin, model, prompt):
    started = time.monotonic()
    completions = []
    saw_answer = False
    answering = False
    try:
        # The first request has a bounded thinking budget. If all of it is spent
        # thinking, reserve a separate, bounded non-thinking request for the answer.
        for attempt in range(2):
            options = ai.inference_options()
            options['num_predict'] = THINKING_BUDGET if attempt == 0 else ANSWER_BUDGET
            body = {'model': model, 'stream': True, 'think': attempt == 0, 'keep_alive': '2m',
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
                        raise GenerationFailure('stream_incomplete')
                    total += len(line)
                    if len(line) > 8192 or total > 4 * 1024 * 1024:
                        raise GenerationFailure('output_limit')
                    data = json.loads(line)
                    if data.get('error'):
                        raise GenerationFailure('model_unavailable')
                    for field, channel in [('thinking', 'thinking'), ('content', 'answer')]:
                        text = data.get('message', {}).get(field, '')
                        if text:
                            if not isinstance(text, str) or len(text) > 4096:
                                raise GenerationFailure('output_limit')
                            if channel == 'answer':
                                if not answering:
                                    pipe.send({'type': 'phase', 'phase': 'answering'})
                                    answering = True
                                saw_answer = saw_answer or bool(text.strip())
                            pipe.send({'type': 'delta', 'channel': channel, 'text': text})
                    if data.get('done'):
                        completions.append(data)
                        break
            if saw_answer:
                break
            if attempt == 0:
                pipe.send({'type': 'phase', 'phase': 'answering'})
                answering = True
        if not saw_answer:
            raise GenerationFailure('empty_answer')
        def summed(field):
            values = [result.get(field) for result in completions]
            return sum(values) if all(type(value) is int and value >= 0 for value in values) else None
        pipe.send({'type': 'done', 'stats': {
            'durationMs': round((time.monotonic() - started) * 1000),
            'tokens': summed('eval_count'), 'evalDurationNs': summed('eval_duration'),
            'promptTokens': summed('prompt_eval_count'), 'passes': len(completions),
            'finishReason': completions[-1].get('done_reason') if completions[-1].get('done_reason') in {'stop', 'length'} else 'unknown',
        }})
    except Exception as error:
        code = error.code if isinstance(error, GenerationFailure) else 'model_unavailable' if isinstance(error, OSError) else 'inference_failed'
        pipe.send({'type': 'error', 'code': code})
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
            raise GenerationFailure('controls_changed')
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
                raise GenerationFailure('generation_timeout')
            if now - last_control > 3:
                current = control()
                if not current.get('enabled') or current.get('revision') != lease['revision'] or current.get('day') != job['day']:
                    raise GenerationFailure('controls_changed')
                last_control = time.monotonic()
            if now - last_ping > 20:
                ws.send('{"type":"ping"}')
                last_ping = now
            # Keep the receive loop live while Ollama works, so admin reset and
            # the kill switch can interrupt a blocked local inference request.
            try:
                incoming = ws.recv()
                if not incoming:
                    raise GenerationFailure('runner_disconnected')
                command = json.loads(incoming)
                if command.get('type') == 'cancel' and command.get('job') == job['job']:
                    raise GenerationFailure('generation_cancelled')
            except websocket.WebSocketTimeoutException:
                pass
            while parent.poll():
                event = parent.recv()
                event['job'] = job['job']
                if event['type'] == 'error':
                    raise GenerationFailure(event.get('code', 'inference_failed'))
                if event['type'] == 'done':
                    event['sources'] = sources
                    completed = True
                ws.send(json.dumps(event, ensure_ascii=False))
                if completed:
                    break
            if not process.is_alive() and not completed and not parent.poll():
                raise GenerationFailure('inference_failed')
    except Exception as error:
        code = error.code if isinstance(error, GenerationFailure) else 'runner_disconnected' if isinstance(error, websocket.WebSocketException) else 'inference_failed'
        print(json.dumps({'event': 'live_generation_failed', 'job': job['job'], 'code': code}), file=sys.stderr, flush=True)
        try:
            ws.send(json.dumps({'type': 'error', 'job': job['job'], 'code': code}))
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
                        raise GenerationFailure('runner_disconnected')
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
