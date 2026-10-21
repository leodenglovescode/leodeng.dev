import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../gallery-media/[[path]].js'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../../src/generated/photos.json', import.meta.url), 'utf8'))
const [collection, entries] = Object.entries(manifest.collections).find(([, entries]) => entries.some(e => e.panorama))
const entry = entries.find(e => e.panorama)
const params = { path: [collection, entry.original] }
const request = (method = 'GET', headers = {}) => new Request('https://example.com/gallery-media/image', { method, headers })

test('only published spherical originals are readable and writes never reach R2', async () => {
  const env = { MEDIA: { get() { throw new Error('Unexpected R2 access') } } }
  for (const path of [[collection, 'unknown.jpg'], ['__proto__', entry.original], [collection, '..', entry.original], ['planespotting', 'private.jpg']]) {
    assert.equal((await onRequest({ request: request(), params: { path }, env })).status, 404)
  }
  assert.equal((await onRequest({ request: request('PUT'), params, env })).status, 405)
})
test('streams unchanged bytes, supports HEAD, and releases conditional response bodies', async () => {
  let cancelled = false
  const object = () => ({ body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('original')) }, cancel() { cancelled = true } }),
    size: 8, httpEtag: '"version"', httpMetadata: { contentType: 'image/jpeg' } })
  const env = { MEDIA: {
    async get(key) { assert.equal(key, `${manifest.prefix}/${collection}/originals/${entry.original}`); return object() },
    async head() { return object() },
  } }
  const head = await onRequest({ request: request('HEAD'), params, env })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  const response = await onRequest({ request: request(), params, env })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg')
  assert.equal(response.headers.get('Content-Length'), '8')
  await response.body.cancel()
  cancelled = false
  const cached = await onRequest({ request: request('GET', { 'If-None-Match': '"version"' }), params, env })
  assert.equal(cached.status, 304)
  assert.equal(cancelled, true)
})
test('missing bindings, objects and R2 failures are not cached', async () => {
  for (const env of [{}, { MEDIA: { get: async () => null } }, { MEDIA: { get: async () => { throw new Error('Offline') } } }]) {
    const response = await onRequest({ request: request(), params, env })
    assert.ok([404, 503].includes(response.status))
    assert.equal(response.headers.get('Cache-Control'), null)
  }
})
