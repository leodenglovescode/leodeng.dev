# Daily AI

`/daily` lets visitors choose one of five fixed questions. The homelab generates
the selected answer live. Thinking and answer tokens travel over a private
outbound WebSocket and are streamed to the page as SSE, with no fake typing or
saved daily batch standing in for a live generation. Completed answers can be
reopened for the same IP and Beijing calendar day.

The model's own `thinking` field is shown separately as escaped text. It is
model-generated commentary, may be inaccurate and does not verify the answer.
No tools, shell commands, visitor text, private files or transcripts reach the
model. Both language versions use the same five fixed IDs. The classic site
links to the modern page because its HTML-only presentation has no live chat UI.

## Cloudflare setup

The existing Pages project uses `HOMELAB_DB` and the separate secret
`DAILY_AI_TOKEN`, shared only with the homelab agent. Never expose this token in
`VITE_` variables, HTML, commands or logs.

```bash
npx wrangler d1 execute leodeng-homelab --remote --file homelab/migrations/0003_daily_ai.sql
npx wrangler d1 execute leodeng-homelab --remote --file homelab/migrations/0004_daily_ai_live.sql
npx wrangler d1 execute leodeng-homelab --remote --file homelab/migrations/0005_daily_ai_five_requests.sql
npx wrangler deploy --config workers/daily-ai-traffic/wrangler.jsonc
```

Bind Pages `DAILY_AI_TRAFFIC` to `leodeng-daily-ai-traffic` in production and
preview. Preview should have its own D1 and secret. The Worker has no routes,
workers.dev URL, or preview URLs. Its SQLite Durable Object coordinates one
physical GPU runner, persists bounded output, and uses WebSocket hibernation
while idle. It never queries D1 for token updates or visitor traffic limiting.

The authenticated `/api/internal/daily-ai-live` WebSocket accepts only the
homelab's bearer token. No token in a query string and no browser authentication
can connect a runner. Browsers use `/api/daily-ai` exclusively. The agent also
uses the authenticated `/api/internal/daily-ai` GET for kill-switch leases.
The five-request migration preserves existing selections as the first used slot.
Apply it once to an existing one-request schema; fresh databases use schema.sql.
The earlier batch table is retained for backwards compatibility, but live
answers do not depend on it.

## Homelab upgrade

The installer switches from the hourly batch timer to a continuously connected,
restricted service. Existing private configuration and loopback Ollama remain
unchanged. The Debian/Ubuntu `python3-websocket` package is required; the
installer installs it only if absent. No system pip packages are needed.

From this repository, run:

```bash
sudo bash homelab/install-daily-ai.sh /home/leodeng/.config/leodeng-daily-ai/env
```

For a first installation that still needs to restrict the Ollama listener, add
`--loopback`. That restarts Ollama and refuses while a model is loaded.

The service runs as a dynamic user with `ProtectHome=yes`, private devices,
a read-only system, no capabilities and no privilege escalation. Ollama remains
on `127.0.0.1:11434`, under its own account, with no tunnel or inbound port.
Only the agent connects out to Cloudflare. It does not listen on a local port.

The installed model is `qwen3.8:27b`, Q4_K_M. `DAILY_AI_GPU_LAYERS=40` limits
offloading to preserve space on the 24 GB GPU; this is not a hard GPU partition.
Inference uses an 8K context, thinking enabled and a combined 2048-token output
budget. There is one generation at a time, at most three outstanding jobs, a
10-minute job deadline and a shared 50-start daily compute budget. The model unloads
after every request, including failures and cancellation.

The agent reads only the generated public `/daily-ai-context.json` and bounded
public homelab/token counters. Published article selection and sources are fixed
by trusted code, not generated model URLs. Refreshing replays real persisted
output rather than starting another inference. Failed jobs refund their daily
selection; used compute still counts until an admin resets it.

```bash
systemctl status daily-ai.service --no-pager
sudo journalctl -u daily-ai.service -n 30 --no-pager
# Independent emergency stop, also use the website kill switch:
sudo systemctl stop daily-ai.service
ollama stop qwen3.8:27b
```

## Controls, limits and bans

- `/api/daily-ai` accepts only GET status/replay and POST `{"id":"site"}` with
  JSON and `X-Daily-AI: 1`. `Accept: text/event-stream` requests streaming. No
  text fields, client-provided job IDs, queries or additional JSON fields.
- IPs come only from canonicalized Cloudflare `CF-Connecting-IP`. Malformed
  visitor requests and curl/Python/httpx/aiohttp user agents cause permanent
  AI-only bans. User-agent checks are spoofable. Cross-site browser requests
  are rejected before they can create bans.
- Traffic passes the private gate before D1 on every Pages hostname. Approximate
  budgets are 10 requests per minute per IP and 300 per minute overall, per
  location. Excess traffic returns 429 and `Retry-After: 60`, without a permanent
  ban. Missing or failed traffic protection returns 503 before D1.
- The daily allowance uses five atomic D1 slots per IP and day. Each IP can start five
  generations per Beijing day, including repeats; shared networks share an allowance. An offline or
  full queue does not consume it. Failed/cancelled jobs can be retried. New IPs
  can bypass IP-only limits; the runner's global queue and compute budget still
  apply. This is not a strict worldwide HTTP spending cap.
- The admin kill switch blocks new reads and claims in primary D1, increments
  the generation revision and cancels relay jobs/streams immediately. The agent
  independently checks the revision every three seconds during inference
  (plus control-request latency up to ten seconds), terminates its subprocess
  and requests model unload. Already delivered text cannot be recalled.
- **Clear all AI limits** is a single authenticated admin action: it cancels
  outstanding work, resets traffic and compute counter namespaces, clears all
  daily allowances and bans, and invalidates old generation leases. It preserves
  the current enabled/disabled setting. GitHub allowlist authentication,
  same-origin checks and `X-Admin: 1` are required. Visitor requests cannot invoke
  this action. Admin requests and the authenticated runner are outside visitor
  traffic budgets so emergency controls remain usable.
- Answers and model thinking are retained for about seven days with daily relay
  cleanup. Daily D1 records are pruned on accepted selections; permanent bans
  remain until individually removed or cleared by the admin. IPs never reach
  the homelab or model. These practices are disclosed on `/privacy`.

## Verification

```bash
node --test functions/tests/daily-ai*.test.js
python3 -m unittest discover -s homelab -p 'test_daily_ai*.py' -v
npm --ignore-scripts run build
```

The integration test runs a real local Cloudflare runtime with SQLite Durable
Objects, a mock runner WebSocket and genuine streaming responses. It checks
incremental thinking/answer delivery, Unicode framing, replay, queue capacity,
cancellation and immediate traffic-counter reset. The Python tests check Ollama
stream bounds, distinct output channels and child termination on cancellation.
