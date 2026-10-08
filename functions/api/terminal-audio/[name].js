import { recordings } from '../../../src/utils/terminal/recordings.js'

const keys = Object.values(recordings).map(url => new URL(url).pathname.slice(1))

export async function onRequest({ request, env, params }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const key = keys.find(key => key.split('/').at(-1) === params.name)
  if (!key) return new Response('Not found', { status: 404 })
  if (!env.MEDIA) return new Response('Audio unavailable', { status: 503 })
  try {
    const object = await env.MEDIA[request.method === 'HEAD' ? 'head' : 'get'](key)
    if (!object) return new Response('Not found', { status: 404 })
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: object.httpEtag,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch { return new Response('Audio unavailable', { status: 503 }) }
}
