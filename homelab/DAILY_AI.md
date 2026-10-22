# Daily AI

Five fixed questions at `/daily`, with one daily batch produced on the homelab.
Visitors never contact Ollama, start GPU work, send free text, or affect prompts.
The feature starts disabled. No model is downloaded automatically.

## Cloudflare setup

1. Apply `homelab/migrations/0003_daily_ai.sql` to the existing `HOMELAB_DB`
   D1 database. The same SQL is included in `homelab/schema.sql` for fresh setups.
2. Set a new **secret** `DAILY_AI_TOKEN` on the Pages project. Use a separate
   random token, not the GitHub OAuth or heartbeat token. Give the identical
   value to the publisher. The token can publish batches and read the generation
   lease; it cannot change the kill switch, remove bans or access the admin API.
3. Deploy the site, including the generated `/daily-ai-context.json` asset.
4. Open `/admin`, select **Daily AI**, and enable it when the model is ready.

The admin endpoint uses the existing GitHub allowlist/session and requires a
same-origin custom-header request. Local Vite file-editor sessions deliberately
cannot operate the production controls. Preview deployments should use a
separate D1 binding and secret.

## Homelab setup

Ollama is already running on `127.0.0.1:11434`. Keep it loopback-only. Do not
create a tunnel, forward port 11434, or give the model tools or host filesystem
access. Ollama should run under its own restricted account, separate from your
personal user. A GPU VM is not required for this push-only design. The publisher
runs as a separate dynamic service user with the home directories hidden.

Download your chosen quantized model separately. Check its actual memory use
on the 24 GB GPU. Set the exact local tag from `ollama list`; the Hugging Face
repository name is not necessarily an Ollama tag. Prefer a dedicated local tag
so unloading it cannot interfere with another application using the same model.

For superserver, the prepared model is `qwen3.8:27b` (Q4_K_M). The publisher
defaults to `DAILY_AI_GPU_LAYERS=40` out of 65 model layers, leaving other layers
on the CPU to preserve GPU memory for other applications. This is a layer limit,
not a hard VRAM or GPU compute partition. Actual memory use must be measured.

If setup has already prepared `/home/leodeng/.config/leodeng-daily-ai/env`, run:

```bash
sudo bash homelab/install-daily-ai.sh /home/leodeng/.config/leodeng-daily-ai/env --loopback
```

The optional `--loopback` flag restricts Ollama to `127.0.0.1:11434` and restarts
it, so direct access from other LAN machines stops. Omit that flag if existing
LAN applications still require Ollama. The installer refuses to restart it while
models are loaded and refuses to overwrite a differing `/etc/daily-ai.env`.
It installs the restricted publisher service and starts the hourly timer.

```bash
sudo install -d -m 755 /usr/local/lib/daily-ai
sudo install -m 644 homelab/daily_ai.py /usr/local/lib/daily-ai/daily_ai.py
sudo install -m 600 homelab/daily-ai.env.example /etc/daily-ai.env
# Edit /etc/daily-ai.env locally: publishing secret and exact model tag.
sudoedit /etc/daily-ai.env
sudo install -m 644 homelab/daily-ai.service homelab/daily-ai.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start daily-ai.service
sudo journalctl -u daily-ai.service -n 30
sudo systemctl enable --now daily-ai.timer
```

The timer checks hourly to recover after downtime or a failed batch, but the
publisher skips GPU work if today's complete batch is already published or the
feature is disabled. A local lock prevents overlapping publishers. The server
accepts only the first complete five-answer batch for each Beijing calendar day.
Inference is bounded to 8K context and 512 output tokens per answer, with thinking
disabled. Confirm your model supports `think: false`. The model is kept loaded
between the five answers, then explicitly unloaded, including on failure.

Only approved, published site pages and posts enter the static context bundle.
The publisher additionally reads the public homelab/token counters. It never
reads local transcripts, drafts, private projects, directory listings or keys.
Article selection and prompts are predefined. Source links come from the
publisher's allowlist, not generated URLs. The model outputs escaped plain text.

## Controls, limits and bans

- `/api/daily-ai` accepts GET status and POST `{"id":"homelab"}` (or one of the
  other four fixed IDs), with `Content-Type: application/json` and `X-Daily-AI: 1`.
  Query parameters, unknown IDs/fields, wrong methods/headers and invalid or
  oversized JSON cause permanent bans. curl/Python/httpx/aiohttp user agents are
  also banned. User-agent checks are easy to spoof, not an authentication system.
- The IP comes only from Cloudflare's `CF-Connecting-IP`, never X-Forwarded-For
  or submitted fields. Alternate IPv6 forms are canonicalized. Each IP may
  choose one question per Beijing day; atomic D1 inserts prevent concurrent
  selections. GET can reopen that same answer. A second valid POST returns 429,
  not a ban. Shared networks share the quota. New IPs can bypass IP-only limits.
- Bans affect **only the AI endpoint**. They do not block the site or admin.
  Cross-site browser requests are rejected without creating a ban, so a hostile
  site cannot ban its visitors by embedding your API in a form or image.
- The kill switch uses uncached primary D1 reads. It blocks new answers and
  publishing, increments a generation revision and invalidates work already
  running, even if you quickly enable the feature again. The publisher polls
  the switch about every three seconds during inference (plus control-request
  latency, at most ten seconds), cancels its HTTP subprocess and requests unload.
  It cannot recall an answer a visitor already downloaded. Open visible pages
  recheck status every minute. Unread answers are not shipped in the status API.
- Bans are permanent until removed in `/admin` and store IP, reason and time.
  Daily quota records are pruned after seven days on a successful new publish.
  These practices are disclosed on `/daily` and `/privacy`. Review bans when
  addresses are reassigned; unbanning does not reset the daily allowance.

For a local emergency independent of the website:

```bash
sudo systemctl stop daily-ai.timer daily-ai.service
ollama stop YOUR_DEDICATED_MODEL_TAG
```

Stopping the timer/service prevents further publisher work. Use the web kill
switch as well to stop serving answers already stored on Cloudflare.

## HTTP traffic protection

Every visitor GET and POST calls the private `DAILY_AI_TRAFFIC` service binding
before accessing D1, including requests through Pages aliases. Deploy it with:

```bash
npx wrangler deploy --config workers/daily-ai-traffic/wrangler.jsonc
```

In both Pages production and preview settings, bind `DAILY_AI_TRAFFIC` to the
`leodeng-daily-ai-traffic` Worker. It has no public routes, workers.dev address,
or preview URLs. The binding carries only Cloudflare's canonical client IP,
never the visitor's body or arbitrary headers. Missing or failed protection
returns 503 without querying D1.

The edge budgets are 10 requests per minute per IP and 300 requests per minute
across all visitors, per Cloudflare location. These approximate counters reduce
HTTP flooding; the strict one-question-per-IP-per-day allowance still uses D1's
unique constraint. Excess traffic returns temporary HTTP 429 with `Retry-After:
60`, without creating a permanent ban. Malformed requests that pass the traffic
gate still follow the permanent-ban policy. The admin kill switch and authenticated
publisher do not share these visitor budgets.

This protects database access, not total Pages/Worker invocation counts, and is
not a strict worldwide spending cap. Cloudflare's platform DDoS protection still
handles network-level floods. Do not replace this with D1 counters: that would
make each blocked request consume database work again.
