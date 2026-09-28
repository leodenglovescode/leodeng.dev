import { json } from '../../lib/auth.js'
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
      `SELECT title, artist, album, duration_ms, position_ms, artwork_key, received_at
         FROM now_playing
        WHERE singleton = 1`,
    ).first()

    let response
    if (!current || now - current.received_at > NOW_PLAYING_STALE_SECONDS) {
      response = new Response(null, {
        status: 204,
        headers: { 'cache-control': `public, max-age=${NOW_PLAYING_CACHE_SECONDS}` },
      })
    } else {
      response = json({
        playing: true,
        title: current.title,
        artist: current.artist,
        album: current.album,
        durationMs: current.duration_ms,
        positionMs: current.position_ms,
        observedAt: current.received_at * 1000,
        serverNow: now * 1000,
        artworkUrl: current.artwork_key
          ? `${publicMediaBase(env)}/${current.artwork_key}`
          : null,
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
