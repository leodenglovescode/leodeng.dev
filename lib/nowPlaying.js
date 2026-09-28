import { json } from './auth.js'

export const NOW_PLAYING_STALE_SECONDS = 30
export const NOW_PLAYING_MIN_UPDATE_SECONDS = 3
export const NOW_PLAYING_ARTWORK_MIN_SECONDS = 10
export const NOW_PLAYING_CACHE_SECONDS = 5
export const NOW_PLAYING_MAX_JSON_BYTES = 8 * 1024
export const NOW_PLAYING_MAX_ARTWORK_BYTES = 2 * 1024 * 1024

const encoder = new TextEncoder()
const ARTWORK_KEY_PATTERN = /^now-playing\/artwork\/[a-f0-9]{64}\.(?:jpg|png|webp)$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export function publicMediaBase(env) {
  return (env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
}

export async function verifyNowPlayingRequest(request, env) {
  if (!env.NOW_PLAYING_TOKEN) return false
  const authorization = request.headers.get('authorization') || ''
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.NOW_PLAYING_TOKEN)),
  ])

  const left = new Uint8Array(providedHash)
  const right = new Uint8Array(expectedHash)
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(left, right)
  }

  // Both inputs are fixed-size SHA-256 digests, so this fallback never leaks
  // the original token's length or exits early on a matching prefix.
  let different = 0
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i]
  return different === 0
}

export async function requireNowPlayingWriter(request, env) {
  if (!env.NOW_PLAYING_TOKEN) {
    return json({ error: 'Now-playing ingest is not configured.' }, 503)
  }
  if (!(await verifyNowPlayingRequest(request, env))) {
    return json({ error: 'Unauthorized.' }, 401)
  }
  return null
}

export async function readBoundedJson(request, maximum = NOW_PLAYING_MAX_JSON_BYTES) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    return { error: json({ error: 'Payload too large.' }, 413) }
  }
  if (!request.body) return { error: json({ error: 'Missing JSON body.' }, 400) }

  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximum) {
      await reader.cancel('payload too large')
      return { error: json({ error: 'Payload too large.' }, 413) }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { error: json({ error: 'Invalid JSON.' }, 400) }
  }
}

export async function readBoundedBytes(request, maximum) {
  const declaredHeader = request.headers.get('content-length')
  const declared = declaredHeader == null ? NaN : Number(declaredHeader)
  if (!Number.isSafeInteger(declared) || declared < 1) {
    return { error: json({ error: 'Content-Length is required.' }, 411) }
  }
  if (declared > maximum) {
    return { error: json({ error: 'Payload too large.' }, 413) }
  }
  if (!request.body) return { error: json({ error: 'Missing request body.' }, 400) }

  const reader = request.body.getReader()
  const bytes = new Uint8Array(declared)
  let offset = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (offset + value.byteLength > declared || offset + value.byteLength > maximum) {
      await reader.cancel('payload too large')
      return { error: json({ error: 'Payload too large.' }, 413) }
    }
    bytes.set(value, offset)
    offset += value.byteLength
  }

  if (offset !== declared) {
    return { error: json({ error: 'Content-Length does not match the request body.' }, 400) }
  }
  return { value: bytes }
}

function boundedText(value, name, { required = true, maximum = 256 } = {}) {
  if (value == null && !required) return null
  if (typeof value !== 'string') return { error: `${name} must be text.` }
  const text = value.trim()
  if (required && !text) return { error: `${name} is required.` }
  if (!text) return null
  if (text.length > maximum) return { error: `${name} is too long.` }
  return text
}

function boundedInteger(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    return { error: `${name} is invalid.` }
  }
  return number
}

export function validatePlayback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Payload must be an object.' }
  }

  const trackKey = boundedText(value.trackKey, 'trackKey', { maximum: 256 })
  const title = boundedText(value.title, 'title')
  const artist = boundedText(value.artist, 'artist')
  const album = boundedText(value.album, 'album', { required: false })
  const durationMs = boundedInteger(value.durationMs, 'durationMs', 1, 24 * 60 * 60 * 1000)
  const positionMs = boundedInteger(value.positionMs, 'positionMs', 0, 24 * 60 * 60 * 1000)

  for (const checked of [trackKey, title, artist, album, durationMs, positionMs]) {
    if (checked && typeof checked === 'object' && checked.error) return checked
  }
  if (positionMs > durationMs) return { error: 'positionMs exceeds durationMs.' }

  let artworkKey = null
  if (value.artworkKey != null && value.artworkKey !== '') {
    if (typeof value.artworkKey !== 'string' || !ARTWORK_KEY_PATTERN.test(value.artworkKey)) {
      return { error: 'artworkKey is invalid.' }
    }
    artworkKey = value.artworkKey
  }

  return { value: { trackKey, title, artist, album, durationMs, positionMs, artworkKey } }
}

export function artworkSpec(hash, contentType) {
  if (!HASH_PATTERN.test(hash || '')) return null
  const extension = CONTENT_TYPES.get((contentType || '').split(';', 1)[0].trim().toLowerCase())
  if (!extension) return null
  return { key: `now-playing/artwork/${hash}.${extension}`, contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}` }
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function publicCacheKey(request) {
  return new Request(`${new URL(request.url).origin}/api/now-playing`, { method: 'GET' })
}

export async function invalidateNowPlayingCache(request) {
  if (typeof caches === 'undefined') return
  await caches.default.delete(publicCacheKey(request))
}

export function methodNotAllowed(method, allowed) {
  return json(
    { error: `Method not allowed: ${method}` },
    405,
    { allow: allowed.join(', ') },
  )
}

export function internalError(request, error) {
  console.error(JSON.stringify({
    message: 'now-playing request failed',
    method: request.method,
    path: new URL(request.url).pathname,
    error: error instanceof Error ? error.message : String(error),
  }))
  return json({ error: 'Internal server error.' }, 500)
}
