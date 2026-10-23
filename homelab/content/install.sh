#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash homelab/content/install.sh'; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
for program in mount.cifs mountpoint flock python3; do
  command -v "$program" >/dev/null || { echo "Missing $program. On Debian/Ubuntu install cifs-utils and util-linux." >&2; exit 1; }
done
install -d -m 700 /etc/leodeng-content-backup /var/lib/leodeng-content
if [[ ! -s /etc/leodeng-content-backup/token ]]; then
  if [[ -s "$root/.local-admin/content-backup-token" ]]; then
    install -m 600 "$root/.local-admin/content-backup-token" /etc/leodeng-content-backup/token
  else
    read -r -s -p 'Content backup API token (CONTENT_BACKUP_TOKEN): ' backup_token
    printf '\n'
    [[ -n "$backup_token" ]] || exit 1
    printf '%s\n' "$backup_token" > /etc/leodeng-content-backup/token
    unset backup_token
  fi
fi
if [[ ! -s /etc/leodeng-content-backup/smb.credentials ]]; then
  read -r -p 'NAS SMB username: ' smb_user
  read -r -s -p 'NAS SMB password: ' smb_password
  printf '\n'
  [[ -n "$smb_user" && -n "$smb_password" ]] || { echo 'Both SMB fields are required.' >&2; exit 1; }
  printf 'username=%s\npassword=%s\n' "$smb_user" "$smb_password" > /etc/leodeng-content-backup/smb.credentials
  unset smb_user smb_password
fi
chmod 600 /etc/leodeng-content-backup/{token,smb.credentials}
if [[ ! -f /etc/leodeng-content-backup/nas.conf ]]; then
  cat > /etc/leodeng-content-backup/nas.conf <<'CONFIG'
SMB_SHARE='//192.168.3.17/leodeng_存储空间1'
NAS_DIRECTORY='ALL/website_blogs_backup'
CONFIG
fi
install -m 755 "$root/homelab/content/export.py" /usr/local/bin/leodeng-content-export
install -m 755 "$root/homelab/content/nas-backup.sh" /usr/local/bin/leodeng-content-nas-backup
install -m 644 "$root"/homelab/content/content-{export,nas-backup}.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now content-export.timer
systemctl start content-export.service
# Verify one NAS backup now instead of discovering an SMB problem at midnight.
systemctl start content-nas-backup.service
systemctl enable --now content-nas-backup.timer
systemctl list-timers content-export.timer content-nas-backup.timer
