import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../api/media/[[path]].js'

function authenticate(t) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ login: 'leodenglovescode' })))
}
const request = (method = 'GET', name, headers = {}) => new Request(`https://example.test/api/media${name ? `/${name}` : ''}`, {
  method, headers: { Cookie: 'gh_session=test-session', 'X-Admin': '1', ...headers },
  ...(method === 'PUT' ? { body: 'image bytes' } : {}),
})

test('library includes uploads past the first R2 page and their original filenames, newest first', async t => {
  authenticate(t)
  const calls = []
  const response = await onRequest({ request: request(), params: {}, env: { MEDIA: {
    async list(options) {
      calls.push(options)
      return options.cursor ? { objects: [{ key: 'z.jpg', size: 9, uploaded: new Date('2026-10-24'), customMetadata: { originalname: encodeURIComponent('假期 IMG_1234.JPG') } }], truncated: false }
        : { objects: [{ key: 'a.jpg', size: 5, uploaded: new Date('2026-01-01') }], truncated: true, cursor: 'next-page' }
    },
  } } })
  const data = await response.json()
  assert.equal(calls[1].cursor, 'next-page')
  assert.deepEqual(calls[0].include, ['customMetadata'])
  assert.equal(calls[0].delimiter, '/')
  assert.deepEqual(data.files.map(file => file.originalName), ['假期 IMG_1234.JPG', 'a.jpg'])
})
test('uploads preserve original filenames as metadata and return insertion URLs', async t => {
  authenticate(t)
  let options
  const env = { MEDIA: { async put(key, body, supplied) {
    assert.equal(key, 'file.jpg')
    assert.ok(body instanceof ReadableStream)
    options = supplied
    return { size: 11, uploaded: new Date('2026-10-24') }
  } } }
  const name = '假期 100% [1].JPG'
  const response = await onRequest({ request: request('PUT', 'file.jpg', { 'X-Original-Filename': encodeURIComponent(name) }), params: { path: ['file.jpg'] }, env })
  assert.equal(response.status, 201)
  assert.equal(decodeURIComponent(options.customMetadata.originalname), name)
  assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' })
  const file = await response.json()
  assert.equal(file.originalName, name)
  assert.equal(file.url, 'https://media.leodeng.dev/file.jpg')
})
test('collisions do not overwrite photos, and malformed metadata is rejected before storage', async t => {
  authenticate(t)
  let puts = 0
  const env = { MEDIA: { async put() { puts++; return null } } }
  const response = await onRequest({ request: request('PUT', 'file.jpg'), params: { path: ['file.jpg'] }, env })
  assert.equal(response.status, 409)
  for (const name of ['%broken', encodeURIComponent('bad\nname.jpg'), 'a'.repeat(513)]) {
    const invalid = await onRequest({ request: request('PUT', 'file.jpg', { 'X-Original-Filename': name }), params: { path: ['file.jpg'] }, env })
    assert.equal(invalid.status, 400)
  }
  assert.equal(puts, 1)
})
