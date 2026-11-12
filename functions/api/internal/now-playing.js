import { json } from '../../../lib/auth.js'
import { preferredSources, sourceStatement, validSourceId, validateSource } from '../../../lib/playbackSources.js'
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
      const sourceId = new URL(request.url).searchParams.get('sourceId')
      if (sourceId != null && !validSourceId(sourceId)) return json({ error: 'sourceId is invalid.' }, 400)
      // Old clients can only clear the old slot, never another source's lease.
      if (sourceId) {
        await env.HOMELAB_DB.prepare('DELETE FROM now_playing_sources WHERE source_id = ?').bind(sourceId).run()
      } else {
        await env.HOMELAB_DB.prepare('DELETE FROM now_playing WHERE singleton = 1').run()
      }
      await invalidateNowPlayingCache(request)
      return new Response(null, { status: 204 })
    }

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'Content-Type must be application/json.' }, 415)
    }

    const parsed = await readBoundedJson(request, 64 * 1024)
    if (parsed.error) return parsed.error
    if (parsed.value?.sourceId != null || parsed.value?.sources != null) {
      const batch = parsed.value.sources ?? [parsed.value]
      if (!Array.isArray(batch) || batch.length < 1 || batch.length > 32) return json({ error: 'Expected 1 to 32 playback sources.' }, 400)
      const sources = batch.map(validateSource)
      const invalid = sources.find(source => source.error)
      if (invalid) return json({ error: invalid.error }, 400)
      if (new Set(sources.map(source => source.value.sourceId)).size !== sources.length) return json({ error: 'Duplicate source IDs.' }, 400)
      const now = Math.floor(Date.now() / 1000)
      const results = await env.HOMELAB_DB.batch([
        ...sources.map(source => sourceStatement(env.HOMELAB_DB, source.value, now)),
        env.HOMELAB_DB.prepare('DELETE FROM now_playing_sources WHERE received_at < ?').bind(now - 86400),
      ])
      if (!results.slice(0, sources.length).some(result => result.meta.changes)) return json({ error: 'Updates are limited to one per source per second.' }, 429, { 'retry-after': '1' })
      await invalidateNowPlayingCache(request)
      const active = await env.HOMELAB_DB.prepare('SELECT * FROM now_playing_sources WHERE playing = 1 AND received_at >= ?').bind(now - 30).all()
      return json({ ok: true, receivedAt: now * 1000, preferredSources: preferredSources(active.results, now).map(source => source.source_id) })
    }
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
        { error: 'Updates are limited to one per second.' },
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
