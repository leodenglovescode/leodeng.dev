import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('real Workers runtime enforces concurrent quotas through the private Durable Object binding', async () => {
  const bundle = await build({ entryPoints: ['workers/lyrics-traffic/index.js'], bundle: true, format: 'esm', external: ['cloudflare:workers'], write: false })
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'lyrics-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01',
    durableObjects: { LIMITER: { className: 'LyricsTraffic', useSQLite: true } },
  }))
  try {
    assert.equal((await mf.dispatchFetch('https://example.test/check')).status, 404)
    const namespace = await mf.getDurableObjectNamespace('LIMITER', 'lyrics-test')
    // Keep concurrent assertions within one fixed minute even near a boundary.
    const remaining = 60000 - Date.now() % 60000
    if (remaining < 5000) await new Promise(resolve => setTimeout(resolve, remaining + 50))
    const id = namespace.idFromName('test-lyrics')
    const stub = namespace.get(id)
    const check = (phase, identity = 'a'.repeat(64)) => stub.fetch('https://lyrics-limit.internal/check', { method: 'POST', body: JSON.stringify({ phase, identity }) })
    const responses = await Promise.all(Array.from({ length: 25 }, () => check('request')))
    assert.equal(responses.filter(r => r.status === 204).length, 20)
    assert.equal(responses.filter(r => r.status === 429).length, 5)
    assert.ok(Number(responses.find(r => r.status === 429).headers.get('Retry-After')) > 0)
    await mf.unsafeEvictDurableObject('lyrics-test', 'LyricsTraffic', { id: id.toString() })
    const reacquired = namespace.get(id)
    assert.equal((await reacquired.fetch('https://lyrics-limit.internal/check', { method: 'POST', body: JSON.stringify({ phase: 'request', identity: 'a'.repeat(64) }) })).status, 429)
    const upstream = await Promise.all(Array.from({ length: 35 }, () => check('upstream')))
    assert.equal(upstream.filter(r => r.status === 204).length, 30)
    assert.equal(upstream.filter(r => r.status === 429).length, 5)
    const others = await Promise.all(Array.from({ length: 290 }, (_, n) => check('request', n.toString(16).padStart(64, '0'))))
    assert.equal(others.filter(r => r.status === 204).length, 280)
    assert.equal(others.filter(r => r.status === 429).length, 10)
    assert.equal((await check('bad')).status, 400)
    assert.equal((await check('request', 'raw-ip')).status, 400)
    assert.equal((await stub.fetch('https://lyrics-limit.internal/check', { method: 'POST', body: 'x'.repeat(300) })).status, 400)
  } finally { await mf.dispose() }
})
