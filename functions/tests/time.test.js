import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../api/time.js'
import { clockDiagnostics, clockStability, estimateClockSample } from '../../lib/clock.js'

const sample = { receivedAtMs: 1000100, sentAtMs: 1000120, synchronized: true, source: 'gps-pps', stratum: 1 }
const env = { CLOCK_ACCESS_CLIENT_ID: 'test-id', CLOCK_ACCESS_CLIENT_SECRET: 'test-secret' }
const context = (url = 'https://leodeng.dev/api/time', method = 'GET') => ({
  request: new Request(url, { method, headers: { Cookie: 'private-session', 'X-Attacker': 'value' } }), env,
})

test('four timestamps remove origin processing and correct a wrong device clock', () => {
  const result = estimateClockSample(sample, 900000, 300)
  assert.equal(result.nowMs, 1000260)
  assert.equal(result.networkMs, 280)
  assert.equal(result.offsetMs, 99960)
  assert.equal(estimateClockSample({ ...sample, sentAtMs: 999999 }, 900000, 300), null)
  assert.equal(estimateClockSample({ ...sample, synchronized: false }, 900000, 300), null)
})

test('public proxy restricts input and strips origin data and visitor headers', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url, 'https://clock-origin.leodeng.dev/time')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers['CF-Access-Client-Secret'], 'test-secret')
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.headers['X-Attacker'], undefined)
    return Response.json({ ...sample, diagnostic: '<script>bad()</script>' }, {
      headers: { 'Set-Cookie': 'leak=true' },
    })
  })
  const response = await onRequest(context())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), sample)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await onRequest(context('https://leodeng.dev/api/time?url=http://192.168.3.1'))).status, 400)
  assert.equal((await onRequest(context(undefined, 'POST'))).status, 405)
  assert.equal(calls, 1)
})

test('unhealthy, oversized, non-JSON, and failing origins all fail closed', async t => {
  for (const origin of [
    () => Response.json({ ...sample, source: '<img onerror=bad()>' }),
    () => Response.json({ ...sample, synchronized: false }),
    () => Response.json({ ...sample, extra: 'x'.repeat(17000) }),
    () => new Response('<html>login</html>'),
    () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
    () => { throw new Error('secret origin diagnostic') },
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => origin())
    const response = await onRequest(context())
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Clock unavailable' })
    mock.mock.restore()
  }
})

test('only valid aggregate satellite counts cross the public boundary', async t => {
  for (const satellites of [
    { used: 6, visible: 10, lat: 31, lon: 121, observations: [{ PRN: 1, az: 100 }] },
    { used: 0, visible: 0 }, { used: -1, visible: 10 }, { used: 11, visible: 10 },
    { used: 1.5, visible: 10 }, { used: '6', visible: 10 }, { used: 1, visible: 513 },
    null,
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({
      ...sample, satellites, latitude: 31, longitude: 121,
    }))
    const response = await onRequest(context())
    assert.equal(response.status, 200)
    const expected = satellites?.used === 6 ? { used: 6, visible: 10 }
      : satellites?.visible === 0 ? { used: 0, visible: 0 } : null
    assert.deepEqual(await response.json(), { ...sample, ...(expected ? { satellites: expected } : {}) })
    mock.mock.restore()
  }
})

test('clock diagnostics allow only bounded numeric measurements and never raw GPS reports', async t => {
  const clean = {
    receiver: { fixMode: 3, tdop: 1.12 },
    tracking: { systemOffsetSeconds: -0.000002, lastOffsetSeconds: 0, rmsOffsetSeconds: 0.000003,
      frequencyPpm: -9.5, residualFrequencyPpm: 0.02, skewPpm: 0.1,
      rootDelaySeconds: 0, rootDispersionSeconds: 0.000014,
      referenceAgeSeconds: 4, updateIntervalSeconds: 16, sampleAgeSeconds: 2, lockedForSeconds: 120 },
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ...sample, ...clean,
    receiver: { ...clean.receiver, lat: 1, lon: 2, satellites: [{ PRN: 5, az: 20, el: 67 }] },
    tracking: { ...clean.tracking, reference: 'private-source.example', diagnostics: 'private' },
    satellites: { used: 9, tracked: 12, visible: 14, PRN: 5 },
  }))
  const response = await onRequest(context())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ...sample, ...clean, satellites: { used: 9, visible: 14, tracked: 12 } })
  assert.deepEqual(clockDiagnostics({ receiver: { fixMode: 0, tdop: 0 }, tracking: { lockedForSeconds: 0 } }),
    { receiver: { fixMode: 0, tdop: 0 }, tracking: { lockedForSeconds: 0 } })
  assert.deepEqual(clockDiagnostics({ receiver: { fixMode: true, tdop: Infinity }, tracking: {
    systemOffsetSeconds: '0.1', rmsOffsetSeconds: -1, lockedForSeconds: -1,
    sampleAgeSeconds: 31, frequencyPpm: NaN, referenceAgeSeconds: 9999,
  } }), {})
  assert.deepEqual(clockDiagnostics(null), {})
})

test('stability history contains only valid bounded UTC daily aggregates', async t => {
  const now = Date.UTC(2026, 10, 19, 12)
  const stability = { intervalSeconds: 10, path: '/private/state', days: [
    { date: '2026-11-19', observed: 300, locked: 299, location: 'private' },
    { date: '2026-11-18', observed: 8640, locked: 8640 },
  ] }
  const expected = { intervalSeconds: 10, days: [
    { date: '2026-11-18', observed: 8640, locked: 8640 },
    { date: '2026-11-19', observed: 300, locked: 299 },
  ] }
  assert.deepEqual(clockStability(stability, now), expected)
  for (const invalid of [
    { ...stability, intervalSeconds: 1 },
    { ...stability, days: [stability.days[0], stability.days[0]] },
    ...[
      { date: '2026-11-20', observed: 1, locked: 1 },
      { date: '2025-11-19', observed: 1, locked: 1 },
      { date: '2026-09-31', observed: 1, locked: 1 },
      { date: '<script>', observed: 1, locked: 1 },
      { date: '2026-11-19', observed: 0, locked: 0 },
      { date: '2026-11-19', observed: 8641, locked: 1 },
      { date: '2026-11-19', observed: 1, locked: 2 },
    ].map(day => ({ intervalSeconds: 10, days: [day] })),
  ]) assert.equal(clockStability(invalid, now), null)
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ...sample, receivedAtMs: now, sentAtMs: now + 1, stability,
  }))
  const response = await onRequest(context())
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).stability, expected)
})

test('busy origin retains bounded retry advice and absent secrets never fetch', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(null, { status: 429, headers: { 'Retry-After': '999999' } })
  })
  const response = await onRequest(context())
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '3600')
  assert.equal((await onRequest({ ...context(), env: {} })).status, 503)
  assert.equal(calls, 1)
})

test('an origin that stalls is aborted within the timeout', async t => {
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  assert.equal((await onRequest(context())).status, 503)
})
