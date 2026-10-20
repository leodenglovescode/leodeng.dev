import { loadMonkeyStats, monkeySnapshotSchema, sanitizeMonkeySnapshot } from '../../../lib/monkeyStats.js'
import { readBoundedJson, verifyNowPlayingRequest } from '../../../lib/nowPlaying.js'

export async function onRequest(context) {
  const { request, env } = context
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  const respond = (body, status = 200) => Response.json(body, { status, headers })
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST' } })
  if (new URL(request.url).search) return respond({ error: 'Invalid query' }, 400)
  if (request.method === 'GET') {
    // Read D1 directly: hourly writes are small, and successful pushes must
    // become visible immediately across both sites without stale edge caches.
    return respond(await loadMonkeyStats(env))
  }
  if (!env.HOMELAB_TOKEN || !env.HOMELAB_DB) return respond({ error: 'Ingest not configured' }, 503)
  if (!await verifyNowPlayingRequest(request, { NOW_PLAYING_TOKEN: env.HOMELAB_TOKEN })) return respond({ error: 'Unauthorized' }, 401)
  const parsed = await readBoundedJson(request, 300000)
  if (parsed.error) return parsed.error
  let snapshot
  try { snapshot = sanitizeMonkeySnapshot(parsed.value) } catch { return respond({ error: 'Invalid snapshot' }, 400) }
  try {
    await monkeySnapshotSchema(env.HOMELAB_DB)
    const receivedAt = Date.now()
    await env.HOMELAB_DB.prepare('INSERT INTO personal_stats_snapshots (name, payload, received_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET payload = excluded.payload, received_at = excluded.received_at')
      .bind('leodeng', JSON.stringify(snapshot), receivedAt).run()
    return respond({ ok: true, receivedAt })
  } catch { return respond({ error: 'Snapshot storage unavailable' }, 503) }
}
