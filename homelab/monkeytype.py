#!/usr/bin/env python3
"""Fetch Monkeytype hourly, verify ownership, push only public stats to D1.

Standard library only. Secrets come from systemd's EnvironmentFile. The state
file contains a sanitized pending snapshot and the last attempt, never keys or
upstream responses. Failed pushes retry without another Monkeytype API call.
"""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

USER = 'leodeng'
INTERVAL = 3600
MAX_BYTES = 2_000_000
USER_AGENT = 'leodeng.dev/1.0 (personal stats collector; https://leodeng.dev/stats)'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward either secret to a redirect target.


def request_json(url, headers, payload=None):
    data = None if payload is None else json.dumps(payload, separators=(',', ':'), allow_nan=False).encode()
    # Monkeytype rejects Python's default urllib identity with HTTP 403.
    # Identify this collector consistently for profile, history and upload.
    req = urllib.request.Request(url, data=data, headers={'User-Agent': USER_AGENT, **headers})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
            if 'application/json' not in response.headers.get('Content-Type', ''):
                raise ValueError('Expected JSON')
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('Response too large')
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        # Never log upstream bodies, headers, keys or account IDs.
        raise ValueError('HTTP ' + str(error.code)) from None


def number(value, maximum=1_000_000_000):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def snapshot(profile, results):
    if profile.get('name', '').lower() != USER or not isinstance(profile.get('uid'), str) or not profile['uid']:
        raise ValueError('Profile account mismatch')
    if not isinstance(results, list) or len(results) > 1000:
        raise ValueError('Invalid results')
    if any(not isinstance(r, dict) or r.get('uid') != profile['uid'] for r in results):
        raise ValueError('Results account mismatch')
    stats = profile.get('typingStats', {})
    if not number(stats.get('completedTests')) or not number(stats.get('timeTyping')):
        raise ValueError('Invalid profile stats')
    bests = []
    for seconds in (15, 30, 60, 120):
        candidates = [r for r in profile.get('personalBests', {}).get('time', {}).get(str(seconds), [])
                      if r.get('language') == 'english' and r.get('difficulty') == 'normal'
                      and not any(r.get(k) for k in ('lazyMode', 'punctuation', 'numbers'))
                      and number(r.get('wpm'), 1000) and number(r.get('acc'), 100)]
        if candidates:
            best = max(candidates, key=lambda r: r['wpm'])
            bests.append({'seconds': seconds, 'wpm': best['wpm'], 'accuracy': best['acc']})
    clean = []
    for r in results:
        if not (number(r.get('wpm'), 1000) and number(r.get('acc'), 100)
                and number(r.get('timestamp'), 10_000_000_000_000) and r['timestamp'] >= 1589428800000):
            continue
        mode = r.get('mode')
        clean.append({'wpm': r['wpm'], 'accuracy': r['acc'], 'timestamp': r['timestamp'],
                      'mode': mode if mode in ('time', 'words', 'quote', 'custom', 'zen') else 'other',
                      'mode2': str(r.get('mode2', ''))[:20],
                      'language': r.get('language', '')[:40] if isinstance(r.get('language', ''), str) else ''})
    return {'username': USER, 'profile': {'completedTests': stats['completedTests'],
            'timeTyping': stats['timeTyping'], 'bests': bests},
            'results': sorted(clean, key=lambda r: r['timestamp'])}


def save(path, state):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(state, stream, separators=(',', ':'), allow_nan=False)
    temporary.replace(path)


def collect(path, api_key, push_token, now=None, transport=request_json):
    now = time.time() if now is None else now
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return  # Another timer/manual invocation owns the refresh.
        try:
            state = json.loads(path.read_text()) if path.exists() else {}
        except (ValueError, OSError):
            raise ValueError('Invalid state file; refusing to reset the API quota') from None
        if not state.get('pending') and now - state.get('lastAttempt', 0) >= INTERVAL:
            state['lastAttempt'] = now
            save(path, state)  # Reserve the hour before any network call, even on failure.
            headers = {'Accept': 'application/json', 'Authorization': 'ApeKey ' + api_key}
            profile = transport('https://api.monkeytype.com/users/leodeng/profile', headers)['data']
            # Validate the profile before requesting private history.
            snapshot(profile, [])
            results = transport('https://api.monkeytype.com/results?limit=1000', headers)['data']
            state['pending'] = snapshot(profile, results)
            save(path, state)
        if state.get('pending'):
            response = transport('https://leodeng.dev/api/stats/monkeytype',
                                 {'Accept': 'application/json', 'Content-Type': 'application/json',
                                  'Authorization': 'Bearer ' + push_token}, state['pending'])
            if response.get('ok') is not True:
                raise ValueError('Push was not acknowledged')
            del state['pending']
            save(path, state)
            print('Monkeytype snapshot pushed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-file', type=Path, required=True)
    args = parser.parse_args()
    key = os.environ.get('MONKEYTYPE_API_KEY', '').strip()
    token = os.environ.get('HOMELAB_TOKEN', '').strip()
    if not key:
        return 0  # Optional collector: heartbeat and tokens still work without a key.
    if not token:
        print('Monkeytype push requires HOMELAB_TOKEN', file=sys.stderr)
        return 1
    os.umask(0o077)
    try:
        collect(args.state_file, key, token)
        return 0
    except Exception as error:
        # Only our HTTP status errors are safe to expose; unknown exception
        # messages can include URLs or upstream content.
        detail = str(error) if isinstance(error, ValueError) and str(error).startswith('HTTP ') else 'fetch, validation, or push failed'
        print('Monkeytype: ' + detail + '; last published snapshot retained', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
