// Live homelab status — the ingest and read endpoint behind /homelab.
//
// The server sits behind Headscale and is never reachable from the internet,
// so this is a push model: the box POSTs a heartbeat here every minute, and
// the website only ever reads what landed. Nothing about this endpoint can be
// used to reach the machine.
//
// Everything published here is deliberate. The agent sends uptime, load,
// memory and CPU temperature and nothing else — no hostnames, no addresses,
// no service or container names, no versions. A public endpoint that
// enumerates what you run is a free reconnaissance pass for anyone who finds
// it, and none of that would have made the page better.
import { json } from '../../lib/auth.js'

// Rows older than this are dropped on each ingest — nothing here is worth
// keeping, so the table stays a fixed-size rolling window rather than growing
// forever. Matched to the window the page charts, so the database holds
// exactly what's on screen and not one row more.
//
// The trade-off of matching them: while the agent is down the window keeps
// pruning with nothing arriving to replace it, so a box that's been offline
// for a day has an empty chart. That's honest — there's nothing to plot.
const RETENTION_SECONDS = 24 * 60 * 60

// The window the page charts, and the bucket it's averaged into: 24h at 12
// minutes a point is 120 points, about as much as a sparkline that size can
// actually resolve.
const WINDOW_SECONDS = 24 * 60 * 60
const BUCKET_SECONDS = 12 * 60

// Three missed heartbeats before the page calls it offline, so one dropped
// push (or a slow timer tick) doesn't flap the status.
const STALE_AFTER_SECONDS = 3 * 60

const MAX_BODY_BYTES = 2048
const EDGE_TTL_SECONDS = 30

// Compares in time independent of how many leading characters match, so a
// remote caller can't discover the token a byte at a time.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Anything outside the plausible range is a bug or a lie, and either way it
// would wreck the chart's y-axis for every later reading.
function num(value, min, max) {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

export async function onRequestPost({ request, env }) {
  // Fail closed: an unset secret must not mean "anyone may write".
  if (!env.HOMELAB_TOKEN) return json({ error: 'ingest not configured' }, 503)
  if (!env.HOMELAB_DB) return json({ error: 'database not bound' }, 503)

  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!timingSafeEqual(token, env.HOMELAB_TOKEN)) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return json({ error: 'payload too large' }, 413)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const uptime = num(body.uptime, 0, 60 * 60 * 24 * 3650)
  const load1 = num(body.load1, 0, 1024)
  const memTotal = num(body.memTotal, 1, 2 ** 50)
  const memUsed = num(body.memUsed, 0, 2 ** 50)

  if (uptime === null || load1 === null || memTotal === null || memUsed === null) {
    return json({ error: 'missing or invalid: uptime, load1, memUsed, memTotal' }, 400)
  }
  if (memUsed > memTotal) return json({ error: 'memUsed exceeds memTotal' }, 400)

  // The clock that matters is Cloudflare's, not the homelab's.
  const ts = Math.floor(Date.now() / 1000)

  const db = env.HOMELAB_DB
  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO heartbeat
         (ts, uptime, load1, load5, load15, cpus, mem_used, mem_total, temp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ts,
      Math.round(uptime),
      load1,
      num(body.load5, 0, 1024),
      num(body.load15, 0, 1024),
      num(body.cpus, 1, 4096),
      Math.round(memUsed),
      Math.round(memTotal),
      num(body.temp, -50, 150),
    ),
    db.prepare('DELETE FROM heartbeat WHERE ts < ?').bind(ts - RETENTION_SECONDS),
  ])

  return json({ ok: true, ts })
}

export async function onRequestGet({ request, env, waitUntil }) {
  // `_headers` sends `no-store` to browsers for everything under /api/, which
  // is right for a live status. This cache is internal to the Function, so the
  // refetches that produces still collapse onto one D1 read every 30s.
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const cacheKey = new Request(new URL(request.url).origin + '/api/homelab', { method: 'GET' })

  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
  }

  if (!env.HOMELAB_DB) return json({ seen: false, online: false, error: 'database not bound' }, 503)

  const now = Math.floor(Date.now() / 1000)
  const db = env.HOMELAB_DB

  const [latestResult, seriesResult] = await db.batch([
    db.prepare('SELECT * FROM heartbeat ORDER BY ts DESC LIMIT 1'),
    // Bucket in SQL rather than shipping 1,440 rows to the Function and
    // averaging them here. BUCKET_SECONDS is a constant in this file, never
    // input, so interpolating it is safe.
    db.prepare(
      `SELECT (ts / ${BUCKET_SECONDS}) * ${BUCKET_SECONDS} AS t,
              AVG(load1)     AS load1,
              AVG(mem_used)  AS mem_used,
              AVG(mem_total) AS mem_total,
              AVG(temp)      AS temp,
              MAX(cpus)      AS cpus
         FROM heartbeat
        WHERE ts >= ?
        GROUP BY t
        ORDER BY t`,
    ).bind(now - WINDOW_SECONDS),
  ])

  const latest = latestResult.results?.[0] ?? null
  const age = latest ? now - latest.ts : null

  const body = {
    // "No heartbeat ever recorded" reads differently from "it stopped
    // arriving", and the page says which rather than showing a hopeful zero.
    seen: Boolean(latest),
    online: Boolean(latest) && age <= STALE_AFTER_SECONDS,
    now,
    lastSeen: latest?.ts ?? null,
    ageSeconds: age,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    current: latest && {
      uptime: latest.uptime,
      load1: latest.load1,
      load5: latest.load5,
      load15: latest.load15,
      cpus: latest.cpus,
      memUsed: latest.mem_used,
      memTotal: latest.mem_total,
      temp: latest.temp,
    },
    history: (seriesResult.results ?? []).map(r => ({
      t: r.t,
      load1: r.load1 == null ? null : Math.round(r.load1 * 100) / 100,
      cpus: r.cpus,
      memPct: r.mem_total ? Math.round((r.mem_used / r.mem_total) * 1000) / 10 : null,
      temp: r.temp == null ? null : Math.round(r.temp * 10) / 10,
    })),
  }

  const response = json(body, 200, {
    'cache-control': `public, max-age=${EDGE_TTL_SECONDS}`,
  })

  if (cache) waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
