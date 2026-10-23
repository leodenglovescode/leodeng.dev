#!/usr/bin/env bash
set -euo pipefail
umask 077
# This service owns this temporary mount. No fstab entry or idle NAS polling.
source /etc/leodeng-content-backup/nas.conf
state=/var/lib/leodeng-content
mountpoint=/run/leodeng-content-nas/share
exec 9>/run/lock/leodeng-content-nas.lock
flock -n 9 || exit 0
/usr/local/bin/leodeng-content-export
[[ -L "$state/latest" ]] || { echo 'No valid local export available.' >&2; exit 1; }
mkdir -p "$mountpoint"
mountpoint -q "$mountpoint" && { echo 'Unexpected existing mount; refusing to reuse it.' >&2; exit 1; }
cleanup() { umount "$mountpoint"; }
mount -t cifs "$SMB_SHARE" "$mountpoint" -o credentials=/etc/leodeng-content-backup/smb.credentials,vers=3.0,iocharset=utf8,nosuid,nodev,noexec
trap cleanup EXIT
mountpoint -q "$mountpoint" || { echo 'NAS was not mounted.' >&2; exit 1; }
# Never copy into the local mount directory if the SMB mount failed.
destination="$mountpoint/$NAS_DIRECTORY"
mkdir -p "$destination"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pending="$destination/.incomplete-$stamp"
complete="$destination/$stamp"
mkdir "$pending"
cp -R -L "$state/latest/." "$pending/"
# export.json contains the full revision archive; standalone revision Markdown
# files are included too so recovery doesn't depend on a database or tool.
cp -R "$state/revisions" "$pending/revisions"
python3 - "$pending" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1])
for relative,digest in json.loads((root/'sha256.json').read_text()).items():
    if hashlib.sha256((root/relative).read_bytes()).hexdigest()!=digest:
        raise SystemExit('NAS checksum verification failed')
data=json.loads((root/'export.json').read_text())
for row in data['revisions']:
    relative='shelf.json' if row['path']=='src/content/shelf.json' else row['path'].removeprefix('src/')
    if (root/'revisions'/row['revision']/relative).read_text()!=row['raw']:
        raise SystemExit('NAS revision verification failed')
PY
mv "$pending" "$complete"
printf 'Verified content backup saved: %s\n' "$complete"
