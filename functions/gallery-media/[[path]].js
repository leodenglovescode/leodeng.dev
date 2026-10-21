// Same-origin textures avoid requiring CORS configuration on the media bucket.
// Only special images already published in the gallery manifest are readable.
import { galleryMediaKey } from '../../lib/gallery-media.js'

export async function onRequest({ request, env, params }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const key = galleryMediaKey(params.path)
  if (!key) return new Response('Not found', { status: 404 })
  if (!env.MEDIA) return new Response('Image unavailable', { status: 503 })
  try {
    const object = await env.MEDIA[request.method === 'HEAD' ? 'head' : 'get'](key)
    if (!object) return new Response('Not found', { status: 404 })
    const headers = new Headers({
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=86400',
      ETag: object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.headers.get('If-None-Match') === object.httpEtag) {
      if (request.method !== 'HEAD') await object.body.cancel()
      headers.delete('Content-Length')
      return new Response(null, { status: 304, headers })
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { headers })
  } catch { return new Response('Image unavailable', { status: 503 }) }
}
