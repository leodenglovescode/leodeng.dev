import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../../workers/daily-ai-traffic/handler.js'

test('private traffic gate canonicalizes identity and fails closed', async () => {
  let calls = 0
  const env = { CHAT_STATE: { getByName(name) {
    assert.equal(name, 'deepseek-public-chat')
    return { async fetch(url, options) {
      calls++
      assert.equal(url, 'https://chat.internal/limit')
      assert.deepEqual(options.headers, { 'cf-connecting-ip': '2001:db8::1' })
      return new Response(null, { status: 429 })
    } }
  } } }
  const request = ip => new Request('https://limiter.internal/', { headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': '192.0.2.1' } })
  assert.equal((await worker.fetch(request('2001:db8:0:0::1'), env)).status, 429)
  assert.equal((await worker.fetch(request('invalid'), env)).status, 400)
  assert.equal(calls, 1)
  assert.equal((await worker.fetch(request('2001:db8::1'), {})).status, 503)
})
