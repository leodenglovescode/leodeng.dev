import assert from 'node:assert/strict'
import test from 'node:test'
import { currentLyricIndex, parseSyncedLyrics } from '../../src/utils/lyrics.js'

test('LRC parsing handles repeated timestamps, fractions, offsets and instrumental gaps', () => {
  const lines = parseSyncedLyrics('[ar:Example]\n[offset:100]\n[00:03.125]Third\n[00:01.2][00:02.00]Repeated\n[00:04.000]\n[00:99.00]Invalid')
  assert.deepEqual(lines, [
    { timeMs: 1100, text: 'Repeated' }, { timeMs: 1900, text: 'Repeated' },
    { timeMs: 3025, text: 'Third' }, { timeMs: 3900, text: '' },
  ])
  assert.deepEqual(parseSyncedLyrics(null), [])
  assert.deepEqual(parseSyncedLyrics('plain lyrics'), [])
})

test('lyric selection follows exact timestamps and forward or backward seeks', () => {
  const lines = parseSyncedLyrics('[00:01]First\n[00:03]Second\n[00:05]')
  assert.equal(currentLyricIndex(lines, 0), -1)
  assert.equal(currentLyricIndex(lines, 3000), 1)
  assert.equal(currentLyricIndex(lines, 6000), 2)
  assert.equal(currentLyricIndex(lines, 1500), 0)
  assert.equal(currentLyricIndex([], 1000), -1)
})
