# AI chat

`/daily` is a streaming DeepSeek site guide. Pages Functions call
`https://api.deepseek.com/chat/completions` using `deepseek-flash` and the
server-only `DEEPSEEK_API_KEY` secret. Chat Completions supports both answer and
reasoning deltas directly without an SDK. The model receives selected public
site content and up to four completed exchanges from the same browser session.
It has no tools, filesystem, shell or homelab access. Reasoning is displayed as
model-generated text, not verification of the answer.

## Deployment

Keep `HOMELAB_DB` and the private `DAILY_AI_TRAFFIC` service binding in Pages.
Set `DEEPSEEK_API_KEY` in the Pages project's production environment. Never put
it in a `VITE_` variable or forward it to the browser or another Worker.

For an existing installation, apply the cloud chat migration, deploy the private
coordinator, then deploy Pages:

```bash
npx wrangler d1 execute leodeng-homelab --remote --file homelab/migrations/0006_cloud_ai_chat.sql
npx wrangler deploy --config workers/daily-ai-traffic/wrangler.jsonc
npm run build
```

Fresh D1 installations can use `homelab/schema.sql`. The migration removes the
old fixed-question tables. The Worker's v2 migration deletes the old LiveHub
namespace and its cached local responses. There are no public Worker routes.
The retired `/api/internal/daily-ai` and `/api/internal/daily-ai-live` endpoints
return 404.

## Limits and admin controls

Each IP gets five messages per Beijing calendar day. The private SQLite Durable
Object admits at most 50 public messages per day and three concurrent replies.
D1 atomically reserves personal slots. Accepted provider attempts count even on
failure. Rejected admissions release the personal slot. Model thinking is
optional, with a 4,096 output-token cap when enabled and 1,024 when disabled.
Requests time out after 115 seconds. These are request caps, not a monetary cap.

The authenticated admin panel can disable chat, clear quotas and bans, unban an
IP, and add or remove whitelist entries. Whitelisted IPs bypass personal and
sitewide daily caps, but not validation, traffic limits or concurrency limits.
Only whitelist IPs you trust, since an IP can be shared. Clearing limits retains
the whitelist. In-flight replies check the kill switch every two seconds and
are invalidated by a control revision change.

Browser history uses a random HttpOnly cookie, separate from the IP used for
quotas. The coordinator retains up to 20 exchanges until the next Beijing
midnight; only the last four completed exchanges are sent to the provider.
Quota rows older than seven days are pruned on subsequent chat submissions.
IP bans remain until removed by an administrator. Curl/Python user agents and
malformed input are banned as configured by the site owner. Cross-site browser
requests are rejected before creating a ban.

## Remove the former homelab agent

After a successful cloud response, delete the obsolete Pages secret and remove
the feature-specific local service:

```bash
npx wrangler pages secret delete DAILY_AI_TOKEN --project-name leodeng-dev
sudo bash homelab/remove-daily-ai.sh
```

The removal script stops and removes the Daily AI units, scripts, state and
private configuration. It preserves the existing Ollama installation, models
and loopback-only binding. The chat feature no longer contacts Ollama.
