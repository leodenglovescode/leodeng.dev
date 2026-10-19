import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupLyrics } from '../../lib/lyricsProxy.js'
import { onRequest } from '../api/lyrics.js'
import { createLegacyPreview } from '../../scripts/legacy-server.js'

const query = '?track_name=Song&artist_name=Artist&album_name=Album&duration=180'
const request = (search = query, method = 'GET') => new Request(`https://old.leodeng.dev/api/lyrics${search}`, { method, headers: { cookie: 'private=session', authorization: 'Bearer private' } })

test('public lyrics lookup is fixed-origin, strips credentials and returns only matching synced lyrics', async () => {
  const response = await lookupLyrics(request(), async (url, options) => {
    assert.equal(url, `https://lrclib.net/api/get${query}`)
    assert.equal(options.redirect, 'error')
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
