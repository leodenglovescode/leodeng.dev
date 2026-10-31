#!/usr/bin/env python3
"""Authenticated, bounded, read-only metadata lookup gateway. No public search or writes."""
import collections
import hmac
import http.server
import ipaddress
import json
import math
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_RESPONSE = 256000
MAX_CACHE = 4 * 1024 * 1024


def query_params(raw):
    if len(raw) > 6000:
        raise ValueError()
    pairs = urllib.parse.parse_qsl(raw, keep_blank_values=True, strict_parsing=True, max_num_fields=4)
    params = dict(pairs)
    if len(params) != len(pairs) or set(params) - {'track_name', 'artist_name', 'album_name', 'duration'}:
        raise ValueError()
    result = {}
    for key in ('track_name', 'artist_name', 'album_name'):
        value = params.get(key, '').strip()
        if len(value.encode('utf-16-le')) // 2 > 300 or any(ord(c) < 32 or ord(c) == 127 for c in value) or (key != 'album_name' and not value):
            raise ValueError()
        if value:
            result[key] = value
    duration = float(params.get('duration', ''))
    if not math.isfinite(duration) or not 0 < duration <= 86400:
        raise ValueError()
    result['duration'] = str(duration)
    return urllib.parse.urlencode(result)


def upstream_url(value):
    url = urllib.parse.urlsplit(value)
    host = ipaddress.ip_address(url.hostname)
    networks = ('127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '::1/128')
    if not any(host in ipaddress.ip_network(n) for n in networks) or url.scheme != 'http' or url.username or url.password or url.query or url.fragment or url.path != '/api/get':
        raise ValueError('Invalid upstream configuration')
    if url.port is not None and not 1 <= url.port <= 65535:
        raise ValueError('Invalid upstream port')
    return value


class Gateway:
    def __init__(self, upstream, token, opener=None):
        if len(token) < 32 or len(token) > 1024 or any(ord(c) < 33 or ord(c) > 126 for c in token):
            raise ValueError('Invalid gateway credential configuration')
        self.upstream = upstream_url(upstream)
        self.token = ('Bearer ' + token).encode()
        # Never inherit host proxy settings or follow an upstream redirect.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.cache = collections.OrderedDict()
        self.cache_bytes = 0
        self.lock = threading.Lock()
        self.loads = threading.BoundedSemaphore(4)
        self.tokens, self.refilled = 8.0, time.monotonic()

    def authorized(self, headers):
        values = headers.get_all('Authorization', [])
        return len(values) == 1 and len(values[0]) <= 2048 and hmac.compare_digest(values[0].encode(), self.token)

    def lookup(self, query):
        now = time.monotonic()
        with self.lock:
            hit = self.cache.get(query)
            if hit and hit[0] > now:
                self.cache.move_to_end(query)
                return hit[1], hit[2]
            self.tokens = min(8.0, self.tokens + (now - self.refilled) / 2)
            self.refilled = now
            if self.tokens < 1:
                return 429, b'{"error":"Temporarily unavailable"}'
            self.tokens -= 1
        if not self.loads.acquire(blocking=False):
            return 503, b'{"error":"Temporarily unavailable"}'
        try:
            request = urllib.request.Request(self.upstream + '?' + query, headers={'Accept': 'application/json', 'User-Agent': 'lyrics-gateway/1.0'})
            try:
                with self.opener.open(request, timeout=2) as response:
                    if response.status != 200 or response.headers.get_content_type() != 'application/json':
                        raise ValueError()
                    raw = response.read(MAX_RESPONSE + 1)
                    if len(raw) > MAX_RESPONSE:
                        raise ValueError()
                    value = json.loads(raw)
                    if not isinstance(value, dict):
                        raise ValueError()
                    duration = value.get('duration')
                    if type(duration) not in (int, float) or not math.isfinite(duration):
                        raise ValueError()
                    lyrics = value.get('syncedLyrics')
                    if lyrics is not None and (not isinstance(lyrics, str) or len(lyrics) > 100000):
                        raise ValueError()
                    body = json.dumps({'syncedLyrics': lyrics, 'duration': duration, 'instrumental': value.get('instrumental') is True}, ensure_ascii=False, separators=(',', ':')).encode()
                    if len(body) > MAX_RESPONSE:
                        raise ValueError()
                    status, ttl = 200, 3600
            except urllib.error.HTTPError as error:
                error.close()
                if error.code != 404:
                    raise ValueError() from None
                status, body, ttl = 404, b'{"syncedLyrics":null}', 60
            with self.lock:
                while self.cache and (len(self.cache) >= 128 or self.cache_bytes + len(body) > MAX_CACHE):
                    _, old = self.cache.popitem(last=False)
                    self.cache_bytes -= len(old[2])
                old = self.cache.pop(query, None)
                if old:
                    self.cache_bytes -= len(old[2])
                self.cache[query] = (time.monotonic() + ttl, status, body)
                self.cache_bytes += len(body)
            return status, body
        except (OSError, ValueError, TypeError, OverflowError, urllib.error.URLError):
            return 503, b'{"error":"Temporarily unavailable"}'
        finally:
            self.loads.release()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8
    allow_reuse_address = True

    def __init__(self, address, gateway):
        self.gateway = gateway
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # No query, lyric text, credentials or client details in exception traces.
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'LyricsGateway'
    sys_version = ''
    protocol_version = 'HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(3)
        self.deadline = threading.Timer(8, self.close_connection_now)
        self.deadline.daemon = True
        self.deadline.start()

    def close_connection_now(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def finish(self):
        self.deadline.cancel()
        super().finish()

    def log_message(self, *args):
        pass

    def reply(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        if status in (429, 503):
            self.send_header('Retry-After', '60')
        if status == 405:
            self.send_header('Allow', 'GET')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        if not self.server.gateway.authorized(self.headers):
            return self.reply(403, b'{"error":"Forbidden"}')
        url = urllib.parse.urlsplit(self.path)
        if url.scheme or url.netloc or url.fragment or url.path != '/api/get':
            return self.reply(404, b'{"error":"Not found"}')
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            return self.reply(400, b'{"error":"Invalid request"}')
        try:
            query = query_params(url.query)
        except (ValueError, UnicodeError):
            return self.reply(400, b'{"error":"Invalid query"}')
        status, body = self.server.gateway.lookup(query)
        self.reply(status, body)

    def do_POST(self):
        self.reply(405, b'{"error":"Method not allowed"}')
    do_HEAD = do_POST
    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST
    do_OPTIONS = do_POST
    do_CONNECT = do_POST


if __name__ == '__main__':
    gateway = Gateway(os.environ.get('LRCLIB_UPSTREAM', ''), os.environ.get('LYRICS_GATEWAY_TOKEN', ''))
    host = os.environ.get('LYRICS_GATEWAY_HOST', '127.0.0.1')
    if host not in ('127.0.0.1', '0.0.0.0'):
        raise ValueError('Invalid bind address')
    Server((host, 3310), gateway).serve_forever()
