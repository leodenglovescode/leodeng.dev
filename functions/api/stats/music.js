import { musicSchema, musicSummary } from '../../../lib/musicStats.js'
import { readBoundedJson, verifyNowPlayingRequest } from '../../../lib/nowPlaying.js'
const LIVE_KEY = 'stats/music-live.json'
export async function onRequest({ request, env }) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'Method not allowed' }, 405)
  if (new URL(request.url).search) return reply({ error: 'Invalid query' }, 400)
  if (!env.HOMELAB_DB) return reply({ state: 'unavailable' }, 503)
  if (request.method === 'POST') {
    if (!env.HOMELAB_TOKEN) return reply({ error: 'Ingest not configured' }, 503)
    if (!await verifyNowPlayingRequest(request, { NOW_PLAYING_TOKEN: env.HOMELAB_TOKEN })) return reply({ error: 'Unauthorized' }, 401)
    const parsed = await readBoundedJson(request, 1000000)
    if (parsed.error) return parsed.error
    let value, archive
    try {
      const today = new Date().toISOString().slice(0,10)
      value = musicSummary(parsed.value)
      if (value.through > today) throw new Error()
      // Accept the previous daily publisher during the server upgrade.
      archive = parsed.value.archive ? musicSummary(parsed.value.archive) : value
      if (archive.through >= today || archive.through > value.through) throw new Error()
    } catch { return reply({ error: 'Invalid summary' }, 400) }
    try {
      if (!env.MEDIA) return reply({ error: 'Live storage not configured' }, 503)
      const updatedAt = Date.now()
      await env.MEDIA.put(LIVE_KEY, JSON.stringify({ ...value, updatedAt }), { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } })
      await musicSchema(env.HOMELAB_DB)
      await env.HOMELAB_DB.prepare('INSERT INTO music_summary VALUES(1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET through=excluded.through, payload=excluded.payload, received_at=excluded.received_at WHERE excluded.through > music_summary.through').bind(archive.through, JSON.stringify(archive), updatedAt).run()
      return reply({ ok: true })
    } catch { return reply({ error: 'Storage unavailable' }, 503) }
  }
  try {
    const object = await env.MEDIA?.get(LIVE_KEY)
    if (object && object.size <= 500000) {
      const live = JSON.parse(await object.text())
      if (!Number.isSafeInteger(live.updatedAt)) throw new Error('Invalid timestamp')
      return reply({ state: 'ready', ...musicSummary(live), updatedAt: live.updatedAt, live: true, stale: Date.now()-live.updatedAt > 24*3600000 })
    }
  } catch { /* Keep serving the daily snapshot during R2 outages. */ }
  try {
    await musicSchema(env.HOMELAB_DB)
    const row = await env.HOMELAB_DB.prepare('SELECT payload, received_at FROM music_summary WHERE id=1').first()
    if (!row) return reply({ state: 'empty' })
    return reply({ state: 'ready', ...musicSummary(JSON.parse(row.payload)), updatedAt: row.received_at, live: false, stale: Date.now()-row.received_at > 48*3600000 })
  } catch { return reply({ state: 'unavailable' }, 503) }
}
