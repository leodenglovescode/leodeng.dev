# Token agent

`token-agent` collects exact Codex token counters from local session logs and
sends counts-only records to the super server over Headscale. The super server
deduplicates them and the existing `homelab/tokens.py` process imports them into
its SQLite archive before pushing the combined daily rollup to Cloudflare D1.

No prompt, response, file path, project name, hostname or Codex credential is
sent. The wire record contains token counts, model, time, a random device ID,
and hashes used to deduplicate responses and sessions.

```text
Mac Codex logs -> local archive -> 100.64.0.2:9464 -> hub inbox
                                                        |
super server Codex logs -> homelab/tokens.py <-----------+
                                  |
                                  v
                         /api/tokens -> D1 -> website
```

## Build

From this directory:

```bash
make all
```

This produces:

- `bin/token-agent-darwin-arm64` for the M-series Mac
- `bin/token-agent-linux-amd64` for the super server

`bin/` and the local Go build cache are ignored by Git.

## Set up the super server

Generate one credential for this Mac. It is separate from `HOMELAB_TOKEN`:

```bash
openssl rand -hex 32
```

Save the value, then install the already-built Linux binary and service:

```bash
sudo install -m 755 bin/token-agent-linux-amd64 /usr/local/bin/token-agent
printf 'TOKEN_AGENT_TOKEN=%s\n' 'PASTE_THE_TOKEN' | sudo tee /etc/token-agent.env >/dev/null
sudo chmod 600 /etc/token-agent.env
sudo cp token-agent-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now token-agent-hub.service
```

The service binds only to `100.64.0.2:9464`. Verify it from the server:

```bash
curl http://100.64.0.2:9464/health
journalctl -u token-agent-hub.service -n 20
```

Install the updated homelab collector files so it imports the hub inbox:

```bash
sudo install -m 755 ../homelab/tokens.py /usr/local/bin/homelab-tokens.py
sudo cp ../homelab/homelab-status.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart homelab-status.timer
sudo systemctl start homelab-status.service
```

The hub archive is `/var/lib/token-agent/inbox.jsonl`. It is append-only and
contains normalized counts, not transcript content. The existing collector
imports it idempotently using the same Codex response key as local logs.

## Set up the Mac

Copy `bin/token-agent-darwin-arm64` to the Mac, then:

```bash
sudo mkdir -p /usr/local/bin
sudo install -m 755 token-agent-darwin-arm64 /usr/local/bin/token-agent

agent_state="$HOME/Library/Application Support/dev.leodeng.token-agent"
mkdir -p "$agent_state"
chmod 700 "$agent_state"
printf '%s\n' 'PASTE_THE_SAME_TOKEN' > "$agent_state/token"
chmod 600 "$agent_state/token"
```

This is an unsigned local build. If macOS marks the copied file as
quarantined, remove that attribute from this binary after verifying its
checksum:

```bash
xattr -d com.apple.quarantine /usr/local/bin/token-agent
```

Run it by hand first:

```bash
/usr/local/bin/token-agent run
/usr/local/bin/token-agent status
```

The defaults are:

- Codex logs: `~/.codex/sessions`
- Hub: `http://100.64.0.2:9464`
- State: `~/Library/Application Support/dev.leodeng.token-agent`
- Batch size: 500 responses

The local archive means a disconnected Mac can keep collecting. Sync retries
are safe because the hub deduplicates every response by its stable Codex key.

## Run automatically on macOS

Copy `dev.leodeng.token-agent.plist.example` to
`~/Library/LaunchAgents/dev.leodeng.token-agent.plist`, replace
`YOUR_USERNAME`, and load it:

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.leodeng.token-agent.plist"
launchctl kickstart -k "gui/$(id -u)/dev.leodeng.token-agent"
```

It runs once at login and every five minutes. To inspect it:

```bash
launchctl print "gui/$(id -u)/dev.leodeng.token-agent"
tail -n 30 /tmp/dev.leodeng.token-agent.err
```

## Commands

```text
token-agent run      collect and sync
token-agent collect  collect without network access
token-agent sync     send queued events
token-agent status   show archive and queue counts
token-agent hub      run the private ingest service
token-agent version  print the version
```

All client paths and the server URL can be overridden with command flags. Run
`token-agent <command> -h` for the relevant options.
