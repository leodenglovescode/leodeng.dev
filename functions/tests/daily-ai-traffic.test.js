import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../../workers/daily-ai-traffic/index.js'

test('private limiter enforces both IP and aggregate budgets without trusting forwarded identity', async () => {
  const counts = new Map()
  let overall = 0
  const env = {
    PER_IP: { async limit({ key }) {
      counts.set(key, (counts.get(key) || 0) + 1)
      return { success: counts.get(key) <= 2 }
    } },
    OVERALL: { async limit({ key }) {
      assert.equal(key, 'daily-ai')
      return { success: ++overall <= 3 }
    } },
  }
  const read = ip => worker.fetch(new Request('https://limiter.internal/', {
    headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': crypto.randomUUID() },
  }), env)
  assert.equal((await read('2001:db8:0:0::1')).status, 204)
  assert.equal((await read('2001:db8::1')).status, 204)
  assert.equal((await read('2001:db8::1')).status, 429)
  assert.equal(overall, 2, 'IP-denied requests do not consume the aggregate budget')
  assert.equal((await read('192.0.2.1')).status, 204)
  assert.equal((await read('192.0.2.2')).status, 429)
  assert.equal((await read('invalid')).status, 400)
  assert.equal((await worker.fetch(new Request('https://limiter.internal/', {
    headers: { 'cf-connecting-ip': '192.0.2.3' },
  }), {})).status, 503)
})
