import assert from 'node:assert/strict'
import test from 'node:test'
import { loadMonkeyStats, monkeyProfile, monkeyResults, statsJson } from '../../lib/monkeyStats.js'
import { onRequest } from '../api/stats/monkeytype.js'

const now = 1800000000000
const profile = { name: 'leodeng', uid: 'owner', typingStats: { completedTests: 393, timeTyping: 7063 }, personalBests: { time: { '60': [
  { wpm: 100, acc: 99, language: 'english', difficulty: 'normal' },
  { wpm: 500, acc: 99, language: 'english', difficulty: 'normal', lazyMode: true },
] } } }
const result = { uid: 'owner', wpm: 100, acc: 98, timestamp: now, mode: 'time', mode2: 60, language: 'english', tags: ['private'], _id: 'private' }
function database() {
  const row = { payload: null, fetched_at: null, refresh_after: 0 }
  return { row, prepare(sql) {
    let values = []
    return { bind(...args) { values = args; return this },
      async run() { if (sql.startsWith('UPDATE personal_stats_cache SET payload')) { row.payload = values[0]; row.fetched_at = values[1] } },
      async first() {
        if (sql.startsWith('SELECT')) return { ...row }
        if (sql.includes('RETURNING')) { if (row.refresh_after > values[2]) return null; row.refresh_after = values[0]; return { name: 'monkeytype-leodeng' } }
        throw new Error('Unexpected SQL')
      },
    }
  } }
}

test('public stats work without credentials and standard bests exclude nonstandard tests', async () => {
  const data = await loadMonkeyStats({}, async (url, options) => {
    assert.equal(url, 'https://api.monkeytype.com/users/leodeng/profile')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.redirect, 'manual')
    return Response.json({ data: profile })
  }, now)
  assert.equal(data.profile.completedTests, 393)
  assert.equal(data.profile.bests[0].wpm, 100)
  assert.equal(data.history.state, 'not-connected')
  assert.doesNotMatch(JSON.stringify(data), /owner|private/)
  assert.throws(() => monkeyProfile({ ...profile, name: 'someone-else' }))
})

test('one shared history refresh per hour, safe publication and stale data on refresh failure', async () => {
  const db = database(), env = { MONKEYTYPE_API_KEY: 'secret', HOMELAB_DB: db }
  let calls = 0
  const fetcher = async (url, options) => {
    if (url.includes('/profile')) { assert.equal(options.headers.Authorization, 'ApeKey secret'); return Response.json({ data: profile }) }
    calls++
    assert.equal(url, 'https://api.monkeytype.com/results?limit=1000')
    assert.equal(options.headers.Authorization, 'ApeKey secret')
    if (calls > 1) throw new Error('Upstream unavailable')
    return Response.json({ data: [result] })
  }
  const first = await loadMonkeyStats(env, fetcher, now)
  assert.equal(first.history.state, 'ready')
  assert.equal(first.history.results.length, 1)
  assert.doesNotMatch(JSON.stringify(first), /secret|owner|private|_id|uid|tags/)
  await Promise.all(Array.from({ length: 10 }, () => loadMonkeyStats(env, fetcher, now + 1000)))
  assert.equal(calls, 1)
  const stale = await loadMonkeyStats(env, fetcher, now + 3600000)
  assert.equal(calls, 2)
  assert.equal(stale.history.stale, true)
  assert.equal(stale.history.results.length, 1)
  await loadMonkeyStats(env, fetcher, now + 3600001)
  assert.equal(calls, 2, 'failed attempts also reserve the hour')
})

test('wrong-account private results are not published, and missing D1 never requests private history', async () => {
  assert.throws(() => monkeyResults([{ ...result, uid: 'other-account' }], 'owner'))
  const env = { MONKEYTYPE_API_KEY: 'secret', HOMELAB_DB: database() }
  const data = await loadMonkeyStats(env, async url => Response.json({ data: url.includes('/profile') ? profile : [{ ...result, uid: 'other' }] }), now)
  assert.equal(data.history.state, 'unavailable')
  assert.deepEqual(data.history.results, [])
  let calls = 0
  await loadMonkeyStats({ MONKEYTYPE_API_KEY: 'secret' }, async url => { calls++; assert.ok(url.includes('/profile')); return Response.json({ data: profile }) }, now)
  assert.equal(calls, 1)
})

test('stats endpoint rejects writes and arbitrary queries; upstream reads are bounded and refuse redirects', async () => {
  assert.equal((await onRequest({ request: new Request('https://example.com/api/stats/monkeytype', { method: 'POST' }), env: {} })).status, 405)
  assert.equal((await onRequest({ request: new Request('https://example.com/api/stats/monkeytype?user=someone-else'), env: {} })).status, 400)
  await assert.rejects(statsJson('https://api.monkeytype.com/users/leodeng/profile', {}, async () => new Response(null, { status: 302 })))
  await assert.rejects(statsJson('https://api.monkeytype.com/users/leodeng/profile', {}, async () => Response.json({ huge: 'x'.repeat(2000000) })))
})

test('profile lookup failures do not consume the private history refresh slot', async () => {
  const db = database(), env = { MONKEYTYPE_API_KEY: 'secret', HOMELAB_DB: db }
  const failed = await loadMonkeyStats(env, async () => Response.json({}, { status: 429 }), now)
  assert.equal(failed.profile, null)
  assert.equal(db.row.refresh_after, 0)
  let historyCalls = 0
  const recovered = await loadMonkeyStats(env, async (url, options) => {
    assert.equal(options.headers.Authorization, 'ApeKey secret')
    if (url.includes('/profile')) return Response.json({ data: profile })
    historyCalls++
    return Response.json({ data: [result] })
  }, now + 1000)
  assert.equal(recovered.history.state, 'ready')
  assert.equal(historyCalls, 1)
})


test('upstream rate-limit diagnostics contain only fixed classifications', async () => {
  for (const [message, reason] of [
    ['Too many bad authentication attempts, please try again later.', 'bad_auth_limit'],
    ['Maximum API request (root) limit reached. Please try again later.', 'root_limit'],
    ['Request limit reached, please try again later.', 'endpoint_limit'],
  ]) {
    await assert.rejects(statsJson('https://api.monkeytype.com/users/leodeng/profile', {},
      async () => Response.json({ message, data: { uid: 'private-owner' } }, { status: 429 })), error => {
      assert.equal(error.statsReason, reason)
      assert.equal(error.statsStatus, 429)
      assert.equal(error.statsPhase, 'response')
      assert.doesNotMatch(JSON.stringify(error), /private-owner|Too many|Maximum API/)
      return true
    })
  }
})
