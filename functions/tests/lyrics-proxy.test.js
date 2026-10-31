import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupLyrics, localLyricsSource } from '../../lib/lyricsProxy.js'
import { onRequest } from '../api/lyrics.js'
import { createLegacyPreview } from '../../scripts/legacy-server.js'

const query = '?track_name=Song&artist_name=Artist&album_name=Album&duration=180'
const request = (search = query, method = 'GET') => new Request(`https://old.leodeng.dev/api/lyrics${search}`, { method, headers: { cookie: 'private=session', authorization: 'Bearer private' } })

test('public lyrics lookup is fixed-origin, strips credentials and returns only matching synced lyrics', async () => {
  const response = await lookupLyrics(request(), async (url, options) => {
    assert.equal(url, `https://lrclib.net/api/get${query}`)
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.cookie, undefined)
    assert.equal(options.headers.authorization, undefined)
    return Response.json({ syncedLyrics: '[00:01]Hello', duration: 180, instrumental: false, plainLyrics: 'not needed', extra: 'not needed' })
  })
  assert.deepEqual(await response.json(), { syncedLyrics: '[00:01]Hello', duration: 180, instrumental: false })
  assert.match(response.headers.get('cache-control'), /max-age=86400/)
  const mismatch = await lookupLyrics(request(), async () => Response.json({ syncedLyrics: '[00:01]Wrong edit', duration: 185 }))
  assert.equal((await mismatch.json()).syncedLyrics, null)
})

test('invalid requests never fetch, and unavailable or oversized responses fail safely', async () => {
  for (const search of ['', query + '&url=https://example.test', query + '&duration=181', query.replace('duration=180', 'duration=Infinity')]) {
    assert.equal((await lookupLyrics(request(search), () => { throw new Error('Must not fetch') })).status, 400)
  }
  assert.equal((await onRequest({ request: request(query, 'POST') })).status, 405)
  const missing = await lookupLyrics(request(), async () => new Response(null, { status: 404 }))
  assert.deepEqual(await missing.json(), { syncedLyrics: null })
  for (const fetcher of [async () => Response.json({ syncedLyrics: 'x'.repeat(270000) }), async () => new Response('HTML'), async () => { throw new Error('upstream details') }]) {
    const response = await lookupLyrics(request(), fetcher)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Lyrics unavailable' })
  }
})

test('local classic preview supports lyrics before deploying, preserving query parameters', async () => {
  const preview = createLegacyPreview({ fetchUpstream: async url => {
    assert.equal(url, `https://lrclib.net/api/get${query}`)
    return Response.json({ duration: 180, syncedLyrics: '[00:01]Hello' })
  } })
  const response = await preview(request())
  assert.equal((await response.json()).syncedLyrics, '[00:01]Hello')
})

test('lyrics lookup refuses upstream redirects without following their location', async () => {
  let calls = 0
  const response = await lookupLyrics(request(), async (url, options) => {
    calls++
    assert.equal(options.redirect, 'manual')
    assert.ok(url.startsWith('https://lrclib.net/api/get?'))
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/private' } })
  })
  assert.equal(calls, 1)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'Lyrics unavailable' })
})

test('edge cache shares sanitized responses and backs off after rate limiting', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches
  const store = new Map(), tasks = []
  let calls = 0
  globalThis.caches = { default: {
    match: async key => store.get(key.url)?.clone(),
    put: async (key, response) => { assert.equal(key.headers.get('cookie'), null); store.set(key.url, response.clone()) },
  } }
  const context = { request: request(), waitUntil: task => tasks.push(task) }
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ duration: 180, syncedLyrics: '[00:00]Cached' }) }
    assert.equal((await onRequest(context)).status, 200)
    await Promise.all(tasks)
    assert.equal((await (await onRequest(context)).json()).syncedLyrics, '[00:00]Cached')
    assert.equal(calls, 1)
    store.clear()
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '120' } }) }
    const limited = await onRequest(context)
    assert.equal(limited.status, 503)
    assert.equal(limited.headers.get('Retry-After'), '120')
    await Promise.all(tasks)
    assert.match([...store.values()][0].headers.get('cache-control'), /max-age=60/)
    const cached = await onRequest(context)
    assert.equal(cached.status, 503)
    assert.equal(cached.headers.get('Cache-Control'), 'no-store')
    assert.equal(calls, 2)
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches }
})

const localEnv = {
  LYRICS_LOCAL_URL: 'https://lyrics-origin.example.test/api/get',
  LYRICS_LOCAL_TOKEN: 'gateway-placeholder-for-tests-only',
  LYRICS_ACCESS_CLIENT_ID: 'access-placeholder-id',
  LYRICS_ACCESS_CLIENT_SECRET: 'access-placeholder-secret',
}
const local = localLyricsSource(localEnv)

