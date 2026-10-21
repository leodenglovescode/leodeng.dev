import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const runtime = await fs.readFile(new URL('../../legacy/legacy.js', import.meta.url), 'utf8')

// Deterministic DOM, XHR and clock: exercise the shipped ES5 script without
// real networking or timing sleeps, including late responses and clock jumps.
function harness(kind, { reduced = false } = {}) {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.className = ''; this.words = '' }
    set textContent(value) { this.words = String(value); this.children = [] }
    get textContent() { return this.words + this.children.map(child => child.textContent).join('') }
    get firstChild() { return this.children[0] }
    appendChild(child) { this.children.push(child); return child }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1) }
    insertBefore(child, before) { this.children.splice(Math.max(0, this.children.indexOf(before)), 0, child) }
    setAttribute(key, value) { this.attrs[key] = String(value) }
    getAttribute(key) { return this.attrs[key] ?? null }
    removeAttribute(key) { delete this.attrs[key] }
    set src(value) { this.setAttribute('src', value) }
    get src() { return this.getAttribute('src') }
  }
  let now = 0, epoch = 1700000000000, sequence = 0
  const timers = new Map(), requests = [], events = {}
  const panel = new Element('section'), content = new Element('div')
  panel.setAttribute('data-live', kind); panel.appendChild(content)
  function advance(ms) {
    const end = now + ms
    for (let i = 0; i < 10000; i++) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!due) break
      now = due[1].at
      if (due[1].interval) due[1].at += due[1].interval
      else timers.delete(due[0])
      due[1].callback()
    }
    now = end
  }
  class XHR {
    constructor() { this.status = 0; this.headers = {}; requests.push(this) }
    open(method, url) { this.url = url; this.method = method }
    send() {}
    abort() { this.aborted = true }
    getResponseHeader(name) { return this.headers[name.toLowerCase()] || null }
    respond(data, { status = 200, delay = 10, headers = {} } = {}) {
      advance(delay); this.status = status; this.headers = headers; this.responseText = JSON.stringify(data); this.finished = true; this.onload()
    }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + now])) }
    static now() { return epoch + now }
  }
  const document = {
    hidden: false, documentElement: { lang: 'en' },
    createElement: tag => new Element(tag),
    querySelector: selector => selector === 'script[src*="_assets/legacy.js"]' ? { src: 'https://old.leodeng.dev/_assets/legacy.js' } : null,
    querySelectorAll: selector => selector === '[data-live]' ? [panel] : [],
    getElementById: id => id === 'now-playing-content' ? content : null,
    addEventListener: (name, callback) => { (events[name] ||= []).push(callback) },
  }
  const context = {
    document, Date: Clock, navigator: { userAgent: 'iPad' }, XMLHttpRequest: XHR,
    performance: { now: () => now }, location: { search: '' }, matchMedia: () => ({ matches: reduced }),
    sessionStorage: { getItem: () => null },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id },
    setInterval: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay, interval: delay }); return id },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++sequence; timers.set(id, { callback, at: now + 16 }); return id },
    cancelAnimationFrame: id => timers.delete(id),
  }
  context.window = context
  vm.runInNewContext(runtime, context)
  function collect(node, predicate) { return [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => collect(child, predicate))] }
  return {
    panel, requests, advance, now: () => epoch + now,
    pending: path => requests.find(request => !request.finished && !request.aborted && request.url.split('?')[0] === path),
    find: cls => collect(panel, node => node.className.split(' ').includes(cls)),
    hide: hidden => { document.hidden = hidden; for (const callback of events.visibilitychange || []) callback() },
    jumpDeviceClock: ms => { epoch += ms },
  }
}

const track = (now, extra = {}) => ({ playing: true, title: 'Song', artist: 'Artist', album: 'Album', durationMs: 180000, positionMs: 1500, observedAt: now, serverNow: now, ...extra })

