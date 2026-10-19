import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'acorn'
import { createLegacyPreview } from '../../scripts/legacy-server.js'
import { legacyMediaKey } from '../../lib/legacy-media.js'

test('classic runtime parses as ES5 and the stylesheet uses the documented baseline', async () => {
  const runtime = await fs.readFile(new URL('../../legacy/legacy.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => parse(runtime, { ecmaVersion: 5 }))
  const css = await fs.readFile(new URL('../../legacy/legacy.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /display:\s*(?:grid|flex)|\b(?:var|clamp|color-mix)\(|@import|backdrop-filter|animation\s*:/i)
  assert.match(css, /-webkit-box-sizing: border-box/)
  assert.match(css, /float: left/)
  assert.match(css, /@media screen and \(max-width: 699px\)/)
})

test('dedicated preview serves styled HTML without Vite, only public APIs, and cached same-origin JPEGs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-preview-'))
  try {
    const cssFile = path.join(directory, 'source.css')
    await fs.writeFile(cssFile, 'body { background: #edf1f5; }')
    await fs.writeFile(path.join(directory, 'index.html'), '<html data-legacy-page="true"><style id="legacy-style">old</style><main>Hello</main></html>')
    await fs.writeFile(path.join(directory, '404.html'), '<html>Missing</html>')
    let images = 0
    const respond = createLegacyPreview({ directory, cssFile, fetchUpstream: async url => {
      if (url.includes('/legacy/images/')) { images++; return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }) }
      assert.equal(url, 'https://leodeng.dev/api/now-playing')
      return new Response(null, { status: 204 })
    } })
    const request = (route, method = 'GET') => respond(new Request(`http://localhost${route}`, { method }))
    const home = await request('/')
    assert.match(home.headers.get('content-type'), /^text\/html/)
    const html = await home.text()
    assert.match(html, /<style id="legacy-style">body \{ background: #edf1f5; \}<\/style>/)
    assert.doesNotMatch(html, /@vite|type="module"|rel="stylesheet"/)
    const mediaPath = `/_assets/media/${'a'.repeat(64)}.jpg`
    for (let i = 0; i < 2; i++) {
      const image = await request(mediaPath)
      assert.equal(image.headers.get('content-type'), 'image/jpeg')
      assert.equal((await image.arrayBuffer()).byteLength, 3)
    }
    assert.equal(images, 1)
    assert.equal(legacyMediaKey(mediaPath), `legacy/images/${'a'.repeat(64)}.jpg`)
    assert.equal(legacyMediaKey('/_assets/media/../../secret.jpg'), null)
    assert.equal((await request('/api/now-playing')).status, 204)
    assert.equal((await request('/api/auth')).status, 404)
    assert.equal((await request('/api/media', 'POST')).status, 405)
    assert.equal((await request('/%5cprivate')).status, 400)
    assert.equal((await request('/missing/')).status, 404)
    assert.equal((await request('/_legacy')).headers.get('location'), '/_legacy/')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
