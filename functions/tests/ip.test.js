import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../api/ip.js'
import { parseConnectionTrace, useVisitor } from '../../src/utils/visitor.js'
import { compactUserAgent } from '../../src/utils/userAgent.js'

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

test('returns the request user-agent with a bounded size and handles absent headers', async () => {
  const value = request('203.0.113.9')
  value.headers.set('User-Agent', 'ExampleBrowser/1.0')
  assert.equal((await onRequest({ request: value }).json()).userAgent, 'ExampleBrowser/1.0')
  value.headers.set('User-Agent', 'x'.repeat(3000))
  assert.equal((await onRequest({ request: value }).json()).userAgent.length, 2048)
  value.headers.delete('User-Agent')
  assert.equal((await onRequest({ request: value }).json()).userAgent, null)
})

test('summarizes browsers without confusing compatibility tokens and mobile platforms', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  assert.equal(compactUserAgent(chrome), 'Chrome 141 · Windows')
  assert.equal(compactUserAgent(`${chrome} Edg/141.0.0.0`), 'Edge 141 · Windows')
  assert.equal(compactUserAgent(`${chrome} OPR/123.0`), 'Opera 123 · Windows')
  assert.equal(compactUserAgent('Mozilla/5.0 (Linux; Android 10) Chrome/141.0 Safari/537.36 SamsungBrowser/28.0'), 'Samsung Internet 28 · Android')
  assert.equal(compactUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari 18 · iOS')
  assert.equal(compactUserAgent('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/141.0 Mobile/15E148 Safari/604.1'), 'Chrome 141 · iOS')
  assert.equal(compactUserAgent('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/144.0'), 'Firefox 144 · Linux')
  assert.equal(compactUserAgent('CustomClient/1.0'), null)
  assert.equal(compactUserAgent(null), null)
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
