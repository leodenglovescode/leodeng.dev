// LLM token usage — the ingest and read endpoint behind /tokens.
//
// Same push model as /api/homelab, for the same reason: the box that holds the
// session logs is behind Headscale and has no inbound path. It reuses
// HOMELAB_TOKEN rather than issuing a second secret — it's the same agent, on
// the same machine, pushed by the same systemd timer. A separate token would
// be two things to rotate protecting one trust boundary.
//
// What lands here is deliberately aggregate: per day, per model, token counts
// and a message count. No prompts, no file paths, no project or repository
// names, no session identifiers — only how many distinct sessions ran. Token
// counts say how much I used these tools; the names of the private repos I
// used them on are nobody's business, and once they're on a public endpoint
// they can't be taken back.
import { json } from '../../lib/auth.js'

// Unlike the heartbeat table, nothing here is ever deleted. The agent keeps a
// local SQLite archive of every response (homelab/tokens.py) and this table is
// the published aggregate of it — but the CLIs prune their own session logs
// after a few weeks, so for any day older than that these two are the only
// copies left. Retention here would delete history that exists nowhere else.

// Every recorded day is sent, so the page can switch between 7 / 30 / all
// without another round trip. This cap only exists so the payload can't grow
// without bound on a machine that has been running for years — at roughly 40
// bytes a day it is about 30KB of JSON.
const MAX_CHART_DAYS = 730

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

