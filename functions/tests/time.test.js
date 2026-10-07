import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../api/time.js'
import { estimateClockSample } from '../../lib/clock.js'

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
    () => Response.json({ ...sample, extra: 'x'.repeat(3000) }),
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
