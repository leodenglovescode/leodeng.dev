import { json } from '../../../../../lib/auth.js'
import {
  NOW_PLAYING_ARTWORK_MIN_SECONDS,
  NOW_PLAYING_MAX_ARTWORK_BYTES,
  artworkSpec,
  internalError,
  methodNotAllowed,
  publicMediaBase,
  readBoundedBytes,
  requireNowPlayingWriter,
  sha256Hex,
} from '../../../../../lib/nowPlaying.js'

export async function onRequest(context) {
  const { request, env, params } = context
  if (request.method !== 'PUT') return methodNotAllowed(request.method, ['PUT'])

  try {
    const authError = await requireNowPlayingWriter(request, env)
    if (authError) return authError
    if (!env.HOMELAB_DB) return json({ error: 'Now-playing storage is not configured.' }, 503)
    if (!env.MEDIA) return json({ error: 'Artwork storage is not configured.' }, 503)

    const hash = typeof params.hash === 'string' ? params.hash : ''
    const spec = artworkSpec(hash, request.headers.get('content-type'))
    if (!spec) return json({ error: 'Invalid artwork hash or content type.' }, 400)

    const existing = await env.MEDIA.head(spec.key)
    if (existing) {
      return json({
        artworkKey: spec.key,
        url: `${publicMediaBase(env)}/${spec.key}`,
        existing: true,
      })
    }

    const body = await readBoundedBytes(request, NOW_PLAYING_MAX_ARTWORK_BYTES)
    if (body.error) return body.error
    if (await sha256Hex(body.value) !== hash) {
      return json({ error: 'Artwork does not match its SHA-256 path.' }, 400)
    }

    const now = Math.floor(Date.now() / 1000)
    const limited = await env.HOMELAB_DB.prepare(
      `INSERT INTO now_playing_rate (name, last_accepted_at)
       VALUES ('artwork', ?)
       ON CONFLICT(name) DO UPDATE SET last_accepted_at = excluded.last_accepted_at
       WHERE now_playing_rate.last_accepted_at <= excluded.last_accepted_at - ?`,
    ).bind(now, NOW_PLAYING_ARTWORK_MIN_SECONDS).run()
    if (!limited.meta.changes) {
      return json(
        { error: 'Artwork uploads are limited to one every ten seconds.' },
        429,
        { 'retry-after': String(NOW_PLAYING_ARTWORK_MIN_SECONDS) },
      )
    }

    await env.MEDIA.put(spec.key, body.value, {
      httpMetadata: {
        contentType: spec.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
    return json({
      artworkKey: spec.key,
      url: `${publicMediaBase(env)}/${spec.key}`,
      existing: false,
    }, 201)
  } catch (error) {
    return internalError(request, error)
  }
}