// Anthropic list prices, USD per million tokens. The Copilot entry applies the
// same Sonnet list rate to explicitly estimated visible-transcript tokens.
// Matched by longest prefix so
// a dated model id (claude-haiku-4-5-20251001) resolves without a table entry
// of its own.
//
// This is what the same tokens would have cost on the API at list price. It is
// not a bill: this usage is on a Claude subscription, so nothing here was
// charged per token. The page says so out loud — an unlabelled dollar figure
// would read as money spent.
const PRICES = [
  {
    prefix: 'copilot-claude-sonnet-4-6-estimate',
    label: 'Copilot · Sonnet 4.6 (est.)',
    input: 3,
    output: 15,
  },
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

// Cost of one model's token bundle, in dollars. Cache tokens are multiples of
// that model's input rate, so this has to be applied per model — never to a
// blended total.
function costOf(price, b) {
  return (
    b.input * price.input +
    b.output * price.output +
    b.cw5m * price.input * CACHE_MULTIPLIERS.write5m +
    b.cw1h * price.input * CACHE_MULTIPLIERS.write1h +
    b.cacheRead * price.input * CACHE_MULTIPLIERS.read
  ) / 1e6
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

  // Ranges are measured back from the newest day that has data, not from the
  // edge's idea of today. The rows are bucketed in the homelab's timezone, and
  // a Worker running in UTC would otherwise drop the current day out of "last
  // 7 days" for the eight hours after Beijing midnight.
  const from7 = `date((SELECT MAX(day) FROM token_daily), '-6 days')`
  const from30 = `date((SELECT MAX(day) FROM token_daily), '-29 days')`

  // Summed per model rather than overall, because the price of a token depends
  // on which model produced it — one blended total would charge Haiku at Opus
  // rates. Each range is a conditional sum in the same pass, so the whole
  // breakdown is one scan instead of three.
  const perRange = (column) => `
    SUM(${column})                                        AS ${column}_all,
    SUM(CASE WHEN day >= ${from30} THEN ${column} ELSE 0 END) AS ${column}_30,
    SUM(CASE WHEN day >= ${from7}  THEN ${column} ELSE 0 END) AS ${column}_7`

  const [dailyResult, modelResult, spanResult, metaResult] = await db.batch([
    db.prepare(
      `SELECT day,
              SUM(input + output + cache_write_5m + cache_write_1h + cache_read) AS tokens,
              SUM(messages) AS messages
         FROM token_daily
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${MAX_CHART_DAYS}`,
    ),
    db.prepare(
      `SELECT model,
              ${perRange('input')},
              ${perRange('output')},
              ${perRange('cache_write_5m')},
              ${perRange('cache_write_1h')},
              ${perRange('cache_read')},
              ${perRange('messages')}
         FROM token_daily
        GROUP BY model`,
    ),
    db.prepare(
      `SELECT COUNT(DISTINCT day) AS days,
              MIN(day) AS first_day,
              MAX(day) AS last_day,
              COUNT(DISTINCT CASE WHEN day >= ${from7}  THEN day END) AS days_7,
              COUNT(DISTINCT CASE WHEN day >= ${from30} THEN day END) AS days_30
         FROM token_daily`,
    ),
    db.prepare('SELECT SUM(sessions) AS sessions, MAX(projects) AS projects FROM token_day'),
  ])

  const span = spanResult.results?.[0] ?? null
  const seen = Boolean(span?.days)

  // Oldest first, so the chart reads left to right and the last entry is the
  // most recent day.
  const daily = (dailyResult.results ?? []).reverse().map(r => ({
    day: r.day,
    tokens: r.tokens,
    messages: r.messages,
  }))

  const modelRows = modelResult.results ?? []

  // Build one summary per range from the same per-model rows.
  function summarise(suffix, days) {
    const totals = {
      days,
      input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0,
      messages: 0, tokens: 0, cost: 0, unpricedTokens: 0,
    }
    for (const row of modelRows) {
      const b = {
        input: row[`input_${suffix}`],
        output: row[`output_${suffix}`],
        cw5m: row[`cache_write_5m_${suffix}`],
        cw1h: row[`cache_write_1h_${suffix}`],
        cacheRead: row[`cache_read_${suffix}`],
        messages: row[`messages_${suffix}`],
      }
      const tokens = b.input + b.output + b.cw5m + b.cw1h + b.cacheRead
      totals.input += b.input
      totals.output += b.output
      totals.cacheWrite5m += b.cw5m
      totals.cacheWrite1h += b.cw1h
      totals.cacheRead += b.cacheRead
      totals.messages += b.messages
      totals.tokens += tokens

      const price = priceFor(row.model)
      if (price) totals.cost += costOf(price, b)
      // A model released after this table was written still counts in the
      // token totals; it just can't be priced. Saying so beats guessing.
      else totals.unpricedTokens += tokens
    }
    totals.cost = Math.round(totals.cost * 100) / 100
    return totals
  }

  const ranges = seen
    ? {
        d7: summarise('7', span.days_7),
        d30: summarise('30', span.days_30),
        all: summarise('all', span.days),
      }
    : null

  const byModel = modelRows
    .map((row) => {
      const price = priceFor(row.model)
      const b = {
        input: row.input_all,
        output: row.output_all,
        cw5m: row.cache_write_5m_all,
        cw1h: row.cache_write_1h_all,
        cacheRead: row.cache_read_all,
      }
      const tokens = b.input + b.output + b.cw5m + b.cw1h + b.cacheRead
      return {
        model: row.model,
        label: price?.label ?? row.model,
        tokens,
        input: b.input,
        output: b.output,
        cacheWrite: b.cw5m + b.cw1h,
        cacheRead: b.cacheRead,
        messages: row.messages_all,
        cost: price ? Math.round(costOf(price, b) * 100) / 100 : null,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const body = {
    // "Nothing pushed yet" reads differently from "zero tokens used", and the
    // page says which rather than rendering a confident set of zeroes.
    seen,
    totals: seen
      ? {
          ...ranges.all,
          firstDay: span.first_day,
          lastDay: span.last_day,
          sessions: metaResult.results?.[0]?.sessions ?? null,
          projects: metaResult.results?.[0]?.projects ?? null,
        }
      : null,
    // Precomputed here rather than left to the page, because a range's cost
    // needs the per-model split and the price table, and neither is worth
    // shipping to the browser.
    ranges,
    cost: seen ? ranges.all.cost : null,
    unpricedTokens: seen ? ranges.all.unpricedTokens : 0,
    byModel,
    // Every day ever recorded, capped only to bound a pathological payload.
    // The page slices this for its 7 / 30 / all views, so switching between
    // them costs no round trip.
    daily,
    chartDayCap: MAX_CHART_DAYS,
    // The newest day the agent has pushed, surfaced on its own so the page
    // doesn't have to do date arithmetic to find it.
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
