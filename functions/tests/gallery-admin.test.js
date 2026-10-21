import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../api/gh/[[path]].js'
const target = 'repos/leodenglovescode/leodeng.dev/contents/src/generated/photos.json'
const gallery = { base: 'https://media.leodeng.dev', prefix: 'photos', collections: { trips: [{ name: 'one', metadata: { caption: 'Edited', location: { latitude: 0, longitude: -1 } } }] } }
function request(method, data) {
  return { request: new Request('https://leodeng.dev/api/gh/'+target, { method, headers: { Cookie: 'gh_session=test-token', 'X-Admin': '1', 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }), env: {}, params: { path: target.split('/') } }
}
test('production gallery saves validated JSON with the existing authenticated GitHub proxy', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let writes = 0
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.github.com/user') return Response.json({ login: 'leodenglovescode' })
    writes++
    assert.equal(options.method, 'PUT')
    assert.equal(options.headers.authorization, 'Bearer test-token')
    assert.equal(JSON.parse(options.body).sha, 'current')
    return Response.json({ content: { sha: 'next' } })
  }
  const content = Buffer.from(JSON.stringify(gallery)).toString('base64')
  assert.equal((await onRequest(request('PUT', { content, sha: 'current' }))).status, 200)
  assert.equal(writes, 1)
  const bad = structuredClone(gallery); bad.collections.trips[0].metadata.location.latitude = 91
  assert.equal((await onRequest(request('PUT', { content: Buffer.from(JSON.stringify(bad)).toString('base64') }))).status, 400)
  assert.equal((await onRequest(request('DELETE', { sha: 'current' }))).status, 405)
  assert.equal(writes, 1)
})
