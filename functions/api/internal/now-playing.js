import { json } from '../../../lib/auth.js'
import {
  NOW_PLAYING_MIN_UPDATE_SECONDS,
  internalError,
  invalidateNowPlayingCache,
  methodNotAllowed,
  readBoundedJson,
  requireNowPlayingWriter,
  validatePlayback,
} from '../../../lib/nowPlaying.js'

export async function onRequest(context) {
  const { request, env } = context
  if (!['POST', 'DELETE'].includes(request.method)) {
    return methodNotAllowed(request.method, ['POST', 'DELETE'])
  }

  try {
    const authError = await requireNowPlayingWriter(request, env)
    if (authError) return authError
    if (!env.HOMELAB_DB) return json({ error: 'Now-playing storage is not configured.' }, 503)

    if (request.method === 'DELETE') {
      await env.HOMELAB_DB.prepare('DELETE FROM now_playing WHERE singleton = 1').run()
      await invalidateNowPlayingCache(request)
      return new Response(null, { status: 204 })
    }

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'Content-Type must be application/json.' }, 415)
    }

    const parsed = await readBoundedJson(request)
    if (parsed.error) return parsed.error
    const playback = validatePlayback(parsed.value)
    if (playback.error) return json({ error: playback.error }, 400)

    const now = Math.floor(Date.now() / 1000)
    const value = playback.value
    const result = await env.HOMELAB_DB.prepare(
      `INSERT INTO now_playing
         (singleton, track_key, title, artist, album, duration_ms, position_ms, artwork_key, received_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         track_key   = excluded.track_key,
         title       = excluded.title,
         artist      = excluded.artist,
         album       = excluded.album,
         duration_ms = excluded.duration_ms,
         position_ms = excluded.position_ms,
         artwork_key = excluded.artwork_key,
         received_at = excluded.received_at
       WHERE now_playing.received_at <= excluded.received_at - ?`,
    ).bind(
      value.trackKey,
      value.title,
      value.artist,
      value.album,
      value.durationMs,
      value.positionMs,
      value.artworkKey,
      now,
      NOW_PLAYING_MIN_UPDATE_SECONDS,
    ).run()

    if (!result.meta.changes) {
      return json(
        { error: 'Updates are limited to one every three seconds.' },
        429,
        { 'retry-after': String(NOW_PLAYING_MIN_UPDATE_SECONDS) },
      )
    }

    await invalidateNowPlayingCache(request)
    return json({ ok: true, receivedAt: now * 1000 })
  } catch (error) {
    return internalError(request, error)
  }
}
