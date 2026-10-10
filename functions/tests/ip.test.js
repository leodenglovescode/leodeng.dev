import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../api/ip.js'
import { parseConnectionTrace, useVisitor } from '../../src/utils/visitor.js'

const request = (address, cf = {}, options = {}) => {
  const value = new Request('https://leodeng.dev/api/ip', { headers: { 'CF-Connecting-IP': address, Cookie: 'private=secret' }, ...options })
  Object.defineProperty(value, 'cf', { value: cf })
  return value
}

test('returns only visitor metadata without fetching or exposing unrelated fields', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No upstream requests allowed') })
  const response = onRequest({ request: request('203.0.113.9', {
    country: 'TW', city: 'Taipei', region: 'Taipei', asn: 3462, asOrganization: 'Example network',
    tlsVersion: 'TLSv1.3', tlsCipher: 'AEAD-AES128-GCM-SHA256', httpProtocol: 'HTTP/3', colo: 'TPE',
    tlsClientRandom: 'private handshake data', latitude: '25', longitude: '121',
  }) })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  const body = await response.json()
  assert.equal(body.ip, '203.0.113.9')
  assert.equal(body.countryCode, 'TW')
  assert.equal(body.network.asn, 3462)
  assert.equal(body.connection.tlsVersion, 'TLSv1.3')
  assert.doesNotMatch(JSON.stringify(body), /private|latitude|longitude|flag/)
  const other = await onRequest({ request: request('203.0.113.10') }).json()
  assert.equal(other.ip, '203.0.113.10')
  assert.equal(other.countryCode, null)
})

test('preserves real IPv6, tolerates missing metadata, and rejects methods and query parameters', async () => {
  const value = request('240.1.2.3')
  value.headers.set('CF-Connecting-IPv6', '2001:db8::42')
  const result = await onRequest({ request: value }).json()
  assert.equal(result.ip, '2001:db8::42')
  assert.equal(result.ipVersion, 6)
  assert.equal((await onRequest({ request: new Request('https://example.com/api/ip') }).json()).ip, null)
  assert.equal(onRequest({ request: new Request('https://example.com/api/ip?target=private') }).status, 400)
  assert.equal(onRequest({ request: request('203.0.113.9', {}, { method: 'POST' }) }).status, 405)
})

test('distinguishes a negotiated hybrid key exchange from TLS-only or unknown results', () => {
  assert.equal(parseConnectionTrace('tls=TLSv1.3\nkex=X25519MLKEM768\nhttp=http/3').postQuantum, true)
  assert.equal(parseConnectionTrace('tls=TLSv1.3\nkex=X25519').postQuantum, false)
  assert.equal(parseConnectionTrace('tls=TLSv1.3\nkex=NEW-ALGORITHM').postQuantum, null)
  assert.equal(parseConnectionTrace('tls=TLSv1.3').postQuantum, null)
  assert.equal(parseConnectionTrace('tls=TLSv1.2\nkex=X25519MLKEM768').postQuantum, null)
  assert.throws(() => parseConnectionTrace('<html>Not found</html>'))
})

test('footer and page share one request, can refresh, and recover after an error', async t => {
  let calls = 0
  const mock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    return onRequest({ request: request('203.0.113.9') })
  })
  const footer = useVisitor(), page = useVisitor()
  await Promise.all([footer.loadVisitor(), page.loadVisitor()])
  assert.equal(calls, 1)
  await page.loadVisitor()
  assert.equal(calls, 1)
  mock.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }))
  await page.loadVisitor(true)
  assert.equal(page.visitor.value, null)
  assert.equal(page.visitorError.value, true)
  mock.mock.mockImplementation(async () => onRequest({ request: request('2001:db8::1') }))
  await page.loadVisitor(true)
  assert.equal(footer.visitor.value.ip, '2001:db8::1')
  assert.equal(page.visitorError.value, false)
})