test('a local hit never calls public LRCLIB and never returns credentials or extra fields', async () => {
  let calls = 0
  const response = await lookupLyrics(request(), async (url, options) => {
    calls++
    assert.equal(new URL(url).origin, 'https://lyrics-origin.example.test')
    assert.equal(options.headers.Authorization, `Bearer ${localEnv.LYRICS_LOCAL_TOKEN}`)
    assert.equal(options.headers['CF-Access-Client-Secret'], localEnv.LYRICS_ACCESS_CLIENT_SECRET)
    assert.equal(options.headers.cookie, undefined)
    return Response.json({ duration: 180, syncedLyrics: '[00:01]Local', secret: 'discard' })
  }, { local })
  assert.equal(calls, 1)
  assert.equal(response.headers.get('X-Lyrics-Source'), 'local')
  assert.deepEqual(await response.json(), { duration: 180, syncedLyrics: '[00:01]Local', instrumental: false })
})

test('local misses, plain lyrics, mismatches and errors fall back once without leaking origin credentials', async () => {
  for (const first of [
    () => new Response(null, { status: 404 }),
    () => Response.json({ duration: 180, syncedLyrics: null, plainLyrics: 'Plain' }),
    () => Response.json({ duration: 188, syncedLyrics: '[00:01]Wrong' }),
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/' } }),
    () => { throw new TypeError('Private failure detail') },
    () => Response.json({ duration: 180, syncedLyrics: 'x'.repeat(270000) }),
  ]) {
    const calls = []
    const response = await lookupLyrics(request(), async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'manual')
      if (calls.length === 1) return first()
      assert.equal(new URL(url).origin, 'https://lrclib.net')
      assert.equal(options.headers.Authorization, undefined)
      assert.equal(options.headers['CF-Access-Client-Id'], undefined)
      assert.equal(options.headers['CF-Access-Client-Secret'], undefined)
      return Response.json({ duration: 180, syncedLyrics: '[00:01]Public' })
    }, { local })
    assert.equal(calls.length, 2)
    assert.equal((await response.json()).syncedLyrics, '[00:01]Public')
  }
})

test('a matching instrumental track is authoritative, while an instrumental duration mismatch falls back', async () => {
  let calls = 0
  const response = await lookupLyrics(request(), async () => { calls++; return Response.json({ duration: 180, instrumental: true }) }, { local })
  assert.equal(calls, 1)
  assert.equal((await response.json()).instrumental, true)
})

test('incomplete or unsafe local configuration fails closed, with HTTP allowed only explicitly on loopback for development', () => {
  for (const env of [
    { ...localEnv, LYRICS_ACCESS_CLIENT_SECRET: '' }, { ...localEnv, LYRICS_LOCAL_TOKEN: '' },
    { ...localEnv, LYRICS_LOCAL_URL: 'http://private.example.test/api/get' },
    { ...localEnv, LYRICS_LOCAL_URL: 'https://user:pass@example.test/api/get' },
    { ...localEnv, LYRICS_LOCAL_URL: 'https://example.test/api/search' },
    { ...localEnv, LYRICS_LOCAL_URL: 'https://example.test/api/get?url=evil' },
  ]) assert.equal(localLyricsSource(env), null)
  const dev = { LYRICS_LOCAL_URL: 'http://127.0.0.1:3310/api/get', LYRICS_LOCAL_TOKEN: localEnv.LYRICS_LOCAL_TOKEN }
  assert.equal(localLyricsSource(dev), null)
  assert.ok(localLyricsSource(dev, { allowLocalHttp: true }))
})

test('equivalent public queries share an edge cache key, and invalid queries cannot read the cache', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches
  const store = new Map(), tasks = []
  let calls = 0
  globalThis.caches = { default: { match: async key => store.get(key.url)?.clone(), put: async (key, response) => store.set(key.url, response.clone()) } }
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ duration: 180, syncedLyrics: '[00:00]Cached' }) }
    await onRequest({ request: request(), waitUntil: p => tasks.push(p) })
    await Promise.all(tasks)
    const second = request('?duration=180.0&album_name=Album&artist_name=Artist&track_name=%20Song%20')
    assert.equal((await onRequest({ request: second })).status, 200)
    assert.equal(calls, 1)
    assert.equal((await onRequest({ request: request(query + '&url=anything') })).status, 400)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches }
})

test('gateway rate limits are respected instead of shifting excess requests to public LRCLIB', async () => {
  let calls = 0
  const response = await lookupLyrics(request(), async () => {
    calls++
    return new Response(null, { status: 429, headers: { 'Retry-After': '90' } })
  }, { local })
  assert.equal(calls, 1)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Retry-After'), '90')
})
