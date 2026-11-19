"""A bounded HTTP view of the Pi's already disciplined clock, not an NTP proxy."""
import datetime
from contextlib import closing
import json
import math
import os
import re
import socket
import sqlite3
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


class ClockHistory:
    """Daily counts of observed ten-second slots, not invented uptime in gaps."""
    def __init__(self, path):
        self.path = path

    def record(self, healthy, timestamp=None):
        timestamp = time.time() if timestamp is None else timestamp
        instant = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc)
        day = instant.date().isoformat()
        earliest = (instant.date() - datetime.timedelta(days=90)).isoformat()
        slot = int(timestamp // 10)
        locked = int(healthy)
        with closing(sqlite3.connect(self.path, timeout=1)) as db, db:
            # Daily aggregates need only a few pages. Bound the database even if
            # a future regression bypasses retention; failures cannot stop the clock.
            page_size = db.execute('PRAGMA page_size').fetchone()[0]
            db.execute(f'PRAGMA max_page_count = {max(1, 1048576 // page_size)}')
            db.execute('''CREATE TABLE IF NOT EXISTS clock_daily (
                day TEXT PRIMARY KEY, observed INTEGER NOT NULL, locked INTEGER NOT NULL,
                last_slot INTEGER NOT NULL, last_locked INTEGER NOT NULL)''')
            db.execute('''INSERT INTO clock_daily VALUES (?, 1, ?, ?, ?)
                ON CONFLICT(day) DO UPDATE SET
                observed = observed + CASE WHEN excluded.last_slot > last_slot THEN 1 ELSE 0 END,
                locked = locked + excluded.last_locked - CASE
                    WHEN excluded.last_slot = last_slot THEN last_locked ELSE 0 END,
                last_slot = excluded.last_slot, last_locked = excluded.last_locked
                WHERE excluded.last_slot >= last_slot''', (day, locked, slot, locked))
            db.execute('DELETE FROM clock_daily WHERE day < ? OR day > ?', (earliest, day))
            rows = db.execute('SELECT day, observed, locked FROM clock_daily WHERE day <= ? ORDER BY day', (day,)).fetchall()
        return {'days': [{'date': date, 'observed': observed, 'locked': good}
                         for date, observed, good in rows], 'intervalSeconds': 10}


def tracking_fields(output):
    fields = dict(line.split(':', 1) for line in output.splitlines() if ':' in line)
    return {key.strip(): value.strip() for key, value in fields.items()}


def tracking_is_healthy(output, pps_refid, now=None):
    fields = tracking_fields(output)
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


def tracking_metrics(output, now=None):
    """Parse numeric clock measurements, never source names or diagnostics."""
    fields = tracking_fields(output)
    metrics = {}
    specifications = (
        ('systemOffsetSeconds', 'System time', 'seconds', -3600, 3600, r' (fast|slow) of NTP time'),
        ('lastOffsetSeconds', 'Last offset', 'seconds', -3600, 3600, ''),
        ('rmsOffsetSeconds', 'RMS offset', 'seconds', 0, 3600, ''),
        ('frequencyPpm', 'Frequency', 'ppm', -100000, 100000, r' (fast|slow)'),
        ('residualFrequencyPpm', 'Residual freq', 'ppm', -100000, 100000, ''),
        ('skewPpm', 'Skew', 'ppm', 0, 100000, ''),
        ('rootDelaySeconds', 'Root delay', 'seconds', -3600, 3600, ''),
        ('rootDispersionSeconds', 'Root dispersion', 'seconds', 0, 3600, ''),
        ('updateIntervalSeconds', 'Update interval', 'seconds', 0, 86400, ''),
    )
    for key, field, unit, lower, upper, direction in specifications:
        match = re.fullmatch(r'([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?) '
                             + unit + direction, fields.get(field, ''))
        if match:
            value = float(match.group(1))
            if direction and match.group(2) == 'slow':
                value = -value
            if math.isfinite(value) and lower <= value <= upper:
                metrics[key] = value
    try:
        reference = datetime.datetime.strptime(
            fields['Ref time (UTC)'], '%a %b %d %H:%M:%S %Y'
        ).replace(tzinfo=datetime.timezone.utc).timestamp()
        age = (time.time() if now is None else now) - reference
        if 0 <= age <= 120:
            metrics['referenceAgeSeconds'] = age
    except (KeyError, ValueError):
        pass
    return metrics


def satellite_counts(report):
    """Discard geometry and identity; count each satellite once across signals."""
    rows = report.get('satellites')
    if report.get('class') != 'SKY' or not isinstance(rows, list) or len(rows) > 512:
        return None
    satellites, tracked = {}, {}
    complete_signal_data = True
    for row in rows:
        if not isinstance(row, dict) or type(row.get('used')) is not bool:
            return None
        if all(type(row.get(k)) is int and row[k] >= 0 for k in ('gnssid', 'svid')):
            key = ('gnss', row['gnssid'], row['svid'])
        elif type(row.get('PRN')) is int and row['PRN'] > 0:
            key = ('prn', row['PRN'])
        else:
            return None
        satellites[key] = satellites.get(key, False) or row['used']
        signal = row.get('ss')
        if type(signal) in (int, float) and math.isfinite(signal) and 0 <= signal <= 100:
            tracked[key] = tracked.get(key, False) or signal > 0
        else:
            complete_signal_data = False
    counts = {'used': sum(satellites.values()), 'visible': len(satellites)}
    if rows and complete_signal_data:
        counts['tracked'] = sum(tracked.values())
    return counts


class ClockApplication:
    def __init__(self):
        self.limiter = TokenBucket()
        self.health_lock = threading.Lock()
        self.healthy = False
        self.checked_at = 0
        self.satellites = None
        self.satellites_at = 0
        self.receiver = {}
        self.tracking = {}
        self.locked_since = None
        state_directory = os.environ.get('STATE_DIRECTORY')
        self.history = ClockHistory(os.path.join(state_directory, 'clock-history.sqlite')) if state_directory else None
        self.stability = None

    def update_receiver(self, report):
        # TPV contains coordinates: retain only the receiver's fix mode.
        mode = report.get('mode')
        tdop = report.get('tdop')
        counts = satellite_counts(report) if report.get('class') == 'SKY' else None
        with self.health_lock:
            if report.get('class') == 'TPV' and type(mode) is int and 0 <= mode <= 3:
                self.receiver['fixMode'] = (mode, time.monotonic())
            if report.get('class') == 'SKY':
                if type(tdop) in (int, float) and math.isfinite(tdop) and 0 <= tdop <= 1000:
                    self.receiver['tdop'] = (tdop, time.monotonic())
                # DOP-only SKY reports must not clear or refresh satellite counts.
                if counts is not None:
                    self.satellites = counts
                    self.satellites_at = time.monotonic()

    def update_tracking(self, output, refid):
        healthy = tracking_is_healthy(output, refid)
        metrics = tracking_metrics(output) if healthy else {}
        with self.health_lock:
            now = time.monotonic()
            if healthy:
                if not self.healthy or now - self.checked_at > 30 or self.locked_since is None:
                    self.locked_since = now
            else:
                self.locked_since = None
            self.healthy = healthy
            self.tracking = metrics
            self.checked_at = now

    def observe_satellites(self):
        # Read-only local gpsd subscription, independent of clock health/requests.
        while True:
            try:
                with socket.create_connection(('127.0.0.1', 2947), timeout=2) as connection:
                    connection.settimeout(15)
                    connection.sendall(b'?WATCH={"enable":true,"json":true};\n')
                    with connection.makefile('rb') as stream:
                        while True:
                            line = stream.readline(65537)
                            if not line or len(line) > 65536:
                                break
                            report = json.loads(line)
                            if not isinstance(report, dict):
                                continue
                            self.update_receiver(report)
            except (OSError, ValueError):
                pass
            with self.health_lock:
                self.satellites = None
                self.receiver = {}
            time.sleep(5)

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
                output = result.stdout
            except (OSError, subprocess.SubprocessError):
                output = ''
            self.update_tracking(output, refid)
            if self.history:
                try:
                    # Persistence is outside the request path; failures never stop timekeeping.
                    stability = self.history.record(self.healthy)
                except (OSError, sqlite3.Error):
                    stability = None
                with self.health_lock:
                    self.stability = stability
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
            now = time.monotonic()
            healthy = self.healthy and now - self.checked_at <= 30
            satellites = (self.satellites if now - self.satellites_at <= 30
                          else None)
            receiver = {key: value for key, (value, observed) in self.receiver.items()
                        if now - observed <= 30}
            tracking = dict(self.tracking)
            if tracking:
                tracking['sampleAgeSeconds'] = round(now - self.checked_at, 3)
                if 'referenceAgeSeconds' in tracking:
                    tracking['referenceAgeSeconds'] += now - self.checked_at
            if self.locked_since is not None:
                tracking['lockedForSeconds'] = int(now - self.locked_since)
            stability = self.stability
        if not healthy:
            return respond('503 Service Unavailable', {'error': 'Clock unavailable'})
        sent = time.time_ns() / 1_000_000
        if sent < received:
            return respond('503 Service Unavailable', {'error': 'Clock unavailable'})
        return respond('200 OK', {
            'receivedAtMs': received, 'sentAtMs': sent,
            'synchronized': True, 'source': 'gps-pps', 'stratum': 1,
            **({'satellites': satellites} if satellites is not None else {}),
            **({'receiver': receiver} if receiver else {}),
            **({'tracking': tracking} if tracking else {}),
            **({'stability': stability} if stability is not None else {}),
        })


if __name__ == '__main__':
    from waitress import serve
    app = ClockApplication()
    threading.Thread(target=app.monitor, daemon=True).start()
    threading.Thread(target=app.observe_satellites, daemon=True).start()
    serve(app, host='127.0.0.1', port=8099, threads=4, connection_limit=16,
          backlog=16, channel_timeout=5, cleanup_interval=1,
          max_request_header_size=4096, max_request_body_size=0,
          expose_tracebacks=False, ident='')
