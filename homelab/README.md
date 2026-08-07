# Homelab status

Live status for [/homelab](https://leodeng.dev/homelab) and Claude Code token
usage for [/tokens](https://leodeng.dev/tokens).

The server is behind Headscale with no inbound path from the internet, so this
is a **push** model — nothing on Cloudflare ever reaches the machine:

```
home server                      Cloudflare Pages            leodeng.dev
┌──────────────┐  POST heartbeat ┌─────────────────┐  D1     ┌──────────┐
│ agent.sh     │ ───────────────>│ /api/homelab    │ ──────> │ /homelab │
│ systemd timer│  Bearer <token> │  POST = ingest  │ insert  │  fetches │
│ every 60s    │                 │  GET  = public  │ <────── │  GET     │
│              │                 └─────────────────┘  select └──────────┘
│              │  POST tokens    ┌─────────────────┐  D1     ┌──────────┐
│ + tokens.py  │ ───────────────>│ /api/tokens     │ ──────> │ /tokens  │
│   on change, │  Bearer <token> │  POST = ingest  │ upsert  │  fetches │
│   ≤ 1/10min  │                 │  GET  = public  │ <────── │  GET     │
└──────────────┘                 └─────────────────┘  select └──────────┘
```

One timer, one secret, two endpoints — it's the same agent on the same machine,
and a second token would be another thing to rotate protecting the same
boundary.

## What's published

**Heartbeat:** uptime, load average, memory, CPU temperature. That's the whole
list.

**Tokens:** per day and per model — input, output, cache-write and cache-read
token counts, and how many API responses and distinct sessions there were.

Deliberately **not** published: hostnames, addresses, service or container
names, versions, disk layout — and, for tokens, prompts, file paths, session
IDs, and project or repository names. A public endpoint that enumerates what
you run is free reconnaissance for anyone who finds it, and the names of the
private repos I use Claude on are nobody's business. Token counts are a fun
number; the directory listing they came from is not. If you extend the agent,
keep that line.

## Cloudflare setup

One time, from the repo root:

```bash
# 1. Create the database and apply the schema
npx wrangler d1 create leodeng-homelab
npx wrangler d1 execute leodeng-homelab --remote --file=homelab/schema.sql

# 2. Generate the shared secret — keep this, you need it again below
openssl rand -hex 32
```

Then in the Cloudflare dashboard, **Pages → leodeng-dev → Settings → Functions**:

| Binding | Type | Value |
| --- | --- | --- |
| `HOMELAB_DB` | D1 database | `leodeng-homelab` |
| `HOMELAB_TOKEN` | Secret (encrypted) | the hex string from step 2 |

Add both to **Production**. Add them to Preview too if you want the endpoint
live on preview deployments — a separate database is wise there, so test
heartbeats don't land in the real series.

Ingest fails closed: with `HOMELAB_TOKEN` unset the endpoint returns 503 rather
than accepting anonymous writes.

## Server setup

```bash
sudo install -m 755 homelab/agent.sh  /usr/local/bin/homelab-agent.sh
sudo install -m 755 homelab/tokens.py /usr/local/bin/homelab-tokens.py

# The token, readable only by root
printf 'HOMELAB_TOKEN=%s\n' 'the-hex-string' | sudo tee /etc/homelab-status.env >/dev/null
sudo chmod 600 /etc/homelab-status.env

sudo cp homelab/homelab-status.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-status.timer
```

**Edit `User=`, `Group=` and `CLAUDE_PROJECTS_DIR=` in the unit** to whoever
runs Claude Code on the box. The heartbeat alone ran under `DynamicUser=yes`;
the token rollup can't, because `~/.claude/projects` is mode 700 and a per-boot
dynamic UID cannot read it. Relaxing those permissions instead would expose
every transcript to every account on the machine, so the service runs as the
real user and gives back the isolation a different way: `ProtectHome=tmpfs`
replaces the home directory with an empty one, and a single `BindReadOnlyPaths`
mounts just the transcripts back in. The agent can read those and nothing else
under `/home` — not SSH keys, not `.dev.vars`, not the rest of `~/.claude`,
which holds OAuth credentials.

If the box has no Claude Code on it, install only `agent.sh`: a missing
`homelab-tokens.py` (or a missing `python3`) is skipped and the heartbeat is
unaffected.

Check it:

```bash
sudo systemctl start homelab-status.service   # push once, now
journalctl -u homelab-status.service -n 20    # curl --fail means errors show here
systemctl list-timers homelab-status.timer    # next scheduled run
curl -s https://leodeng.dev/api/homelab | jq  # what the site sees
curl -s https://leodeng.dev/api/tokens  | jq '.totals, .today'
```

`Type=oneshot` plus a timer rather than a long-running daemon: there's nothing
to keep in memory between pushes, and a crashed daemon is a silent failure
whereas a failed timer run is right there in the journal.

## Token counting

`tokens.py` reads the JSONL transcripts Claude Code writes under
`~/.claude/projects` and rolls them up per day and per model. Three things in
there are less obvious than they look:

**Deduplicate on `(message.id, requestId)`.** Claude Code rewrites a message's
line as a turn develops, so one API response appears three or four times in a
single transcript, and resuming a session copies earlier turns into the new
file. On this machine that was 6,294 duplicate lines against 6,318 real ones —
summing the raw lines roughly *doubles* every number.

**Bucket days in local time.** Transcript timestamps are UTC. Bucketing on the
raw string puts an evening session in Beijing on the following day, which is
not the day the work happened.

**Keep the two cache-write TTLs apart.** Cache writes bill at 1.25× the input
rate for the 5-minute cache and 2× for the 1-hour one, and Claude Code uses
1-hour entries almost exclusively. Folding them together understates the cost
of a cache-heavy workload badly.

Pushes are throttled: the rollup goes out when the numbers change, and at most
once every 10 minutes either way. A routine push carries only the trailing 7
days — older rows can't change any more, and re-sending the whole history on
every push is what would eventually outgrow the free write allowance. The first
push (no state file yet) sends everything to backfill; `--full` forces that
again.

The dollar figure on the page is Anthropic **list price** for the same tokens.
It is not a bill — this usage is on a subscription, so none of it was charged
per token, and the page says so rather than showing a bare number that reads as
money spent.

## Retention

**Heartbeats** are pruned: the ingest drops rows older than 24h on every write,
so the table is a fixed-size rolling window — about 1,440 rows — rather than
something that grows forever. The page charts exactly that window in 12-minute
buckets, so the database holds what's on screen and not one row more.

Consequence worth knowing: retention matches the chart window, so while the
agent is down the window keeps pruning with nothing arriving to replace it. A
box that's been offline a full day shows an empty chart. That's honest — there
is nothing to plot.

**Token rows are never deleted**, which is the opposite decision for the
opposite reason. Claude Code prunes old transcripts, so the agent eventually
can't see a day it once reported. If the table pruned too, that day would
vanish from a total that is supposed to be all-time. D1 is the only durable
copy, so it keeps everything: one row per day per model, a few hundred bytes a
day, indefinitely.

## Cost

Nothing, and on Cloudflare's Free plan nothing is the only possible answer:
exceeding a daily limit returns errors until 00:00 UTC, it does not bill.

| | free/day | this uses | headroom |
| --- | --- | --- | --- |
| Rows written | 100,000 | 2,880 heartbeat + ≤2,450 token | ~19× |
| Rows read | 5,000,000 | ~1,441 per *uncached* heartbeat GET | see below |
| Storage | 5 GB | ~145 KB heartbeat + ~200 B/day forever | ~34,000× |

Reads are the only line worth watching, and the 30s edge cache caps them at
~2,880 origin hits per colo per day. Bucketing happens in SQL rather than by
shipping 1,440 rows to the Function and averaging them there.

The token line stays flat as history accumulates, which is the whole reason a
routine push only carries seven days: at ~17 rows a push and a 10-minute
floor, that's ≤2,450 writes a day this year and the same number in five years.
Pushing the full history instead would cross the daily limit inside a year.

Workers KV was the obvious first choice for "store one live value", but its
free tier caps writes at 1,000/day — a one-minute interval blows straight
through that, whereas D1 with a full day of history sits at 2.9%.
