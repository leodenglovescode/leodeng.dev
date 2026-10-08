import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../api/terminal-audio/[name].js'
import { recordings } from '../../src/utils/terminal/recordings.js'

test('only the two welcome recordings are readable, and writes are rejected', async () => {
  let reads = 0
  const env = { MEDIA: { get() { reads++; throw new Error('Unexpected read') } } }
  const unknown = await onRequest({ request: new Request('https://example.com/audio'), env, params: { name: 'private.mp3' } })
  assert.equal(unknown.status, 404)
  const write = await onRequest({ request: new Request('https://example.com/audio', { method: 'POST' }), env, params: { name: recordings.en.split('/').at(-1) } })
  assert.equal(write.status, 405)
  assert.equal(reads, 0)
})

test('streams the selected recording from MEDIA and supports HEAD', async () => {
  for (const url of Object.values(recordings)) {
    const name = url.split('/').at(-1)
    const env = { MEDIA: {
      async get(key) {
        assert.equal(key, `voice/${name}`)
        return { body: new Blob(['audio bytes']).stream(), size: 11, httpEtag: '"version"' }
      },
      async head(key) { assert.equal(key, `voice/${name}`); return { size: 11, httpEtag: '"version"' } },
    } }
    for (const method of ['GET', 'HEAD']) {
      const response = await onRequest({ request: new Request(url, { method }), env, params: { name } })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'audio/mpeg')
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'audio bytes')
    }
  }
})

test('reports unavailable recordings without caching the failure', async () => {
  for (const env of [{}, { MEDIA: { get: async () => null } }, { MEDIA: { get: async () => { throw new Error('Offline') } } }]) {
    const response = await onRequest({ request: new Request(recordings.en), env, params: { name: recordings.en.split('/').at(-1) } })
    assert.ok([404, 503].includes(response.status))
    assert.equal(response.headers.get('Cache-Control'), null)
  }
})
