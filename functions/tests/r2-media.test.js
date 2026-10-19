import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteObject, listObjects, putObject } from '../../scripts/lib/r2.js'
import { createR2MediaStore } from '../../scripts/lib/admin-media.js'

const credentials = { accountId: 'test-account', accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' }
test('R2 requests sign uploads, list with encoded query parameters, and delete only the requested object', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, ...init })
    if (init.method === 'GET') return new Response('<ListBucketResult><Contents><Key>my-image.png</Key><LastModified>2026-10-19T00:00:00Z</LastModified><Size>3</Size></Contents></ListBucketResult>')
    return new Response(null, { status: 200 })
  })
  await putObject(credentials, 'media', 'a b/test.png', Buffer.from('abc'), { contentType: 'image/png', preventOverwrite: true })
  assert.equal(calls[0].url, 'https://test-account.r2.cloudflarestorage.com/media/a%20b/test.png')
  assert.equal(calls[0].headers['if-none-match'], '*')
  assert.equal(calls[0].headers['content-type'], 'image/png')
  assert.match(calls[0].headers.authorization, /SignedHeaders=.*if-none-match/)
  const objects = await listObjects(credentials, 'media')
  assert.deepEqual(objects, [{ key: 'my-image.png', size: 3, uploaded: '2026-10-19T00:00:00Z' }])
  assert.equal(calls[1].url, 'https://test-account.r2.cloudflarestorage.com/media/?delimiter=%2F&list-type=2&max-keys=500')
  assert.equal(calls[1].method, 'GET')
  await deleteObject(credentials, 'media', 'my-image.png')
  assert.equal(calls[2].url, 'https://test-account.r2.cloudflarestorage.com/media/my-image.png')
  assert.equal(calls[2].method, 'DELETE')
  await putObject(credentials, 'media', 'photo.webp', Buffer.from('abc'))
  assert.equal(calls[3].headers['if-none-match'], undefined, 'existing photo derivatives can still be regenerated')
})

test('local R2 store returns publishable URLs, omits nested keys and maps collisions safely', async t => {
  const env = { R2_ACCOUNT_ID: credentials.accountId, R2_ACCESS_KEY_ID: credentials.accessKeyId, R2_SECRET_ACCESS_KEY: credentials.secretAccessKey }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'PUT') return new Response('<Error><Code>PreconditionFailed</Code><Message>private details</Message></Error>', { status: 412 })
    return new Response('<ListBucketResult><Contents><Key>photo.png</Key><Size>3</Size><LastModified>2026-10-19</LastModified></Contents><Contents><Key>photos/gallery.png</Key><Size>2</Size></Contents></ListBucketResult>')
  })
  const store = createR2MediaStore(env)
  const listing = await store.list()
  assert.equal(listing.base, 'https://media.leodeng.dev')
  assert.deepEqual(listing.files.map(file => file.url), ['https://media.leodeng.dev/photo.png'])
  await assert.rejects(store.put('existing.png', Buffer.from('abc'), 'image/png'), error => error.status === 409 && !error.message.includes('private details'))
})
