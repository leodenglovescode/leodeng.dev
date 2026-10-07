"""A bounded HTTP view of the Pi's already disciplined clock, not an NTP proxy."""
import datetime
import json
import os
import re
import subprocess
import threading
import time


class TokenBucket:
    def __init__(self, rate=5, burst=10):
        self.rate, self.burst = rate, burst
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def accept(self):
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                return False
            self.tokens -= 1
            return True


def tracking_is_healthy(output, pps_refid, now=None):
    fields = dict(line.split(':', 1) for line in output.splitlines() if ':' in line)
    fields = {key.strip(): value.strip() for key, value in fields.items()}
    reference = re.search(r'\(([^)]+)\)', fields.get('Reference ID', ''))
    try:
        reference_time = datetime.datetime.strptime(
            fields['Ref time (UTC)'], '%a %b %d %H:%M:%S %Y'
        ).replace(tzinfo=datetime.timezone.utc).timestamp()
        age = (time.time() if now is None else now) - reference_time
        return (fields.get('Leap status') == 'Normal'
                and fields.get('Stratum') == '1'
                and reference is not None and reference.group(1) == pps_refid
                and 0 <= age <= 120)
    except (KeyError, ValueError):
        return False


class ClockApplication:
    def __init__(self):
        self.limiter = TokenBucket()
        self.health_lock = threading.Lock()
        self.healthy = False
        self.checked_at = 0

    def monitor(self):
        # A fixed command and locally configured refid; no request data enters it.
        refid = os.environ.get('CLOCK_PPS_REFID', 'PPS')
        while True:
            try:
                result = subprocess.run(
                    ['/usr/bin/chronyc', '-n', 'tracking'], capture_output=True,
                    text=True, timeout=2, check=True,
                    env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
                )
                healthy = tracking_is_healthy(result.stdout, refid)
            except (OSError, subprocess.SubprocessError):
                healthy = False
            with self.health_lock:
                self.healthy = healthy
                self.checked_at = time.monotonic()
            time.sleep(10)

    def __call__(self, environ, start_response):
        received = time.time_ns() / 1_000_000
        headers = [('Content-Type', 'application/json'), ('Cache-Control', 'no-store'),
                   ('X-Content-Type-Options', 'nosniff')]

        def respond(status, body, extra=()):
            data = json.dumps(body, separators=(',', ':')).encode('ascii')
            start_response(status, headers + list(extra) + [('Content-Length', str(len(data)))])
            return [data]

        if not self.limiter.accept():
            return respond('429 Too Many Requests', {'error': 'Clock busy'}, [('Retry-After', '60')])
        if environ.get('PATH_INFO') != '/time' or environ.get('QUERY_STRING'):
            return respond('404 Not Found', {'error': 'Not found'})
        if environ.get('REQUEST_METHOD') != 'GET':
            return respond('405 Method Not Allowed', {'error': 'Method not allowed'}, [('Allow', 'GET')])
        if environ.get('CONTENT_LENGTH') not in (None, '', '0') or environ.get('HTTP_TRANSFER_ENCODING'):
            return respond('400 Bad Request', {'error': 'Invalid request'})
        with self.health_lock:
            healthy = self.healthy and time.monotonic() - self.checked_at <= 30
        if not healthy:
            return respond('503 Service Unavailable', {'error': 'Clock unavailable'})
        sent = time.time_ns() / 1_000_000
        if sent < received:
            return respond('503 Service Unavailable', {'error': 'Clock unavailable'})
        return respond('200 OK', {
            'receivedAtMs': received, 'sentAtMs': sent,
            'synchronized': True, 'source': 'gps-pps', 'stratum': 1,
        })


if __name__ == '__main__':
    from waitress import serve
    app = ClockApplication()
    threading.Thread(target=app.monitor, daemon=True).start()
    serve(app, host='127.0.0.1', port=8099, threads=4, connection_limit=16,
          backlog=16, channel_timeout=5, cleanup_interval=1,
          max_request_header_size=4096, max_request_body_size=0,
          expose_tracebacks=False, ident='')
