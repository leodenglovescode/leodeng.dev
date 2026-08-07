// Claude Code token usage — the ingest and read endpoint behind /tokens.
//
// Same push model as /api/homelab, for the same reason: the box that has the
// transcripts is behind Headscale and has no inbound path. It reuses
// HOMELAB_TOKEN rather than issuing a second secret — it's the same agent, on
// the same machine, pushed by the same systemd timer. A separate token would
// be two things to rotate protecting one trust boundary.
//
// What lands here is deliberately aggregate: per day, per model, token counts
// and a message count. No prompts, no file paths, no project or repository
// names, no session identifiers — only how many distinct sessions ran. Token
// counts say how much I used Claude; the names of the private repos I used it
// on are nobody's business, and once they're on a public endpoint they can't
// be taken back.
import { json } from '../../lib/auth.js'

// Unlike the heartbeat table, nothing here is ever deleted. The agent derives
// its numbers from transcripts on disk and Claude Code prunes those eventually,
// so this table is the only durable copy of an old day. Retention would delete
// history that no longer exists anywhere else.

// The page charts the last 90 days; all-time totals are computed over
// everything, so old rows still count even after they leave the chart.
const WINDOW_DAYS = 90

// The full history is a couple of kilobytes. This is headroom for a machine
// that has been running for years, not a target.
const MAX_BODY_BYTES = 512 * 1024
const MAX_ROWS = 4000

// D1 caps how much one batch can carry, and the whole payload is small enough
// that splitting it costs nothing.
const BATCH_SIZE = 100

const EDGE_TTL_SECONDS = 60

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/

// Anthropic list prices, USD per million tokens. Matched by longest prefix so
// a dated model id (claude-haiku-4-5-20251001) resolves without a table entry
// of its own.
//
// This is what the same tokens would have cost on the API at list price. It is
// not a bill: this usage is on a Claude subscription, so nothing here was
// charged per token. The page says so out loud — an unlabelled dollar figure
// would read as money spent.
const PRICES = [
  { prefix: 'claude-fable-5', label: 'Fable 5', input: 10, output: 50 },
  { prefix: 'claude-opus-5', label: 'Opus 5', input: 5, output: 25 },
  { prefix: 'claude-opus-4-8', label: 'Opus 4.8', input: 5, output: 25 },
  { prefix: 'claude-opus-4-7', label: 'Opus 4.7', input: 5, output: 25 },
  { prefix: 'claude-opus-4-6', label: 'Opus 4.6', input: 5, output: 25 },
  { prefix: 'claude-opus-4-5', label: 'Opus 4.5', input: 5, output: 25 },
  { prefix: 'claude-sonnet-5', label: 'Sonnet 5', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4-6', label: 'Sonnet 4.6', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4-5', label: 'Sonnet 4.5', input: 3, output: 15 },
  { prefix: 'claude-haiku-4-5', label: 'Haiku 4.5', input: 1, output: 5 },
]

// Cache tokens are priced as multiples of the model's input rate. Reads are
// the whole point of the cache; the two write rates differ by TTL, which is
// why the agent tracks them separately.
const CACHE_MULTIPLIERS = { read: 0.1, write5m: 1.25, write1h: 2 }

function priceFor(model) {
  let best = null
  for (const entry of PRICES) {
    if (model.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) {
      best = entry
    }
  }
  return best
}

