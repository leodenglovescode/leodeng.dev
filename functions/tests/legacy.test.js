import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../_middleware.js'
import { cleanLegacyPath, isLegacyBrowser } from '../../lib/legacy.js'
import { readableContent, relativeLink } from '../../scripts/build-legacy.js'

const ipad = 'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G36 Safari/601.1'
const modern = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
function setup(url, { ua = ipad, cookie = '', enabled = 'true', method = 'GET', accept = 'text/html' } = {}) {
  const requests = []
  let nextCalls = 0
  return {
    context: {
      request: new Request(url, { method, headers: { 'user-agent': ua, cookie, accept } }),
      env: { LEGACY_SITE_ENABLED: enabled, ASSETS: { fetch: async request => {
        const path = new URL(request.url).pathname; requests.push(path)
        const known = ['/_legacy/', '/_legacy/about/', '/_legacy/404.html'].includes(path)
        return new Response(known ? '<html data-legacy-page="true">Readable page</html>' : '<html>Modern SPA fallback</html>', { headers: { 'content-type': 'text/html' } })
      } } },
      next: async () => { nextCalls++; return new Response('Modern site or existing endpoint', { headers: { 'X-Original': 'kept' } }) },
    }, requests, nextCalls: () => nextCalls,
  }
}

test('known old engines are detected without redirecting modern browsers or crawlers', () => {
  assert.equal(isLegacyBrowser(ipad), true)
  assert.equal(isLegacyBrowser(modern), false)
  assert.equal(isLegacyBrowser('Mozilla/5.0 Chrome/110.0.0.0 Safari/537.36'), true)
  assert.equal(isLegacyBrowser('Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36'), false)
  assert.equal(isLegacyBrowser('Mozilla/5.0 Firefox/128.0'), false)
  assert.equal(isLegacyBrowser('Mozilla/5.0 Googlebot/2.1 Chrome/90.0'), false)
  assert.equal(isLegacyBrowser('Unrecognized browser'), false)
})

test('automatic redirects preserve routes and queries, require opt-in and respect preferences', async () => {
  const active = setup('https://leodeng.dev/zh/blog/example?ref=home')
  const response = await onRequest(active.context)
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://old.leodeng.dev/zh/blog/example?ref=home&redirected=older-browser')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  for (const options of [{ enabled: '' }, { ua: modern }, { cookie: 'other=x; site_view=modern' }, { accept: 'application/json' }]) {
    const skipped = setup('https://leodeng.dev/about', options)
    assert.equal((await onRequest(skipped.context)).status, 200)
    assert.equal(skipped.nextCalls(), 1)
  }
  const preference = setup('https://leodeng.dev/about?view=modern')
  const preferred = await onRequest(preference.context)
  assert.match(preferred.headers.get('set-cookie'), /^site_view=modern;.*HttpOnly/)
  assert.equal(preferred.headers.get('x-original'), 'kept')
})

test('API traffic and admin authentication on the main host are not redirected', async () => {
  for (const route of ['/api/auth', '/api/internal/now-playing', '/api/me', '/assets/app.js']) {
    const sample = setup(`https://leodeng.dev${route}`)
    assert.equal((await onRequest(sample.context)).status, 200)
    assert.equal(sample.nextCalls(), 1)
  }
})

test('legacy host serves only the simple assets and cannot fall through to the Vue app', async () => {
  const home = setup('https://old.leodeng.dev/')
  const response = await onRequest(home.context)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /data-legacy-page/)
  assert.deepEqual(home.requests, ['/_legacy/'])
  const missing = setup('https://old.leodeng.dev/missing/')
  assert.equal((await onRequest(missing.context)).status, 404)
  assert.deepEqual(missing.requests, ['/_legacy/missing/', '/_legacy/404.html'])
  const head = setup('https://old.leodeng.dev/', { method: 'HEAD' })
  assert.equal(await (await onRequest(head.context)).text(), '')
  const page = setup('https://old.leodeng.dev/gallery/planespotting?page=2')
  assert.equal((await onRequest(page.context)).headers.get('location'), 'https://old.leodeng.dev/gallery/planespotting/page/2/')
})

test('legacy host is read-only and exposes no admin, upload or ingest routes', async () => {
  for (const route of ['/api/auth', '/api/gh/contents', '/api/media', '/api/internal/now-playing']) {
    const sample = setup(`https://old.leodeng.dev${route}`)
    assert.equal((await onRequest(sample.context)).status, 404)
    assert.equal(sample.nextCalls(), 0)
  }
  const post = setup('https://old.leodeng.dev/api/now-playing', { method: 'POST' })
  assert.equal((await onRequest(post.context)).status, 404)
  const read = setup('https://old.leodeng.dev/api/homelab')
  assert.equal((await onRequest(read.context)).status, 200)
  assert.equal(read.nextCalls(), 1)
  const editor = setup('https://old.leodeng.dev/admin')
  assert.equal((await onRequest(editor.context)).headers.get('location'), 'https://leodeng.dev/admin?view=modern')
})

test('production classic images are restricted to JPEG keys and styling is allowed without modern CSP features', async () => {
  const sample = setup('https://old.leodeng.dev/')
  const response = await onRequest(sample.context)
  assert.match(response.headers.get('content-security-policy'), /style-src 'self' 'unsafe-inline'/)
  const picture = setup(`https://old.leodeng.dev/_assets/media/${'a'.repeat(64)}.jpg`)
  picture.context.env.MEDIA = { get: async key => {
    assert.equal(key, `legacy/images/${'a'.repeat(64)}.jpg`)
    return { body: new Uint8Array([0xff, 0xd8, 0xff]) }
  } }
  const image = await onRequest(picture.context)
  assert.equal(image.headers.get('content-type'), 'image/jpeg')
  assert.equal(image.status, 200)
  assert.equal(picture.requests.length, 0)
})

test('shared HTML becomes readable content with working relative links and compatible images', () => {
  const html = readableContent('<main><h1>A &amp; B</h1><article><p>Same words.</p><a href="/blog/example">Read</a><img src="/avatar.webp" alt="Portrait"><button>Copy</button><script>bad()</script><div data-legacy-hide="true">Clock</div></article></main>', '/about', { images: { '/avatar.webp': 'https://media.leodeng.dev/legacy/avatar.jpg' } })
  assert.match(html, /Same words\./)
  assert.match(html, /href="..\/blog\/example\/"/)
  assert.match(html, /src="https:\/\/media.leodeng.dev\/legacy\/avatar.jpg"/)
  assert.doesNotMatch(html, /button|script|Clock|\.webp/)
  assert.equal(relativeLink('/zh/blog/example', '/zh/projects'), '../../projects/')
  assert.equal(cleanLegacyPath('/%2e%2e/private'), null)
  assert.equal(cleanLegacyPath('/%5cprivate'), null)
  assert.equal(cleanLegacyPath('/%00'), null)
})