test('classic player advances progress, highlights three lines, handles seeks and rejects late lyrics', () => {
  const app = harness('now-playing')
  app.pending('/api/now-playing').respond(track(app.now()))
  app.pending('/api/lyrics').respond({ duration: 180, syncedLyrics: '[offset:100]\n[00:00.100]First\n[00:01.2]Second\n[00:04][00:05]Third' })
  assert.deepEqual(app.find('legacy-lyric').map(row => row.textContent), ['First', 'Second', 'Third'])
  assert.equal(app.find('lyric-active')[0].textContent, 'Second')
  const firstWidth = parseFloat(app.find('player-progress')[0].children[0].style.width)
  app.advance(250)
  assert.ok(parseFloat(app.find('player-progress')[0].children[0].style.width) > firstWidth)
  app.advance(1750)
  app.pending('/api/now-playing').respond(track(app.now(), { positionMs: 200 }))
  assert.equal(app.find('lyric-active')[0].textContent, 'First')
  assert.equal(app.pending('/api/lyrics'), undefined, 'same song does not refetch lyrics on each heartbeat')
  app.advance(2000)
  app.pending('/api/now-playing').respond(track(app.now(), { title: 'Next' }))
  const late = app.pending('/api/lyrics')
  app.advance(2000)
  app.pending('/api/now-playing').respond(track(app.now(), { title: 'Third' }))
  late.respond({ duration: 180, syncedLyrics: '[00:00]Wrong song' })
  assert.equal(app.find('player-lyrics')[0].getAttribute('hidden'), 'hidden')
  app.pending('/api/lyrics').respond({ duration: 180, syncedLyrics: '[00:00]Correct song' })
  assert.equal(app.find('lyric-active')[0].textContent, 'Correct song')
  app.hide(true)
  const count = app.requests.length
  app.advance(60000)
  assert.equal(app.requests.length, count)
  app.hide(false)
  app.pending('/api/now-playing').respond(null, { status: 204 })
  assert.equal(app.panel.getAttribute('hidden'), 'hidden')
  app.advance(4990)
  assert.ok(app.pending('/api/now-playing'), 'idle polling uses five seconds')
})

test('player uses server time when the device clock is wrong, and hides stale playback on failures', () => {
  const app = harness('now-playing')
  app.jumpDeviceClock(3600000)
  app.pending('/api/now-playing').respond(track(app.now() - 3600000))
  assert.equal(app.panel.getAttribute('hidden'), null)
  app.advance(35250)
  assert.equal(app.panel.getAttribute('hidden'), 'hidden')
})

test('temporary lyric failures retry the same song and show the recovered lyrics', () => {
  const app = harness('now-playing')
  app.pending('/api/now-playing').respond(track(app.now()))
  app.pending('/api/lyrics').respond(null, { status: 503 })
  app.pending('https://lrclib.net/api/get').respond(null, { status: 429, headers: { 'retry-after': '60' } })
  assert.match(app.find('player-lyric-status')[0].textContent, /Retrying/)
  // Keep playback alive while observing the upstream retry delay.
  for (let i = 0; i < 29; i++) {
    app.advance(2000)
    app.pending('/api/now-playing').respond(track(app.now()))
  }
  assert.equal(app.pending('/api/lyrics'), undefined)
  app.advance(2000)
  app.pending('/api/lyrics').respond({ duration: 180, syncedLyrics: '[00:00]Recovered lyric' })
  assert.equal(app.find('lyric-active')[0].textContent, 'Recovered lyric')
  assert.equal(app.find('player-lyric-status')[0].getAttribute('hidden'), 'hidden')
})

test('classic player falls back to browser CORS when the edge is rate limited, and cancels stale requests', () => {
  const app = harness('now-playing')
  app.pending('/api/now-playing').respond(track(app.now()))
  app.pending('/api/lyrics').respond(null, { status: 503 })
  app.pending('https://lrclib.net/api/get').respond({ duration: 180, syncedLyrics: '[00:00]Browser lyric' })
  assert.equal(app.find('lyric-active')[0].textContent, 'Browser lyric')
  app.advance(2000)
  app.pending('/api/now-playing').respond(track(app.now(), { title: 'Next' }))
  app.pending('/api/lyrics').respond(null, { status: 503 })
  const late = app.pending('https://lrclib.net/api/get')
  app.advance(2000)
  app.pending('/api/now-playing').respond(track(app.now(), { title: 'Third' }))
  assert.equal(late.aborted, true)
  late.respond({ duration: 180, syncedLyrics: '[00:00]Wrong track' })
  assert.equal(app.find('player-lyrics')[0].getAttribute('hidden'), 'hidden')
})

test('classic clock takes three samples each minute, ticks milliseconds and falls back on failed synchronization', () => {
  const app = harness('time')
  function sample(delay) {
    const sent = app.now() + 1000
    app.pending('/api/time').respond({ receivedAtMs: sent, sentAtMs: sent, synchronized: true, source: 'gps-pps', stratum: 1 }, { delay })
    return sent + delay / 2
  }
  sample(60)
  const best = sample(10)
  sample(40)
  const display = app.find('reference-clock')[0]
  assert.match(display.textContent, /GPS \/ PPS/)
  const digits = () => display.children[1].textContent
  assert.ok(digits().endsWith('.' + String(new Date(best + 40).getUTCMilliseconds()).padStart(3, '0')))
  const first = digits()
  app.advance(50)
  assert.notEqual(digits(), first)
  app.jumpDeviceClock(3600000)
  app.advance(50)
  assert.ok(!digits().startsWith(String(new Date(app.now()).getUTCHours()).padStart(2, '0') + ':'), 'synchronized time uses a monotonic clock')
  app.advance(59790)
  assert.ok(app.pending('/api/time'), 'synchronizes again at sixty seconds')
  app.pending('/api/time').respond(null, { status: 503, headers: { 'retry-after': '120' } })
  assert.match(display.textContent, /YOUR DEVICE CLOCK/)
  const failed = app.requests.length
  app.advance(60000)
  assert.equal(app.requests.length, failed, 'respects upstream retry advice')
  app.hide(true)
  app.advance(180000)
  assert.equal(app.requests.length, failed, 'hidden tab does not poll')
  app.hide(false)
  assert.ok(app.pending('/api/time'))
})

