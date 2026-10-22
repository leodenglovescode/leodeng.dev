#!/usr/bin/env bash
# Run on superserver with sudo. The publishing secret stays in the private env file.
set -euo pipefail

if [[ ${EUID} -ne 0 || $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: sudo bash homelab/install-daily-ai.sh /absolute/path/to/private/env [--loopback]' >&2
  exit 1
fi
env_source=$1
loopback=${2:-}
if [[ -n "$loopback" && "$loopback" != '--loopback' ]]; then
  echo 'The only supported option is --loopback.' >&2
  exit 1
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

python3 - "$env_source" <<'PY'
import os,re,stat,sys
from pathlib import Path
p=Path(sys.argv[1])
if not p.is_absolute() or not p.is_file() or p.is_symlink() or p.stat().st_mode & 0o077:
    raise SystemExit('Use an absolute, private mode-600 regular configuration file.')
values=dict(line.split('=',1) for line in p.read_text().splitlines() if line and not line.startswith('#'))
expected={'DAILY_AI_SITE','DAILY_AI_TOKEN','DAILY_AI_OLLAMA','DAILY_AI_MODEL','DAILY_AI_GPU_LAYERS'}
if set(values)!=expected or values['DAILY_AI_SITE']!='https://leodeng.dev' or values['DAILY_AI_OLLAMA']!='http://127.0.0.1:11434':
    raise SystemExit('Unexpected publisher configuration.')
if not re.fullmatch(r'[a-f0-9]{64}',values['DAILY_AI_TOKEN']) or values['DAILY_AI_MODEL']!='qwen3.8:27b':
    raise SystemExit('Expected the prepared publishing secret and qwen3.8:27b model.')
if not values['DAILY_AI_GPU_LAYERS'].isdigit() or not 0<=int(values['DAILY_AI_GPU_LAYERS'])<=65:
    raise SystemExit('Invalid GPU layer limit.')
existing=Path('/etc/daily-ai.env')
if existing.exists() and existing.read_bytes()!=p.read_bytes():
    raise SystemExit('/etc/daily-ai.env already differs; refusing to overwrite an existing secret.')
PY

if [[ "$loopback" == '--loopback' ]]; then
  # This intentionally changes Ollama's listener. Do not use this option if
  # other LAN applications still need direct access to the Ollama port.
  python3 - <<'PY'
import json,urllib.request
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open('http://127.0.0.1:11434/api/ps',timeout=10) as response:
    if json.load(response).get('models'):
        raise SystemExit('Unload active Ollama models before changing the listener.')
PY
  install -d -m 755 /etc/systemd/system/ollama.service.d
  cat > /etc/systemd/system/ollama.service.d/zz-daily-ai-loopback.conf <<'CONF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
CONF
fi

install -d -m 755 /usr/local/lib/daily-ai
install -m 644 "$source_dir/daily_ai.py" /usr/local/lib/daily-ai/daily_ai.py
install -m 600 "$env_source" /etc/daily-ai.env
install -m 644 "$source_dir/daily-ai.service" "$source_dir/daily-ai.timer" /etc/systemd/system/
systemctl daemon-reload
if [[ "$loopback" == '--loopback' ]]; then
  systemctl restart ollama.service
  python3 - <<'PY'
import subprocess,time
for attempt in range(20):
    listeners=subprocess.check_output(['ss','-H','-ltn','( sport = :11434 )'],text=True).splitlines()
    if listeners:
        if all(line.split()[3]=='127.0.0.1:11434' for line in listeners):
            break
        raise SystemExit('Another Ollama override still exposes port 11434. Check systemd drop-ins before enabling the timer.')
    time.sleep(0.5)
else:
    raise SystemExit('Ollama did not start its loopback listener.')
PY
fi
systemctl enable --now daily-ai.timer
systemctl start daily-ai.service
systemctl list-timers daily-ai.timer --no-pager
journalctl -u daily-ai.service -n 15 --no-pager