// Compares in time independent of how many leading characters match, so a
// remote caller can't discover the token a byte at a time.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// A token count that isn't a non-negative integer is a bug or a lie. The upper
// bound is absurdly high on purpose — it only exists to keep a corrupt number
// from poisoning the all-time totals.
function count(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1e15) return null
  return Math.round(n)
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

  const days = Array.isArray(body.days) ? body.days : null
  if (!days || !days.length) return json({ error: 'missing days' }, 400)
  if (days.length > MAX_ROWS) return json({ error: 'too many rows' }, 400)

  const rows = []
  for (const row of days) {
    if (!Array.isArray(row) || row.length !== 8) {
      return json({ error: 'each day row must be 8 fields' }, 400)
    }
    const [day, model, ...rest] = row
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) {
      return json({ error: `invalid day: ${String(day).slice(0, 20)}` }, 400)
    }
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
      return json({ error: `invalid model: ${String(model).slice(0, 40)}` }, 400)
    }
    const numbers = rest.map(count)
    if (numbers.some(n => n === null)) {
      return json({ error: `invalid counts for ${day} ${model}` }, 400)
    }
    rows.push([day, model, ...numbers])
  }

  // Per-day session and project counts are optional — the day rows are the
  // part that matters, and an older agent that doesn't send these shouldn't
  // have its whole push rejected.
  const meta = []
  for (const row of Array.isArray(body.meta) ? body.meta : []) {
    if (!Array.isArray(row) || row.length !== 3) continue
    const [day, sessions, projects] = row
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) continue
    const s = count(sessions)
    const p = count(projects)
    if (s === null || p === null) continue
    meta.push([day, s, p])
  }

  const db = env.HOMELAB_DB

  // Upsert, so re-pushing a day corrects it instead of doubling it. That's
  // what makes the agent safe to run on a timer: it re-sends today's row on
  // every push, and today's row is the only one that can still change.
  const statements = [
    ...rows.map(r => db.prepare(
      `INSERT INTO token_daily
         (day, model, input, output, cache_write_5m, cache_write_1h, cache_read, messages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, model) DO UPDATE SET
         input          = excluded.input,
         output         = excluded.output,
         cache_write_5m = excluded.cache_write_5m,
         cache_write_1h = excluded.cache_write_1h,
         cache_read     = excluded.cache_read,
         messages       = excluded.messages`,
    ).bind(...r)),
    ...meta.map(r => db.prepare(
      `INSERT INTO token_day (day, sessions, projects)
       VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         sessions = excluded.sessions,
         projects = excluded.projects`,
    ).bind(...r)),
  ]

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE))
  }

  return json({ ok: true, days: rows.length, meta: meta.length })
}