test('clock renders intermediate milliseconds each frame and stops rendering while hidden', () => {
  const app = harness('time')
  const digits = () => app.find('reference-clock')[0].children[1].textContent
  const endings = new Set()
  for (let frame = 0; frame < 6; frame++) { app.advance(16); endings.add(digits().slice(-2)) }
  assert.ok(endings.size > 2, 'milliseconds should not alternate between two 50 ms steps')
  app.hide(true)
  const hidden = digits()
  app.advance(1000)
  assert.equal(digits(), hidden)
  app.hide(false)
  const visible = digits()
  app.advance(16)
  assert.notEqual(digits(), visible)
  const quiet = harness('time', { reduced: true })
  const before = quiet.find('reference-clock')[0].children[1].textContent
  quiet.advance(100)
  assert.equal(quiet.find('reference-clock')[0].children[1].textContent, before)
  quiet.advance(900)
  assert.notEqual(quiet.find('reference-clock')[0].children[1].textContent, before)
})

test('classic connection report includes encryption details and only confirms a negotiated hybrid exchange', () => {
  const app = harness('ip')
  app.pending('/api/ip').respond({ ip: '2001:db8::42', ipVersion: 6, countryCode: 'TW', city: 'Taipei', userAgent: 'Old Safari',
    network: { asn: 64500, organization: 'Example network' }, connection: { tlsVersion: 'TLSv1.2', cipher: 'ECDHE-RSA-AES128-GCM-SHA256', httpProtocol: 'HTTP/1.1', colo: 'TPE' } })
  assert.match(app.panel.textContent, /ECDHE-RSA-AES128-GCM-SHA256/)
  assert.match(app.panel.textContent, /AS64500/)
  assert.equal(app.find('connection-confirmed').length, 0)
  const probe = app.pending('/cdn-cgi/trace')
  probe.status = 200; probe.responseText = 'tls=TLSv1.3\nkex=X25519MLKEM768\n'; probe.onload()
  assert.equal(app.find('connection-confirmed').length, 1)
  assert.match(app.panel.textContent, /Probe TLS version/)
  assert.match(app.panel.textContent, /separate same-site connection/)
  assert.equal(app.find('connection-section').length, 3)
})

test('classic connection report preserves API details when the probe fails, and can refresh', () => {
  const app = harness('ip')
  const metadata = { ip: '203.0.113.9', network: {}, connection: { tlsVersion: 'TLSv1.3', cipher: 'AEAD-AES128-GCM-SHA256' } }
  app.pending('/api/ip').respond(metadata)
  app.pending('/cdn-cgi/trace').respond(null, { status: 503 })
  assert.match(app.panel.textContent, /Post-quantum status is unknown/)
  assert.match(app.panel.textContent, /AEAD-AES128-GCM-SHA256/)
  assert.equal(app.find('connection-confirmed').length, 0)
  app.find('connection-tools')[0].children[0].onclick()
  app.pending('/api/ip').respond(metadata)
  const probe = app.pending('/cdn-cgi/trace')
  probe.status = 200; probe.responseText = 'tls=TLSv1.3\nkex=X25519\n'; probe.onload()
  assert.match(app.panel.textContent, /classical key exchange/)
  assert.equal(app.find('connection-confirmed').length, 0)
})

test('classic personal stats render live profiles and saved history without a modern chart runtime', () => {
  const app = harness('stats')
  app.pending('https://api.github.com/users/leodenglovescode').respond({ public_repos: 12, followers: 34 })
  app.pending('https://api.github.com/search/commits').respond({ items: [{ html_url: 'https://github.com/leodenglovescode/site/commit/' + 'a'.repeat(40), commit: { message: 'A public commit\nMore detail' } }] })
  app.pending('/api/stats/monkeytype').respond({ profile: { completedTests: 393, timeTyping: 7200, bests: [{ seconds: 60, wpm: 100 }] },
    history: { state: 'ready', stale: false, results: [{ timestamp: 1800000000000, wpm: 95, accuracy: 99, mode: 'time', mode2: '60', language: 'english' }] } })
  assert.match(app.panel.textContent, /393/)
  assert.match(app.panel.textContent, /100 WPM/)
  assert.match(app.panel.textContent, /95 WPM \/ 99%/)
  assert.match(app.panel.textContent, /A public commit/)
})
