import { lookupLyrics, lyricsQuery, localLyricsSource } from '../../lib/lyricsProxy.js'

export async function onRequest(context) {
  const { request } = context
  const parsed = lyricsQuery(request)
  if (parsed instanceof Response) return parsed
  const cache = globalThis.caches?.default
  // Public, sanitized responses only. Cookies do not affect the lookup.
  const cacheUrl = new URL('/__lyrics_cache/v2', request.url)
  cacheUrl.search = parsed.query.toString()
  const key = new Request(cacheUrl, { method: 'GET' })
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        const headers = new Headers(hit.headers)
        if (hit.status === 503) headers.set('Cache-Control', 'no-store')
        return new Response(hit.body, { status: hit.status, headers })
      }
    } catch { /* A cache failure must not prevent the lookup. */ }
  }
  const response = await lookupLyrics(request, fetch, { local: localLyricsSource(context.env) })
  if (cache && context.waitUntil && (response.status === 200 || response.status === 503)) {
    const copy = response.clone()
    // Briefly cache upstream failures internally, so page visits do not
    // repeatedly hit an already rate-limited upstream. Browsers see no-store.
    if (copy.status === 503) copy.headers.set('Cache-Control', `public, max-age=${Math.min(60, Number(response.headers.get('Retry-After')) || 30)}`)
    context.waitUntil(cache.put(key, copy).catch(() => {}))
  }
  return response
}
