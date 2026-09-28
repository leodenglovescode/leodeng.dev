import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'

import { onRequest as publicEndpoint } from '../api/now-playing.js'
import { onRequest as ingestEndpoint } from '../api/internal/now-playing.js'
import { onRequest as artworkEndpoint } from '../api/internal/now-playing/artwork/[hash].js'

if (!globalThis.crypto) globalThis.crypto = webcrypto

class FakeD1Statement {
  constructor(database, sql) {
    this.database = database
    this.sql = sql
    this.values = []
  }

  bind(...values) {
    this.values = values
    return this
  }

  async first() {
    if (this.sql.includes('FROM now_playing')) return this.database.current
    throw new Error(`Unexpected first(): ${this.sql}`)
  }

  async run() {
    if (this.sql.startsWith('DELETE FROM now_playing')) {
      const changes = this.database.current ? 1 : 0
      this.database.current = null
      return { meta: { changes } }
    }

    if (this.sql.includes('INSERT INTO now_playing_rate')) {
      const [now, minimum] = this.values
      if (this.database.artworkAcceptedAt != null
          && this.database.artworkAcceptedAt > now - minimum) {
        return { meta: { changes: 0 } }
      }
      this.database.artworkAcceptedAt = now
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('INSERT INTO now_playing')) {
      const [
        trackKey,
        title,
        artist,
        album,
        durationMs,
        positionMs,
        artworkKey,
        now,
        minimum,
      ] = this.values

      if (this.database.current && this.database.current.received_at > now - minimum) {
        return { meta: { changes: 0 } }
      }
      this.database.current = {
        track_key: trackKey,
        title,
        artist,
        album,
        duration_ms: durationMs,
        position_ms: positionMs,
        artwork_key: artworkKey,
        received_at: now,
      }
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unexpected run(): ${this.sql}`)
  }
}

class FakeD1 {
  current = null
  artworkAcceptedAt = null

  prepare(sql) {
    return new FakeD1Statement(this, sql.trim())
  }
}

class FakeR2 {
  objects = new Map()

  async head(key) {
    return this.objects.has(key) ? { key } : null
  }

  async put(key, value, options) {
    this.objects.set(key, { value: new Uint8Array(value), options })
  }
}

const token = 'test-secret-that-is-not-used-anywhere-else'

function context(request, overrides = {}) {
  return {
    request,
    env: {
      HOMELAB_DB: overrides.database || new FakeD1(),
      MEDIA: overrides.media || new FakeR2(),
      NOW_PLAYING_TOKEN: token,
      R2_PUBLIC_BASE: 'https://media.example.test',
    },
    params: overrides.params || {},
    waitUntil() {},
  }
}

function metadataRequest(body, method = 'POST', authorization = `Bearer ${token}`) {
  return new Request('https://example.test/api/internal/now-playing', {
    method,
    headers: {
      authorization,
      'content-type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

const track = {
  trackKey: 'music:1440833098',
  title: 'Dreams',
  artist: 'Fleetwood Mac',
  album: 'Rumours',
  durationMs: 257800,
  positionMs: 42100,
  artworkKey: null,
}

test('authenticated metadata is stored and returned by the public endpoint', async () => {
  const database = new FakeD1()
  const originalNow = Date.now
  Date.now = () => 1_800_000_000_000
  try {
    const write = await ingestEndpoint(context(metadataRequest(track), { database }))
    assert.equal(write.status, 200)

    const read = await publicEndpoint(context(
      new Request('https://example.test/api/now-playing'),
      { database },
    ))
    assert.equal(read.status, 200)
    assert.equal(read.headers.get('cache-control'), 'public, max-age=5')
    assert.deepEqual(await read.json(), {
      playing: true,
      title: 'Dreams',
      artist: 'Fleetwood Mac',
      album: 'Rumours',
      durationMs: 257800,
      positionMs: 42100,
      observedAt: 1_800_000_000_000,
      serverNow: 1_800_000_000_000,
      artworkUrl: null,
    })
  } finally {
    Date.now = originalNow
  }
})

test('metadata writes require the secret and are globally rate limited', async () => {
  const database = new FakeD1()
  const originalNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    const unauthorized = await ingestEndpoint(context(
      metadataRequest(track, 'POST', 'Bearer wrong'),
      { database },
    ))
    assert.equal(unauthorized.status, 401)
    assert.equal(database.current, null)

    assert.equal((await ingestEndpoint(context(metadataRequest(track), { database }))).status, 200)

    now += 1_000
    const limited = await ingestEndpoint(context(
      metadataRequest({ ...track, trackKey: 'a-different-track' }),
      { database },
    ))
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '3')

    now += 2_000
    assert.equal((await ingestEndpoint(context(metadataRequest(track), { database }))).status, 200)
  } finally {
    Date.now = originalNow
  }
})

test('stale and explicitly cleared playback return no public data', async () => {
  const database = new FakeD1()
  const originalNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    await ingestEndpoint(context(metadataRequest(track), { database }))

    now += 31_000
    const stale = await publicEndpoint(context(
      new Request('https://example.test/api/now-playing'),
      { database },
    ))
    assert.equal(stale.status, 204)

    const clear = await ingestEndpoint(context(
      metadataRequest(null, 'DELETE'),
      { database },
    ))
    assert.equal(clear.status, 204)
    assert.equal(database.current, null)
  } finally {
    Date.now = originalNow
  }
})

test('artwork is hash checked, stored immutably, and rate limited', async () => {
  const database = new FakeD1()
  const media = new FakeR2()
  const originalNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    const bytes = new TextEncoder().encode('fake jpeg bytes')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const request = () => new Request(`https://example.test/api/internal/now-playing/artwork/${hash}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'image/jpeg',
        'content-length': String(bytes.byteLength),
      },
      body: bytes,
    })

    const uploaded = await artworkEndpoint(context(request(), {
      database,
      media,
      params: { hash },
    }))
    assert.equal(uploaded.status, 201)
    const payload = await uploaded.json()
    assert.equal(payload.artworkKey, `now-playing/artwork/${hash}.jpg`)
    assert.equal(payload.url, `https://media.example.test/now-playing/artwork/${hash}.jpg`)
    assert.equal(media.objects.size, 1)
    assert.equal(
      media.objects.get(payload.artworkKey).options.httpMetadata.cacheControl,
      'public, max-age=31536000, immutable',
    )

    const existing = await artworkEndpoint(context(request(), {
      database,
      media,
      params: { hash },
    }))
    assert.equal(existing.status, 200)

    const secondBytes = new TextEncoder().encode('different jpeg bytes')
    const secondHash = createHash('sha256').update(secondBytes).digest('hex')
    const limited = await artworkEndpoint(context(new Request(
      `https://example.test/api/internal/now-playing/artwork/${secondHash}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'image/jpeg',
          'content-length': String(secondBytes.byteLength),
        },
        body: secondBytes,
      },
    ), {
      database,
      media,
      params: { hash: secondHash },
    }))
    assert.equal(limited.status, 429)

    now += 10_000
    const badHash = await artworkEndpoint(context(new Request(
      `https://example.test/api/internal/now-playing/artwork/${'0'.repeat(64)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'image/jpeg',
          'content-length': String(secondBytes.byteLength),
        },
        body: secondBytes,
      },
    ), {
      database,
      media,
      params: { hash: '0'.repeat(64) },
    }))
    assert.equal(badHash.status, 400)
  } finally {
    Date.now = originalNow
  }
})

test('unsupported methods and media types are rejected', async () => {
  const getWrite = await ingestEndpoint(context(
    new Request('https://example.test/api/internal/now-playing'),
  ))
  assert.equal(getWrite.status, 405)
  assert.equal(getWrite.headers.get('allow'), 'POST, DELETE')

  const textWrite = await ingestEndpoint(context(new Request(
    'https://example.test/api/internal/now-playing',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'text/plain',
      },
      body: JSON.stringify(track),
    },
  )))
  assert.equal(textWrite.status, 415)
})
