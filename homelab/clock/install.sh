#!/bin/sh
# Run with sudo after reviewing. Does not change chrony or install a tunnel.
set -eu
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
clock_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
id pi-clock >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pi-clock
install -d -o root -g root -m 755 /opt/pi-clock
install -o root -g root -m 644 "$clock_source/clock.py" /opt/pi-clock/clock.py
install -o root -g root -m 644 "$clock_source/requirements.txt" /opt/pi-clock/requirements.txt
python3 -m venv /opt/pi-clock/venv
/opt/pi-clock/venv/bin/pip install -r /opt/pi-clock/requirements.txt
install -o root -g root -m 644 "$clock_source/pi-clock.service" /etc/systemd/system/pi-clock.service
systemctl daemon-reload
systemctl enable --now pi-clock.service
