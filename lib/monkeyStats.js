const USER = 'leodeng'
const HOUR = 3600000
const numeric = (n, max = 1000000000) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : null

export async function statsJson(url, options = {}, fetcher = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  let reader
  try {
    const response = await fetcher(url, { ...options, redirect: 'manual', signal: controller.signal })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Unavailable')
    reader = response.body.getReader()
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
    return JSON.parse(new TextDecoder().decode(bytes))
  } finally { clearTimeout(timer); controller.abort(); if (reader) await reader.cancel().catch(() => {}) }
}

export function monkeyProfile(profile) {
  if (profile?.name?.toLowerCase() !== USER) throw new Error('Wrong account')
  const bests = []
  for (const seconds of ['15', '30', '60', '120']) {
    const candidates = (profile.personalBests?.time?.[seconds] || []).filter(r => r.language === 'english'
      && r.difficulty === 'normal' && !r.lazyMode && !r.punctuation && !r.numbers && numeric(r.wpm, 1000) !== null)
    const best = candidates.sort((a, b) => b.wpm - a.wpm)[0]
    if (best) bests.push({ seconds: Number(seconds), wpm: best.wpm, accuracy: numeric(best.acc, 100) })
  }
  return { completedTests: numeric(profile.typingStats?.completedTests), timeTyping: numeric(profile.typingStats?.timeTyping), bests }
}

export function monkeyResults(results, uid) {
  if (!Array.isArray(results) || results.length > 1000 || typeof uid !== 'string' || !uid) throw new Error('Invalid history')
  // The key must belong to the fixed public profile. Never publish another
  // account's private results, tags, IDs, keystrokes, or arbitrary API fields.
  if (results.some(r => r.uid !== uid)) throw new Error('Wrong account')
  return results.filter(r => numeric(r.wpm, 1000) !== null && numeric(r.acc, 100) !== null
    && numeric(r.timestamp, 10000000000000) !== null && r.timestamp >= 1589428800000)
    .map(r => ({ wpm: r.wpm, accuracy: r.acc, timestamp: r.timestamp,
      mode: ['time', 'words', 'quote', 'custom', 'zen'].includes(r.mode) ? r.mode : 'other',
      mode2: typeof r.mode2 === 'number' || typeof r.mode2 === 'string' ? String(r.mode2).slice(0, 20) : '',
      language: typeof r.language === 'string' ? r.language.slice(0, 40) : '' }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function history(env, profile, fetcher, now) {
  const empty = { state: 'not-connected', results: [], fetchedAt: null, stale: false }
  if (!env.MONKEYTYPE_API_KEY) return empty
  let cached = null
  try {
    const db = env.HOMELAB_DB
    if (!db) throw new Error('Unavailable')
    await db.prepare('CREATE TABLE IF NOT EXISTS personal_stats_cache (name TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER, refresh_after INTEGER NOT NULL DEFAULT 0)').run()
    await db.prepare('INSERT OR IGNORE INTO personal_stats_cache (name) VALUES (?)').bind('monkeytype-leodeng').run()
    const row = await db.prepare('SELECT * FROM personal_stats_cache WHERE name = ?').bind('monkeytype-leodeng').first()
    if (row?.payload) cached = { state: 'ready', results: JSON.parse(row.payload), fetchedAt: row.fetched_at, stale: now - row.fetched_at >= HOUR }
    // Atomic, global refresh slot. /results permits only 30 ApeKey calls/day;
    // reserve one hour even on failure or concurrency, independent of edge colo.
    const claimed = await db.prepare('UPDATE personal_stats_cache SET refresh_after = ? WHERE name = ? AND refresh_after <= ? RETURNING name')
      .bind(now + HOUR, 'monkeytype-leodeng', now).first()
    if (!claimed) return cached || { ...empty, state: 'unavailable' }
    if (profile?.name?.toLowerCase() !== USER) throw new Error('Unavailable')
    const body = await statsJson('https://api.monkeytype.com/results?limit=1000', {
      headers: { Accept: 'application/json', Authorization: `ApeKey ${env.MONKEYTYPE_API_KEY}` },
    }, fetcher)
    const results = monkeyResults(body.data, profile.uid)
    await db.prepare('UPDATE personal_stats_cache SET payload = ?, fetched_at = ? WHERE name = ?')
      .bind(JSON.stringify(results), now, 'monkeytype-leodeng').run()
    return { state: 'ready', results, fetchedAt: now, stale: false }
  } catch { return cached || { ...empty, state: 'unavailable' } }
}

export async function loadMonkeyStats(env = {}, fetcher = fetch, now = Date.now()) {
  let profile = null, summary = null
  try {
    const body = await statsJson(`https://api.monkeytype.com/users/${USER}/profile`, { headers: { Accept: 'application/json' } }, fetcher)
    summary = monkeyProfile(body.data); profile = body.data
  } catch { /* Public profile and saved history fail independently. */ }
  return { username: USER, profile: summary, history: await history(env, profile, fetcher, now) }
}
