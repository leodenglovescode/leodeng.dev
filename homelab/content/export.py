#!/usr/bin/env python3
"""Read-only D1 content export to Markdown, JSON and immutable local revisions."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.request

PATH = re.compile(r'^src/(?:posts|drafts)/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.md$')
REVISION = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


def relative_path(value):
    if value == 'src/content/shelf.json': return Path('shelf.json')
    if not isinstance(value, str) or not PATH.fullmatch(value): raise ValueError('Invalid export path')
    return Path(value.removeprefix('src/'))


def validate_export(data):
    if data.get('version') != 1 or not isinstance(data.get('files'), list) or not isinstance(data.get('revisions'), list):
        raise ValueError('Invalid content export')
    for row in data['files'] + data['revisions']:
        relative_path(row.get('path'))
        if not isinstance(row.get('raw'), str) or not REVISION.fullmatch(row.get('revision', '')):
            raise ValueError('Invalid revision')
        if row.get('deleted') not in (0, 1): raise ValueError('Invalid deletion marker')
    if not any(row['path'] == 'src/content/shelf.json' and not row['deleted'] for row in data['files']):
        raise ValueError('Incomplete content export')
    return data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None


def fetch_export(origin, token):
    if not origin.startswith('https://') or not token.strip(): raise ValueError('HTTPS origin and token required')
    request = urllib.request.Request(origin.rstrip('/') + '/api/content/export', headers={
        'Authorization': 'Bearer ' + token.strip(), 'Accept': 'application/json', 'User-Agent': 'leodeng-content-backup/1.0'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        if 'application/json' not in response.headers.get('Content-Type', ''): raise ValueError('Expected JSON export')
        raw = response.read(50_000_001)
        if len(raw) > 50_000_000: raise ValueError('Export exceeds safety limit')
        return validate_export(json.loads(raw))


def save_export(data, destination):
    validate_export(data)
    root = Path(destination)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    latest = root / 'latest' / 'export.json'
    if latest.exists():
        previous = json.loads(latest.read_text())
        if previous.get('files') == data['files'] and previous.get('revisions') == data['revisions']:
            return latest.parent.resolve()
    revisions = root / 'revisions'
    revisions.mkdir(exist_ok=True, mode=0o700)
    # Keep every revision as a standalone Markdown/JSON file, including content
    # that was edited or deleted before the next scheduled export.
    for row in data['revisions']:
        relative = relative_path(row['path'])
        target = revisions / row['revision'] / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.exists():
            if target.read_text() != row['raw']: raise ValueError('Revision content changed')
        else:
            target.write_text(row['raw'])
            target.chmod(0o600)
    temporary = Path(tempfile.mkdtemp(prefix='.snapshot-', dir=root))
    try:
        hashes = {}
        for row in data['files']:
            if row['deleted']: continue
            relative = relative_path(row['path'])
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_text(row['raw'])
            target.chmod(0o600)
            hashes[str(relative)] = hashlib.sha256(row['raw'].encode()).hexdigest()
        (temporary / 'export.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        (temporary / 'sha256.json').write_text(json.dumps(hashes, ensure_ascii=False, indent=2) + '\n')
        snapshot = root / 'snapshots' / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        snapshot.parent.mkdir(exist_ok=True, mode=0o700)
        temporary.rename(snapshot)
        # Atomic symlink switch. Incomplete downloads never replace the last
        # valid export; dated snapshots and revisions are never pruned.
        link = root / '.latest-new'
        link.unlink(missing_ok=True)
        link.symlink_to(snapshot.relative_to(root), target_is_directory=True)
        link.replace(root / 'latest')
        return snapshot
    finally:
        if temporary.exists(): shutil.rmtree(temporary)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', default='/var/lib/leodeng-content')
    parser.add_argument('--token-file', default='/etc/leodeng-content-backup/token')
    parser.add_argument('--origin', default='https://leodeng.dev')
    parser.add_argument('--from-file', help='Import a previously saved private JSON export instead of requesting the API')
    args = parser.parse_args()
    Path(args.destination).mkdir(parents=True, exist_ok=True, mode=0o700)
    with (Path(args.destination) / '.export.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(Path(args.from_file).read_text()) if args.from_file else fetch_export(args.origin, Path(args.token_file).read_text())
        snapshot = save_export(data, args.destination)
    print(f"Saved {len(data['files'])} entries and {len(data['revisions'])} revisions to {snapshot}")


if __name__ == '__main__': main()
