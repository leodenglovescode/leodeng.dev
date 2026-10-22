#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo 'Run with sudo: sudo bash homelab/remove-daily-ai.sh' >&2
  exit 1
fi
systemctl disable --now daily-ai.timer daily-ai.service 2>/dev/null || true
for unit in daily-ai.timer daily-ai.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "Refusing cleanup while $unit is active." >&2
    exit 1
  fi
done
rm -f /etc/systemd/system/daily-ai.service /etc/systemd/system/daily-ai.timer /etc/daily-ai.env
rm -rf /usr/local/lib/daily-ai /var/lib/daily-ai /var/lib/private/daily-ai
# Preserve Ollama's loopback restriction while removing the obsolete feature name.
old_dropin=/etc/systemd/system/ollama.service.d/zz-daily-ai-loopback.conf
new_dropin=/etc/systemd/system/ollama.service.d/zz-loopback-only.conf
if [[ -f "$old_dropin" && ! -e "$new_dropin" ]]; then
  mv "$old_dropin" "$new_dropin"
fi
if [[ -n ${SUDO_USER:-} && $SUDO_USER != root ]]; then
  account_dir=$(getent passwd "$SUDO_USER" | cut -d: -f6)
  if [[ -n $account_dir && $account_dir != / ]]; then
    rm -rf -- "$account_dir/.config/leodeng-daily-ai"
  fi
fi
systemctl daemon-reload
systemctl reset-failed daily-ai.service daily-ai.timer 2>/dev/null || true
echo 'Removed the local Daily AI agent. Ollama and its downloaded models are preserved.'
