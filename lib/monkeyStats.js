const USER = 'leodeng'
const HOUR = 3600000
const numeric = (n, max = 1000000000) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : null

export async function statsJson(url, options = {}, fetcher = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  let reader
  let phase = 'fetch', upstreamStatus = null, upstreamReason = null
  try {
    const response = await fetcher(url, { ...options, redirect: 'manual', signal: controller.signal })
    phase = 'response'; upstreamStatus = response.status
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Unavailable')
    reader = response.body.getReader()
    phase = 'body'
    const chunks = []; let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2000000) throw new Error('Oversized response')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    phase = 'json'
    const body = JSON.parse(new TextDecoder().decode(bytes))
    if (!response.ok) {
      // Classify known upstream failures without logging their body or UID.
      if (response.status === 429) upstreamReason =
        body.message === 'Maximum API request (root) limit reached. Please try again later.' ? 'root_limit'
          : body.message === 'Too many bad authentication attempts, please try again later.' ? 'bad_auth_limit' : 'endpoint_limit'
      phase = 'response'
      throw new Error('Unavailable')
    }
    return body
  } catch (error) {
    const failure = new Error('Stats lookup unavailable')
    failure.statsPhase = phase; failure.statsStatus = upstreamStatus; failure.statsReason = upstreamReason
    failure.statsType = controller.signal.aborted ? 'timeout' : error?.name === 'SyntaxError' ? 'json' : error?.name === 'TypeError' ? 'type' : 'other'
    throw failure
  } finally { clearTimeout(timer); controller.abort(); if (reader) await reader.cancel().catch(() => {}) }
}


export function sanitizeMonkeySnapshot(body) {
  if (body?.username !== USER || !body.profile || !Array.isArray(body.results) || body.results.length > 1000) throw new Error('Invalid snapshot')
  const p = body.profile
  if (numeric(p.completedTests) === null || numeric(p.timeTyping) === null || !Array.isArray(p.bests) || p.bests.length > 4) throw new Error('Invalid profile')
  const bests = p.bests.map(b => {
    if (![15, 30, 60, 120].includes(b.seconds) || numeric(b.wpm, 1000) === null || numeric(b.accuracy, 100) === null) throw new Error('Invalid best')
    return { seconds: b.seconds, wpm: b.wpm, accuracy: b.accuracy }
  })
  if (new Set(bests.map(b => b.seconds)).size !== bests.length) throw new Error('Duplicate best')
  const results = body.results.map(r => {
    if (numeric(r.wpm, 1000) === null || numeric(r.accuracy, 100) === null || numeric(r.timestamp, 10000000000000) === null
      || r.timestamp < 1589428800000 || !['time', 'words', 'quote', 'custom', 'zen', 'other'].includes(r.mode)
      || typeof r.mode2 !== 'string' || r.mode2.length > 20 || typeof r.language !== 'string' || r.language.length > 40) throw new Error('Invalid result')
    return { wpm: r.wpm, accuracy: r.accuracy, timestamp: r.timestamp, mode: r.mode, mode2: r.mode2, language: r.language }
  }).sort((a, b) => a.timestamp - b.timestamp)
  return { username: USER, profile: { completedTests: p.completedTests, timeTyping: p.timeTyping, bests }, results }
}

export async function monkeySnapshotSchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS personal_stats_snapshots (name TEXT PRIMARY KEY, payload TEXT NOT NULL, received_at INTEGER NOT NULL)').run()
}

export async function loadMonkeyStats(env = {}, now = Date.now()) {
  const empty = { username: USER, profile: null, history: { state: 'unavailable', results: [], fetchedAt: null, stale: false } }
  if (!env.HOMELAB_DB) return empty
  try {
    await monkeySnapshotSchema(env.HOMELAB_DB)
    const row = await env.HOMELAB_DB.prepare('SELECT payload, received_at FROM personal_stats_snapshots WHERE name = ?').bind(USER).first()
    if (!row) return empty
    const snapshot = sanitizeMonkeySnapshot(JSON.parse(row.payload))
    return { username: USER, profile: snapshot.profile, history: { state: 'ready', results: snapshot.results,
      fetchedAt: row.received_at, stale: now - row.received_at >= 2 * HOUR } }
  } catch { console.warn('Monkeytype snapshot read unavailable'); return empty }
}
