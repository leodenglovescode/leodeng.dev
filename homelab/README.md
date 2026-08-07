# Homelab status

Live status for [/homelab](https://leodeng.dev/homelab).

The server is behind Headscale with no inbound path from the internet, so this
is a **push** model — nothing on Cloudflare ever reaches the machine:

```
home server                      Cloudflare Pages            leodeng.dev
┌──────────────┐  POST heartbeat ┌─────────────────┐  D1     ┌──────────┐
│ agent.sh     │ ───────────────>│ /api/homelab    │ ──────> │ /homelab │
│ systemd timer│  Bearer <token> │  POST = ingest  │ insert  │  fetches │
│ every 60s    │                 │  GET  = public  │ <────── │  GET     │
└──────────────┘                 └─────────────────┘  select └──────────┘
```

## What's published

Uptime, load average, memory, CPU temperature. That's the whole list.

Deliberately **not** published: hostnames, addresses, service or container
names, versions, disk layout. A public endpoint that enumerates what you run is
free reconnaissance for anyone who finds it, and none of it made the page
better. If you extend the agent, keep that line.

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
sudo install -m 755 homelab/agent.sh /usr/local/bin/homelab-agent.sh

# The token, readable only by root
printf 'HOMELAB_TOKEN=%s\n' 'the-hex-string' | sudo tee /etc/homelab-status.env >/dev/null
sudo chmod 600 /etc/homelab-status.env

sudo cp homelab/homelab-status.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-status.timer
```

Check it:

```bash
sudo systemctl start homelab-status.service   # push once, now
journalctl -u homelab-status.service -n 20    # curl --fail means errors show here
systemctl list-timers homelab-status.timer    # next scheduled run
curl -s https://leodeng.dev/api/homelab | jq  # what the site sees
```

`Type=oneshot` plus a timer rather than a long-running daemon: there's nothing
to keep in memory between pushes, and a crashed daemon is a silent failure
whereas a failed timer run is right there in the journal.

## Retention

The ingest drops rows older than 24h on every write, so the table is a
fixed-size rolling window — about 1,440 rows — rather than something that grows
forever. The page charts exactly that window in 12-minute buckets, so the
database holds what's on screen and not one row more.

Consequence worth knowing: retention matches the chart window, so while the
agent is down the window keeps pruning with nothing arriving to replace it. A
box that's been offline a full day shows an empty chart. That's honest — there
is nothing to plot.

## Cost

Nothing, and on Cloudflare's Free plan nothing is the only possible answer:
exceeding a daily limit returns errors until 00:00 UTC, it does not bill.

| | free/day | this uses | headroom |
| --- | --- | --- | --- |
| Rows written | 100,000 | 2,880 (1,440 inserts + 1,440 prune deletes) | 35× |
| Rows read | 5,000,000 | ~1,441 per *uncached* GET | see below |
| Storage | 5 GB | ~145 KB (1,440 rows × ~100 B) | ~34,000× |

Reads are the only line worth watching, and the 30s edge cache caps them at
~2,880 origin hits per colo per day. Bucketing happens in SQL rather than by
shipping 1,440 rows to the Function and averaging them there.

Workers KV was the obvious first choice for "store one live value", but its
free tier caps writes at 1,000/day — a one-minute interval blows straight
through that, whereas D1 with a full day of history sits at 2.9%.
