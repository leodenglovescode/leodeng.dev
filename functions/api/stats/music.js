import { musicSchema, musicSummary } from '../../../lib/musicStats.js'
import { readBoundedJson, verifyNowPlayingRequest } from '../../../lib/nowPlaying.js'
export async function onRequest({ request, env }) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'Method not allowed' }, 405)
  if (new URL(request.url).search) return reply({ error: 'Invalid query' }, 400)
  if (!env.HOMELAB_DB) return reply({ state: 'unavailable' }, 503)
  if (request.method === 'POST') {
    if (!env.HOMELAB_TOKEN) return reply({ error: 'Ingest not configured' }, 503)
    if (!await verifyNowPlayingRequest(request, { NOW_PLAYING_TOKEN: env.HOMELAB_TOKEN })) return reply({ error: 'Unauthorized' }, 401)
    const parsed = await readBoundedJson(request, 100000)
    if (parsed.error) return parsed.error
    let value
    try { value = musicSummary(parsed.value); if (value.through >= new Date().toISOString().slice(0,10)) throw new Error() } catch { return reply({ error: 'Invalid summary' }, 400) }
    try {
      await musicSchema(env.HOMELAB_DB)
      await env.HOMELAB_DB.prepare('INSERT INTO music_summary VALUES(1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET through=excluded.through, payload=excluded.payload, received_at=excluded.received_at WHERE excluded.through > music_summary.through').bind(value.through, JSON.stringify(value), Date.now()).run()
      return reply({ ok: true })
    } catch { return reply({ error: 'Storage unavailable' }, 503) }
  }
  try {
    await musicSchema(env.HOMELAB_DB)
    const row = await env.HOMELAB_DB.prepare('SELECT payload, received_at FROM music_summary WHERE id=1').first()
    if (!row) return reply({ state: 'empty' })
    return reply({ state: 'ready', ...musicSummary(JSON.parse(row.payload)), updatedAt: row.received_at, stale: Date.now()-row.received_at > 48*3600000 })
  } catch { return reply({ state: 'unavailable' }, 503) }
}
