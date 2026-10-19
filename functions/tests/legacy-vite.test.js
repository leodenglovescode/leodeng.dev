import assert from 'node:assert/strict'
import test from 'node:test'
import { legacyPreviewPlugin } from '../../scripts/legacy-dev.js'

test('Vite handles the classic player root lyrics API before the SPA fallback', async () => {
  let middleware, calls = 0
  const plugin = legacyPreviewPlugin({ fetchUpstream: async (url, options) => {
    calls++
    assert.equal(url, 'https://lrclib.net/api/get?track_name=Everlong&artist_name=Foo+Fighters&duration=250')
    assert.equal(options.redirect, 'error')
    return Response.json({ duration: 251, syncedLyrics: '[00:01]Example' })
  } })
  plugin.configureServer({ config: { root: process.cwd() }, middlewares: { use: handler => { middleware = handler } } })
  function response() {
    return { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(body) { this.body = body?.toString() } }
  }
  const result = response()
  await middleware({ method: 'GET', url: '/api/lyrics?track_name=Everlong&artist_name=Foo%20Fighters&duration=250' }, result, () => assert.fail('Must not return SPA HTML'))
  assert.equal(result.statusCode, 200)
  assert.match(result.headers['content-type'], /application\/json/)
  assert.equal(JSON.parse(result.body).syncedLyrics, '[00:01]Example')
  assert.equal(calls, 1)
  let passed = false
  await middleware({ method: 'GET', url: '/api/lyrics-other' }, response(), () => { passed = true })
  assert.equal(passed, true)
})
