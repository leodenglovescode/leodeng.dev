import assert from 'node:assert/strict'
import test from 'node:test'
import { loadMonkeyStats, sanitizeMonkeySnapshot, statsJson } from '../../lib/monkeyStats.js'
import { onRequest } from '../api/stats/monkeytype.js'

const snapshot = { username: 'leodeng', profile: { completedTests: 401, timeTyping: 7063, bests: [{ seconds: 60, wpm: 100, accuracy: 99 }] },
  results: [{ wpm: 100, accuracy: 98, timestamp: 1800000000000, mode: 'time', mode2: '60', language: 'english' }] }
function database() {
  let row = null
  return { prepare(sql) {
    let values
    return { bind(...args) { values = args; return this },
      async run() { if (sql.startsWith('INSERT')) row = { payload: values[1], received_at: values[2] } },
      async first() { return row },
    }
  } }
}
const request = (method, body, token) => new Request('https://leodeng.dev/api/stats/monkeytype', {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('authenticated push publishes only sanitized fields and GET reads D1 without upstream fetches', async () => {
  const db = database(), env = { HOMELAB_TOKEN: 'secret', HOMELAB_DB: db }
  assert.equal((await onRequest({ request: request('GET'), env })).status, 200)
  const dirty = { ...snapshot, apiKey: 'private-key', uid: 'private-owner', profile: { ...snapshot.profile, uid: 'private-owner' },
    results: snapshot.results.map(r => ({ ...r, tags: ['private'], uid: 'private-owner', keystrokes: 'private' })) }
  const pushed = await onRequest({ request: request('POST', dirty, 'secret'), env })
  assert.equal(pushed.status, 200)
  const received = (await pushed.json()).receivedAt
  const data = await (await onRequest({ request: request('GET'), env })).json()
  assert.equal(data.profile.completedTests, 401)
  assert.equal(data.history.state, 'ready')
  assert.equal(data.history.results.length, 1)
  assert.equal(data.history.fetchedAt, received)
  assert.doesNotMatch(JSON.stringify(data), /private|uid|apiKey|keystrokes|tags/)
  assert.equal((await loadMonkeyStats(env, received + 7200000)).history.stale, true)
  const invalid = { ...snapshot, username: 'someone-else' }
  assert.equal((await onRequest({ request: request('POST', invalid, 'secret'), env })).status, 400)
  assert.equal((await loadMonkeyStats(env)).history.results.length, 1, 'bad pushes retain last good data')
})

test('ingest fails closed, rejects oversized bodies and unsupported methods/queries', async () => {
  const env = { HOMELAB_TOKEN: 'secret', HOMELAB_DB: database() }
  assert.equal((await onRequest({ request: request('POST', snapshot), env })).status, 401)
  assert.equal((await onRequest({ request: request('POST', snapshot, 'wrong'), env })).status, 401)
  assert.equal((await onRequest({ request: request('POST', snapshot, 'secret'), env: { HOMELAB_DB: env.HOMELAB_DB } })).status, 503)
  assert.equal((await onRequest({ request: request('POST', { extra: 'x'.repeat(300001) }, 'secret'), env })).status, 413)
  assert.equal((await onRequest({ request: request('DELETE'), env })).status, 405)
  assert.equal((await onRequest({ request: new Request('https://example.com/api/stats/monkeytype?user=other'), env })).status, 400)
})

test('snapshot validation enforces bounded, valid numeric data and a single fixed account', () => {
  assert.deepEqual(sanitizeMonkeySnapshot(snapshot), snapshot)
  assert.throws(() => sanitizeMonkeySnapshot({ ...snapshot, results: Array(1001).fill(snapshot.results[0]) }))
  assert.throws(() => sanitizeMonkeySnapshot({ ...snapshot, profile: { ...snapshot.profile, completedTests: -1 } }))
  assert.throws(() => sanitizeMonkeySnapshot({ ...snapshot, results: [{ ...snapshot.results[0], accuracy: 101 }] }))
})

test('bounded JSON utility refuses redirects and oversized responses', async () => {
  await assert.rejects(statsJson('https://example.com', {}, async () => new Response(null, { status: 302 })))
  await assert.rejects(statsJson('https://example.com', {}, async () => Response.json({ huge: 'x'.repeat(2000000) })))
})
