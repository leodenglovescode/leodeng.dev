#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/leodeng-content-nas.lock
flock -n 9 || exit 0
/usr/local/bin/leodeng-content-export
exec python3 /usr/local/lib/leodeng-content-backup/ftps_backup.py