export async function onRequestGet({ request, env, waitUntil }) {
  // `_headers` sends `no-store` to browsers for everything under /api/. This
  // cache is internal to the Function, so repeat views still collapse onto one
  // D1 read a minute.
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const cacheKey = new Request(new URL(request.url).origin + '/api/tokens', { method: 'GET' })

  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
  }

  if (!env.HOMELAB_DB) return json({ seen: false, error: 'database not bound' }, 503)

  const db = env.HOMELAB_DB
  const [totalsResult, modelResult, dailyResult, metaResult] = await db.batch([
    // Aggregate in SQL rather than shipping every row to the Function. All-time
    // totals cover the whole table, not just the charted window.
    db.prepare(
      `SELECT COUNT(DISTINCT day) AS days,
              MIN(day)            AS first_day,
              MAX(day)            AS last_day,
              SUM(input)          AS input,
              SUM(output)         AS output,
              SUM(cache_write_5m) AS cache_write_5m,
              SUM(cache_write_1h) AS cache_write_1h,
              SUM(cache_read)     AS cache_read,
              SUM(messages)       AS messages
         FROM token_daily`,
    ),
    db.prepare(
      `SELECT model,
              SUM(input)          AS input,
              SUM(output)         AS output,
              SUM(cache_write_5m) AS cache_write_5m,
              SUM(cache_write_1h) AS cache_write_1h,
              SUM(cache_read)     AS cache_read,
              SUM(messages)       AS messages
         FROM token_daily
        GROUP BY model
        ORDER BY (SUM(input) + SUM(output) + SUM(cache_write_5m)
                  + SUM(cache_write_1h) + SUM(cache_read)) DESC`,
    ),
    db.prepare(
      `SELECT day,
              SUM(input)          AS input,
              SUM(output)         AS output,
              SUM(cache_write_5m) AS cache_write_5m,
              SUM(cache_write_1h) AS cache_write_1h,
              SUM(cache_read)     AS cache_read,
              SUM(messages)       AS messages
         FROM token_daily
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${WINDOW_DAYS}`,
    ),
    db.prepare(
      `SELECT SUM(sessions) AS sessions, MAX(projects) AS projects
         FROM token_day`,
    ),
  ])

  const totals = totalsResult.results?.[0] ?? null
  const seen = Boolean(totals?.days)

  // Cost is derived per model, because the rates differ per model. Summing
  // tokens first and pricing once would silently charge Haiku at Opus rates.
  let cost = 0
  let unpricedTokens = 0
  const byModel = (modelResult.results ?? []).map((row) => {
    const price = priceFor(row.model)
    const tokens = row.input + row.output + row.cache_write_5m + row.cache_write_1h + row.cache_read
    let modelCost = null
    if (price) {
      modelCost =
        (row.input * price.input +
          row.output * price.output +
          row.cache_write_5m * price.input * CACHE_MULTIPLIERS.write5m +
          row.cache_write_1h * price.input * CACHE_MULTIPLIERS.write1h +
          row.cache_read * price.input * CACHE_MULTIPLIERS.read) / 1e6
      cost += modelCost
    } else {
      // A model released after this table was written still counts in the
      // token totals; it just can't be priced. Saying so beats guessing.
      unpricedTokens += tokens
    }
    return {
      model: row.model,
      label: price?.label ?? row.model,
      tokens,
      input: row.input,
      output: row.output,
      cacheWrite: row.cache_write_5m + row.cache_write_1h,
      cacheRead: row.cache_read,
      messages: row.messages,
      cost: modelCost == null ? null : Math.round(modelCost * 100) / 100,
    }
  })

  // Oldest first, so the chart reads left to right and the last entry is the
  // most recent day.
  const daily = (dailyResult.results ?? []).reverse().map(r => ({
    day: r.day,
    input: r.input,
    output: r.output,
    cacheWrite: r.cache_write_5m + r.cache_write_1h,
    cacheRead: r.cache_read,
    messages: r.messages,
    tokens: r.input + r.output + r.cache_write_5m + r.cache_write_1h + r.cache_read,
  }))

  const body = {
    // "Nothing pushed yet" reads differently from "zero tokens used", and the
    // page says which rather than rendering a confident set of zeroes.
    seen,
    windowDays: WINDOW_DAYS,
    totals: seen
      ? {
          days: totals.days,
          firstDay: totals.first_day,
          lastDay: totals.last_day,
          input: totals.input,
          output: totals.output,
          cacheWrite5m: totals.cache_write_5m,
          cacheWrite1h: totals.cache_write_1h,
          cacheRead: totals.cache_read,
          messages: totals.messages,
          tokens:
            totals.input + totals.output + totals.cache_write_5m
            + totals.cache_write_1h + totals.cache_read,
          sessions: metaResult.results?.[0]?.sessions ?? null,
          projects: metaResult.results?.[0]?.projects ?? null,
        }
      : null,
    cost: seen ? Math.round(cost * 100) / 100 : null,
    unpricedTokens,
    byModel,
    // Oldest first, so the chart reads left to right.
    daily,
    // The newest day the agent has pushed, surfaced on its own so the page
    // doesn't have to do date arithmetic to find it.
    //
    // It's the agent's latest day rather than "whatever day it is at the
    // edge": rows are bucketed in the homelab's timezone, and a Worker running
    // in UTC would call it yesterday for the eight hours after Beijing
    // midnight — reporting an empty day while I'm sitting here using it. The
    // page compares `day` against `lastDay` to decide whether to call it today
    // or name the date.
    today: daily.length ? daily[daily.length - 1] : null,
    // Published so the page can show its work instead of asking to be trusted
    // on a dollar figure.
    rates: {
      note: 'Anthropic list prices, USD per million tokens.',
      cache: CACHE_MULTIPLIERS,
      models: PRICES.map(p => ({ label: p.label, input: p.input, output: p.output })),
    },
  }

  const response = json(body, 200, {
    'cache-control': `public, max-age=${EDGE_TTL_SECONDS}`,
  })

  if (cache) waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
