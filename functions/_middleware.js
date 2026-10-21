import { LEGACY_ORIGIN, LEGACY_PREFIX, MODERN_ORIGIN, cleanLegacyPath, isDocumentRequest, isLegacyBrowser, modernLink, prefersModern } from '../lib/legacy.js'
import { onRequest as galleryImage } from './gallery-media/[[path]].js'
import { legacyMediaKey } from '../lib/legacy-media.js'

const PUBLIC_APIS = new Set(['/api/now-playing', '/api/homelab', '/api/tokens', '/api/time', '/api/ip', '/api/lyrics', '/api/stats/monkeytype'])

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', Vary: 'User-Agent, Cookie' } })
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const legacyHost = url.hostname === new URL(LEGACY_ORIGIN).hostname
  if (!legacyHost) {
    // Opt in only once the custom domain and its certificate are ready.
    if (url.origin === MODERN_ORIGIN && isDocumentRequest(request)) {
      if (url.searchParams.get('view') === 'modern') {
        const original = await context.next()
        const response = new Response(original.body, original)
        response.headers.append('Set-Cookie', 'site_view=modern; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax')
        response.headers.set('Cache-Control', 'no-store')
        response.headers.set('Vary', 'User-Agent, Cookie')
        return response
      }
      if (env.LEGACY_SITE_ENABLED === 'true' && !prefersModern(request) && isLegacyBrowser(request.headers.get('user-agent') || '')) {
        const destination = new URL(LEGACY_ORIGIN)
        destination.pathname = url.pathname
        destination.search = url.search
        destination.searchParams.set('redirected', 'older-browser')
        return redirect(destination.href)
      }
    }
    return context.next()
  }

  const pathname = cleanLegacyPath(url.pathname)
  if (!pathname) return new Response('Invalid path.', { status: 400 })
  if (pathname.startsWith('/gallery-media/')) return galleryImage({ request, env, params: { path: pathname.slice('/gallery-media/'.length).split('/') } })
  if (/^\/api(?:\/|$)/.test(pathname)) {
    if (PUBLIC_APIS.has(pathname) && ['GET', 'HEAD'].includes(request.method)) return context.next()
    return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (/^\/admin(?:\/|$)/.test(pathname)) return redirect(modernLink('/admin'))
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } })
  if (pathname.startsWith(`${LEGACY_PREFIX}/`)) return context.next()
  const mediaKey = legacyMediaKey(pathname)
  if (mediaKey) {
    const image = await env.MEDIA?.get(mediaKey)
    if (!image) return new Response('Image not found.', { status: 404 })
    return new Response(request.method === 'HEAD' ? null : image.body, { headers: {
      'Content-Type': mediaKey.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    } })
  }

  const galleryPage = Number(url.searchParams.get('page'))
  if (/^\/(?:zh\/)?gallery\/[^/]+\/?$/.test(pathname) && Number.isInteger(galleryPage) && galleryPage > 1) {
    const destination = new URL(request.url)
    destination.pathname = `${pathname.replace(/\/$/, '')}/page/${galleryPage}/`
    destination.searchParams.delete('page')
    return redirect(destination.href)
  }
  if (pathname.endsWith('.html')) {
    const destination = new URL(request.url)
    destination.pathname = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '/')
    return redirect(destination.href)
  }

  const asset = new URL(request.url)
  asset.search = ''
  const isAsset = pathname.startsWith('/_assets/')
  if (!isAsset && !pathname.endsWith('/')) {
    const destination = new URL(request.url)
    destination.pathname = `${pathname}/`
    return redirect(destination.href)
  }
  asset.pathname = `${LEGACY_PREFIX}${pathname}`
  const response = await env.ASSETS.fetch(new Request(asset, { method: 'GET' }))
  if (isAsset) {
    if (response.status !== 200 || (response.headers.get('content-type') || '').includes('text/html')) return new Response('Not found.', { status: 404 })
    return request.method === 'HEAD' ? new Response(null, response) : response
  }
  let body = await response.text()
  let status = response.status
  if (!body.includes('data-legacy-page="true"')) {
    asset.pathname = `${LEGACY_PREFIX}/404.html`
    body = await (await env.ASSETS.fetch(new Request(asset))).text()
    status = 404
  }
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Legacy-Site': 'true',
    // Inline, build-owned CSS also works on Safari 9's CSP implementation.
    'Content-Security-Policy': "default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://lrclib.net https://api.github.com; media-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  })
  return new Response(request.method === 'HEAD' ? null : body, { status, headers })
}
