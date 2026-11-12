import { json } from '../../lib/auth.js'
import { publicSources } from '../../lib/playbackSources.js'
import {
  NOW_PLAYING_CACHE_SECONDS,
  NOW_PLAYING_STALE_SECONDS,
  internalError,
  methodNotAllowed,
  publicCacheKey,
  publicMediaBase,
} from '../../lib/nowPlaying.js'

export async function onRequest(context) {
  const { request, env } = context
  if (request.method !== 'GET') return methodNotAllowed(request.method, ['GET'])

  try {
    if (!env.HOMELAB_DB) {
      return json({ error: 'Now-playing storage is not configured.' }, 503)
    }

    const cache = typeof caches === 'undefined' ? null : caches.default
    const cacheKey = publicCacheKey(request)
    if (cache) {
      const hit = await cache.match(cacheKey)
      if (hit) return hit
    }

    const now = Math.floor(Date.now() / 1000)
    const current = await env.HOMELAB_DB.prepare(
      `SELECT track_key, title, artist, album, duration_ms, position_ms, artwork_key, received_at
         FROM now_playing
        WHERE singleton = 1`,
    ).first()

    const { results: rows } = await env.HOMELAB_DB.prepare(
      'SELECT * FROM now_playing_sources WHERE playing = 1 AND received_at >= ? ORDER BY priority DESC, changed_at DESC, source_id LIMIT 64',
    ).bind(now - NOW_PLAYING_STALE_SECONDS).all()
    if (current && now - current.received_at <= NOW_PLAYING_STALE_SECONDS) {
      // Compatibility for agents awaiting an update. Never let old clears
      // affect independently reported devices.
      rows.push({ ...current, source_id: 'legacy', device_id: 'legacy', source_label: 'Music', priority: 0, playing: 1, changed_at: current.received_at })
    }
    const sources = await publicSources(rows, now, publicMediaBase(env))

    let response
    if (!sources.length) {
      response = new Response(null, {
        status: 204,
        headers: { 'cache-control': `public, max-age=${NOW_PLAYING_CACHE_SECONDS}` },
      })
    } else {
      response = json({
        ...sources[0],
        sources,
        serverNow: now * 1000,
      }, 200, {
        'cache-control': `public, max-age=${NOW_PLAYING_CACHE_SECONDS}`,
      })
    }

    if (cache) context.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  } catch (error) {
    return internalError(request, error)
  }
}
