#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this installer as your logged-in user: bash install-update.sh"
  echo "Do not use sudo for the whole script. It requests sudo only to install the binary."
  exit 1
fi

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "This update is for Apple Silicon Macs."
  exit 1
fi

update_dir="$(cd "$(dirname "$0")" && pwd)"
agent_plist="$HOME/Library/LaunchAgents/dev.leodeng.now-playing-agent.plist"
agent_token="$HOME/Library/Application Support/dev.leodeng.now-playing-agent/token"
agent_service="gui/$(id -u)/dev.leodeng.now-playing-agent"
agent_domain="gui/$(id -u)"
if ! launchctl print "$agent_domain" >/dev/null 2>&1; then
  echo "Your GUI launchd session is unavailable. Run this from Terminal while logged into the Mac desktop."
  exit 1
fi
if [ ! -s "$agent_token" ]; then
  echo "The existing agent token file is missing. Follow README.md for initial setup."
  exit 1
fi

cd "$update_dir"
shasum -a 256 -c SHA256SUMS
update_temp="$(mktemp -d)"
trap 'rm -rf "$update_temp"' EXIT
sed "s|/Users/YOUR_USERNAME|$HOME|g" dev.leodeng.now-playing-agent.plist.example > "$update_temp/agent.plist"
plutil -lint "$update_temp/agent.plist"

sudo mkdir -p /usr/local/bin
sudo install -m 755 now-playing-agent-darwin-arm64 /usr/local/bin/now-playing-agent-update
sudo xattr -d com.apple.quarantine /usr/local/bin/now-playing-agent-update 2>/dev/null || true
sudo codesign --force --sign - /usr/local/bin/now-playing-agent-update
codesign --verify --verbose=2 /usr/local/bin/now-playing-agent-update

mkdir -p "$HOME/Library/LaunchAgents"
if [ -f "$agent_plist" ]; then
  cp "$agent_plist" "$agent_plist.backup-$(date +%Y%m%d%H%M%S)"
fi
if launchctl print "$agent_service" >/dev/null 2>&1; then
  launchctl bootout "$agent_service"
fi
sudo mv /usr/local/bin/now-playing-agent-update /usr/local/bin/now-playing-agent
cp "$update_temp/agent.plist" "$agent_plist"
chmod 644 "$agent_plist"
# A prior disabled override survives replacing the plist. Explicitly enable
# this agent, then allow launchd to finish tearing down the previous job.
launchctl enable "$agent_service"
agent_loaded=false
for attempt in 1 2 3; do
  if launchctl bootstrap "$agent_domain" "$agent_plist" > "$update_temp/bootstrap.log" 2>&1; then
    agent_loaded=true
    break
  fi
  if launchctl print "$agent_service" >/dev/null 2>&1; then
    agent_loaded=true
    break
  fi
  sleep 1
done
if [ "$agent_loaded" != true ]; then
  cat "$update_temp/bootstrap.log" >&2
  echo "The binary is installed, but the LaunchAgent could not be loaded." >&2
  echo "Do not rerun with sudo. Inspect the reason with:" >&2
  echo "  launchctl print-disabled $agent_domain" >&2
  echo "  log show --last 3m --style compact --predicate 'process == \"launchd\" AND eventMessage CONTAINS \"dev.leodeng.now-playing-agent\"'" >&2
  exit 1
fi
launchctl kickstart -k "$agent_service"
/usr/local/bin/now-playing-agent version
echo "Updated: idle checks 5s, playback checks 2s, heartbeats 5s, artwork enabled."
