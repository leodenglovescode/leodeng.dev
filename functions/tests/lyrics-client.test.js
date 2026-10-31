import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { currentLyricIndex, parseSyncedLyrics } from '../../src/utils/lyrics.js'

function player() {
  const text = fs.readFileSync(new URL('../../src/components/SyncedLyrics.vue', import.meta.url), 'utf8')
  const script = text.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm, '')
  const props = { track: { title: 'Song', artist: 'Artist', album: 'Album', durationMs: 180000 }, positionMs: 0 }
  const requests = [], timers = new Map()
  let now = 0, timerId = 0, cleanup, changed
  const context = vm.createContext({
    defineProps: () => props, useLocale: () => ({ t: x => x }),
    ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    watch: (_, callback) => { changed = () => callback(null, null, fn => { cleanup = fn }); void changed() },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout: id => timers.delete(id), Date: class extends Date { static now() { return now } },
    document: { hidden: false }, URLSearchParams, AbortController, Number, JSON,
    currentLyricIndex, parseSyncedLyrics,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  })
  vm.runInContext(script, context)
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate) }
  return {
    requests, timers,
    lines: () => vm.runInContext('lines.value', context),
    respond: async (index, data, status = 200, headers = {}) => { requests[index].resolve(Response.json(data, { status, headers })); await flush() },
    advance: async delta => {
      const until = now + delta
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush()
      }
      now = until
    },
    change: title => { cleanup(); props.track = { ...props.track, title }; void changed() },
    destroy: () => cleanup(),
  }
}

test('modern player uses the website boundary, honors retry-after and recovers', async () => {
  const app = player()
  assert.ok(app.requests[0].url.startsWith('/api/lyrics?'))
  await app.respond(0, { error: 'Unavailable' }, 503, { 'Retry-After': '60' })
  await app.advance(59000)
  assert.equal(app.requests.length, 1)
  await app.advance(1000)
  assert.equal(app.requests.length, 2)
  await app.respond(1, { duration: 180, syncedLyrics: '[00:00]Recovered' })
  assert.equal(app.lines()[0].text, 'Recovered')
  app.destroy()
  assert.equal(app.timers.size, 0)
})

test('track changes abort pending lyrics and late results cannot overwrite the current song', async () => {
  const app = player()
  app.change('Next')
  assert.equal(app.requests[0].options.signal.aborted, true)
  await app.respond(1, { duration: 180, syncedLyrics: '[00:00]Correct' })
  await app.respond(0, { duration: 180, syncedLyrics: '[00:00]Wrong' })
  assert.equal(app.lines()[0].text, 'Correct')
  app.destroy()
})

test('a confirmed miss is cached, while unmount cancels pending retry timers', async () => {
  const app = player()
  await app.respond(0, { syncedLyrics: null })
  app.change('Next')
  await app.respond(1, {}, 503)
  app.change('Song')
  assert.equal(app.requests.length, 2)
  app.destroy()
  await app.advance(60000)
  assert.equal(app.requests.length, 2)
})
