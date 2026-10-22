# macOS now-playing agent

Small native agent that reads the currently playing track from Apple Music and
pushes it directly to the private `leodeng.dev` now-playing API. It has no
inbound listener and does not involve the super server or a Cloudflare Tunnel.

It sends only the song name, artist, album, duration, playback position, and
stable track identifier. The supplied LaunchAgent enables album artwork publishing
(the standalone command defaults to disabled). It
does not send Apple Account information, library paths, playlists, listening
history, or device details.

## Build

From this directory on the super server:

```bash
make all
```

The Apple Silicon binary is written to:

```text
bin/now-playing-agent-darwin-arm64
```

`bin/SHA256SUMS` contains the checksum to verify after copying.

The entire `now-playing-agent/` directory is ignored by Git as requested.

## Install on the Mac

Copy the binary and `dev.leodeng.now-playing-agent.plist.example` to the Mac.
From the directory containing the binary:

```bash
sudo mkdir -p /usr/local/bin
sudo install -m 755 ./now-playing-agent-darwin-arm64 /usr/local/bin/now-playing-agent

# This is a local cross-build. Remove quarantine and apply an ad-hoc signature.
sudo xattr -d com.apple.quarantine /usr/local/bin/now-playing-agent 2>/dev/null || true
sudo codesign --force --sign - /usr/local/bin/now-playing-agent
codesign --verify --verbose=2 /usr/local/bin/now-playing-agent
```

Create the private token file. Use the same value stored in Cloudflare as
`NOW_PLAYING_TOKEN`:

```bash
agent_state="$HOME/Library/Application Support/dev.leodeng.now-playing-agent"
mkdir -p "$agent_state"
chmod 700 "$agent_state"

# In macOS zsh, this prompts without echoing the token.
read -r -s "token_agent_secret?Paste NOW_PLAYING_TOKEN: "
printf '\n'
printf '%s\n' "$token_agent_secret" > "$agent_state/token"
chmod 600 "$agent_state/token"
unset token_agent_secret
```

Run once interactively before installing the LaunchAgent:

```bash
/usr/local/bin/now-playing-agent version
/usr/local/bin/now-playing-agent status
/usr/local/bin/now-playing-agent once
```

macOS should ask whether the agent may control Music. Choose Allow. If it was
previously denied, open System Settings, then Privacy & Security, then
Automation, and enable Music access for the agent. Accessibility and Full Disk
Access are not required.

## Run at login

The agent stays alive in the logged-in Aqua session and checks every five
seconds while idle and every two seconds while playing. It publishes song
changes, resumes, metadata changes, and seeks over one second as soon as detected.
Otherwise it sends a heartbeat every five seconds, waking at the deadline when
needed. It clears the public state when Music pauses or stops. Artwork is read
after the playback update and its key is published on the following check, so
image conversion cannot hold up the initial song update. A crash or lost
network still disappears from the website after the server's 30-second stale
cutoff.

```bash
mkdir -p "$HOME/Library/LaunchAgents"

sed "s/YOUR_USERNAME/$USER/g" \
  ./dev.leodeng.now-playing-agent.plist.example \
  > "$HOME/Library/LaunchAgents/dev.leodeng.now-playing-agent.plist"

plutil -lint "$HOME/Library/LaunchAgents/dev.leodeng.now-playing-agent.plist"

launchctl bootout \
  "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/dev.leodeng.now-playing-agent.plist" \
  2>/dev/null || true

launchctl bootstrap \
  "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/dev.leodeng.now-playing-agent.plist"

launchctl kickstart -k \
  "gui/$(id -u)/dev.leodeng.now-playing-agent"
```

Inspect it with:

```bash
launchctl print "gui/$(id -u)/dev.leodeng.now-playing-agent"
tail -n 30 /tmp/dev.leodeng.now-playing-agent.log
tail -n 30 /tmp/dev.leodeng.now-playing-agent.err
curl -i https://leodeng.dev/api/now-playing
```

## Commands

```text
now-playing-agent run      watch and publish continuously
now-playing-agent once     publish or clear once
now-playing-agent clear    clear the public state
now-playing-agent status   inspect local Music state and configuration
now-playing-agent version  print the build version
```

The server, token file, interval, and artwork publishing can be changed with
flags. Run `now-playing-agent <command> -h` for details.

Adaptive timing flags are `--interval=5s` (idle), `--playing-interval=2s`,
and `--heartbeat=5s`. Existing LaunchAgents with `--interval=10s` should change
that argument to `5s`; new binaries use the other two defaults automatically.

## Updating an existing installation

The update bundle includes the binary, checksum, LaunchAgent template, and
`install-update.sh`. Extract it on the Mac and run `bash install-update.sh`.
It verifies the binary, signs it locally, backs up the previous LaunchAgent,
installs the new one with artwork enabled, and reloads it. The existing token
file is preserved. The template uses `https://leodeng.dev`; custom server or
token-file arguments need to be carried over manually before installation.
Run the script from your normal desktop user, never with `sudo bash`. Only
binary installation needs elevation; the GUI LaunchAgent belongs to your user.
The installer enables the agent and retries registration briefly after unloading
it. If bootstrap still fails, it prints diagnostic commands rather than trying
to register a GUI job as root.

## Offline listening history

The agent now records listening sessions to a private on-disk queue and syncs
them to SuperServer, independently of live website updates. Configure a separate
`history-token` file with the listening receiver's token. Defaults try
`http://100.64.0.2:8791` and then `http://192.168.3.61:8791` every minute.
Missing connectivity or a missing sync token leaves history safely queued.
See `homelab/listening/README.md` in the website repository for server setup,
counting rules, privacy, retention, and Mac token configuration.
