import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

import { onRequest as publicEndpoint } from '../api/now-playing.js'
import { onRequest as ingestEndpoint } from '../api/internal/now-playing.js'
import { onRequest as artworkEndpoint } from '../api/internal/now-playing/artwork/[hash].js'

if (!globalThis.crypto) globalThis.crypto = webcrypto

class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:')
    for (const migration of ['0002_now_playing.sql', '0007_now_playing_sources.sql']) {
      this.db.exec(readFileSync(new URL(`../../homelab/migrations/${migration}`, import.meta.url), 'utf8'))
    }
  }
  get current() { return this.db.prepare('SELECT * FROM now_playing').get() ?? null }
  prepare(sql) {
    const statement = this.db.prepare(sql)
    let values = []
    const prepared = {
      bind(...args) { values = args; return prepared },
      async first() { return statement.get(...values) ?? null },
      async all() { return { results: statement.all(...values) } },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } } },
    }
    return prepared
  }
  async batch(statements) {
    this.db.exec('BEGIN')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.run())
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
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
    assert.equal(read.headers.get('cache-control'), 'public, max-age=1')
    const { sources, id, device, ...primary } = await read.json()
    assert.equal(device, 'Music')
    assert.equal(sources.length, 1)
    assert.equal(sources[0].id, id)
    assert.deepEqual(primary, {
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

test('legacy metadata writes require the secret and retain their own rate limit', async () => {
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

    const limited = await ingestEndpoint(context(
      metadataRequest({ ...track, trackKey: 'a-different-track' }),
      { database },
    ))
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '1')

    now += 2_000
    assert.equal((await ingestEndpoint(context(metadataRequest(track), { database }))).status, 200)
    now += 1_000
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

const source = (id, device = id, extra = {}) => ({ ...track, sourceId: id, deviceId: device, sourceLabel: id.split(':')[0], ...extra })
const readSources = async database => {
  const response = await publicEndpoint(context(new Request('https://example.test/api/now-playing'), { database }))
  return response.status === 204 ? [] : (await response.json()).sources
}

test('three simultaneous publishers keep independent leases, rate limits and clears', async () => {
  const database = new FakeD1()
  const original = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    const devices = [source('mac:one'), source('android:phone'), source('music-assistant:speaker')]
    const writes = await Promise.all(devices.map(device => ingestEndpoint(context(metadataRequest(device), { database }))))
    assert.deepEqual(writes.map(response => response.status), [200, 200, 200])
    assert.equal((await readSources(database)).length, 3)
    assert.equal((await ingestEndpoint(context(metadataRequest(devices[0]), { database }))).status, 429)
    await ingestEndpoint(context(metadataRequest(null, 'DELETE'), { database }))
    assert.equal((await readSources(database)).length, 3, 'old clients cannot erase new devices')
    const clear = new Request('https://example.test/api/internal/now-playing?sourceId=mac:one', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    assert.equal((await ingestEndpoint(context(clear, { database }))).status, 204)
    assert.deepEqual((await readSources(database)).map(device => device.device), ['android', 'music-assistant'])
    now += 20_000
    await ingestEndpoint(context(metadataRequest(devices[1]), { database }))
    now += 11_000
    assert.deepEqual((await readSources(database)).map(device => device.device), ['android'], 'expiry belongs to each device')
  } finally { Date.now = original }
})

test('coordinator deduplicates physical devices, caps cards at three, and keeps order across heartbeats', async () => {
  const database = new FakeD1()
  const original = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  try {
    const batch = [source('music-assistant:mac', 'same-mac'), source('mac:one', 'same-mac'),
      source('music-assistant:a'), source('music-assistant:b'), source('music-assistant:c')]
    assert.equal((await ingestEndpoint(context(metadataRequest({ sources: batch }), { database }))).status, 200)
    const before = await readSources(database)
    assert.equal(before.length, 3)
    assert.equal(before[0].device, 'mac', 'direct device report has priority over its MA mirror')
    assert.ok(before.every(device => !JSON.stringify(device).includes('same-mac')), 'raw device identities stay private')
    now += 10_000
    await ingestEndpoint(context(metadataRequest(batch[3]), { database }))
    assert.deepEqual((await readSources(database)).map(device => device.id), before.map(device => device.id), 'heartbeats cannot switch the selected card')
    now += 1_000
    await ingestEndpoint(context(metadataRequest({ sources: [
      { ...batch[1], playing: false }, { ...batch[2], playing: false }, { ...batch[3], playing: false },
    ] }), { database }))
    const after = await readSources(database)
    assert.equal(after.find(device => device.id === before[0].id)?.device, 'music-assistant', 'MA takes over the same card when direct playback stops')
  } finally { Date.now = original }
})

test('invalid batches cannot partially publish and metadata labels are validated', async () => {
  const database = new FakeD1()
  for (const body of [
    { sources: [source('mac:valid'), source('bad-id')] },
    { sources: [source('mac:valid'), source('mac:valid')] },
    { sources: [] }, source('mac:valid', 'id', { sourceLabel: 3 }),
    source('mac:valid', 'id', { sourceLabel: 'Bad\nlabel' }),
  ]) assert.equal((await ingestEndpoint(context(metadataRequest(body), { database }))).status, 400)
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM now_playing_sources').get().n, 0)
})
