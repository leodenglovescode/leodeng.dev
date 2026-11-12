import assert from 'node:assert/strict'
import test from 'node:test'
import { playbackSources } from '../../src/utils/nowPlaying.js'

test('client keeps separate progress and expiry for up to three device cards', () => {
  const now = 1_800_000_000_000
  const track = { playing: true, title: 'Song', artist: 'Artist', durationMs: 180000, positionMs: 10000, observedAt: now }
  const sources = playbackSources({ sources: [
    { ...track, id: 'mac', device: "Leo's Mac", observedAt: now - 20000 },
    { ...track, id: 'phone', device: "Leo's Android" },
    { ...track, id: 'stale', observedAt: now - 31000 },
    { ...track, id: 'speaker' }, { ...track, id: 'extra' },
  ] }, now, 500)
  assert.deepEqual(sources.map(source => source.id), ['mac', 'phone', 'speaker'])
  assert.equal(sources[0].syncedPositionMs, 30000)
  assert.equal(sources[0].expiresAt, 10500)
  assert.equal(sources[1].expiresAt, 30500)
  assert.equal(playbackSources(track, now, 500).length, 1, 'old response format remains usable')
  assert.deepEqual(playbackSources({ sources: [{ ...track, title: '' }] }, now, 500), [])
})
