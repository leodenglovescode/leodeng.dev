import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { consume, initialize, LIMITS } from '../../workers/lyrics-traffic/counters.js'
import { canonicalLyricsIp, lyricsLimiter } from '../../lib/lyricsLimits.js'
import { onRequest } from '../api/lyrics.js'

function database() {
  const db = new DatabaseSync(':memory:')
  const sql = { exec(query, ...args) {
    const statement = db.prepare(query)
    if (statement.columns().length) return { toArray: () => statement.all(...args) }
    statement.run(...args)
    return { toArray: () => [] }
  } }
  initialize(sql)
  return { sql, db }
}

test('per-IP quota is exact, shared independently of track, persistent and resets next minute', () => {
  const { sql, db } = database()
  try {
    for (let n = 0; n < LIMITS.perIp; n++) assert.equal(consume(sql, 'request', 'a', 60000), true)
    assert.equal(consume(sql, 'request', 'a', 119999), false)
    initialize(sql)
    assert.equal(consume(sql, 'request', 'a', 119999), false)
    assert.equal(sql.exec('SELECT used FROM counters WHERE key = ?', 'requests').toArray()[0].used, 20)
    assert.equal(consume(sql, 'request', 'b', 119999), true)
    assert.equal(consume(sql, 'request', 'a', 120000), true)
  } finally { db.close() }
})

test('global quotas bound IP spray and both providers; denials do not create rows or spend other quotas', () => {
  const { sql, db } = database()
  try {
    for (let n = 0; n < LIMITS.requests; n++) assert.equal(consume(sql, 'request', String(n), 60000), true)
    for (let n = 0; n < 1000; n++) assert.equal(consume(sql, 'request', 'denied' + n, 60000), false)
    assert.equal(sql.exec('SELECT COUNT(*) AS n FROM counters').toArray()[0].n, 301)
    for (let n = 0; n < LIMITS.upstream; n++) assert.equal(consume(sql, 'upstream', 'a', 60000), true)
    assert.equal(consume(sql, 'upstream', 'b', 60000), false)
    assert.equal(consume(sql, 'upstream', 'b', 120000), true)
    consume(sql, 'request', 'new', 240000)
    assert.equal(sql.exec('SELECT COUNT(*) AS n FROM counters').toArray()[0].n, 2)
  } finally { db.close() }
})

function environment(handler) {
  return { LYRICS_IP_HASH_KEY: 'test-placeholder'.repeat(3), LYRICS_TRAFFIC: {
    idFromName: name => { assert.equal(name, 'public-lyrics-v1'); return name },
    get: () => ({ fetch: async (url, options) => { assert.equal(url, 'https://lyrics-limit.internal/check'); return handler(JSON.parse(options.body)) } }),
  } }
}
const request = (ip = '192.0.2.1', origin = 'https://leodeng.dev') => new Request(origin + '/api/lyrics?track_name=Song&artist_name=Artist&duration=180', { headers: {
  ...(ip ? { 'CF-Connecting-IP': ip } : {}), 'X-Forwarded-For': '203.0.113.100',
} })

test('trusted IP is canonicalized and HMAC hashed; equivalent IPv6 and both domains share identity', async () => {
  assert.equal(canonicalLyricsIp('bad'), null)
  assert.equal(canonicalLyricsIp('999.0.0.1'), null)
  assert.equal(canonicalLyricsIp('2001:db8:0:0::1'), canonicalLyricsIp('2001:db8::1'))
  const identities = []
  const env = environment(body => { identities.push(body.identity); assert.match(body.identity, /^[a-f0-9]{64}$/); return new Response(null, { status: 204 }) })
  for (const req of [request('2001:db8:0:0::1'), request('2001:db8::1', 'https://old.leodeng.dev')]) assert.equal(await (await lyricsLimiter(req, env)).check('request'), null)
  assert.equal(identities[0], identities[1])
})

test('missing identity, binding, secret or failed coordinator fails closed', async () => {
  for (const [req, env] of [[request(null), environment(() => assert.fail())], [request(), {}], [request(), environment(() => { throw new Error('private details') })]]) {
    const response = await (await lyricsLimiter(req, env)).check('request')
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.doesNotMatch(await response.text(), /private details/)
  }
})

test('cache hits still spend request quota; denied requests cannot touch cache or either upstream', async () => {
  const originalCaches = globalThis.caches, originalFetch = globalThis.fetch
  const phases = []
  let reads = 0, denied = false
  const env = environment(body => { phases.push(body.phase); return new Response(null, { status: denied ? 429 : 204, headers: { 'Retry-After': '42' } }) })
  try {
    globalThis.caches = { default: { match: async () => { reads++; return Response.json({ syncedLyrics: 'cached' }) } } }
    globalThis.fetch = () => assert.fail('Must not call either provider')
    assert.equal((await onRequest({ request: request(), env })).status, 200)
    denied = true
    const response = await onRequest({ request: request(), env })
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('Retry-After'), '42')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(reads, 1)
    assert.deepEqual(phases, ['request', 'request'])
  } finally { globalThis.caches = originalCaches; globalThis.fetch = originalFetch }
})

test('global cache-miss denial never calls providers or poisons the cache', async () => {
  const originalCaches = globalThis.caches, originalFetch = globalThis.fetch
  const phases = []
  try {
    globalThis.caches = { default: { match: async () => undefined, put: () => assert.fail('Must not cache a quota response') } }
    globalThis.fetch = () => assert.fail('Must not call either provider')
    const env = environment(body => { phases.push(body.phase); return new Response(null, { status: body.phase === 'upstream' ? 429 : 204 }) })
    assert.equal((await onRequest({ request: request(), env, waitUntil: () => assert.fail() })).status, 429)
    assert.deepEqual(phases, ['request', 'upstream'])
  } finally { globalThis.caches = originalCaches; globalThis.fetch = originalFetch }
})
