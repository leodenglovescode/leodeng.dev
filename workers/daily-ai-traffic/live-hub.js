import { DurableObject } from 'cloudflare:workers'
import { DAILY_AI_IDS } from '../../lib/daily-ai-questions.js'
import { readBoundedJson } from '../../lib/nowPlaying.js'

const terminal = status => ['done', 'error', 'cancelled'].includes(status)
const json = (body, status = 200) => Response.json(body, { status })
const MAX_QUEUE = 3
const DEADLINE = 10 * 60000
const encoder = new TextEncoder()
const wire = value => encoder.encode(`data: ${JSON.stringify(value)}\n\n`)

// One coordination object per physical inference runner, not per visitor. This
// serializes access to the single GPU and bounds its queue across every POP.
export class LiveHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.listeners = new Map()
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      job TEXT PRIMARY KEY, question TEXT NOT NULL, day TEXT NOT NULL,
      status TEXT NOT NULL, thinking TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL)`)
    if (!this.rows('PRAGMA table_info(jobs)').some(column => column.name === 'revision')) this.sql.exec('ALTER TABLE jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
    this.sql.exec('CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY, epoch TEXT, day TEXT, started INTEGER)')
    this.sql.exec("INSERT OR IGNORE INTO control VALUES (1, 'initial', '', 0)")
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray() }
  agent() { return this.ctx.getWebSockets('agent').find(ws => ws.readyState === 1 && Date.now() - (ws.deserializeAttachment()?.seen || 0) < 60000) }
  snapshot(job) {
    const row = this.rows('SELECT * FROM jobs WHERE job = ?', job)[0]
    return row ? { job: row.job, id: row.question, status: row.status, thinking: row.thinking,
      text: row.answer, sources: JSON.parse(row.sources), model: 'qwen3.8:27b', generatedAt: row.updated } : null
  }
  emit(job, value) {
    for (const controller of this.listeners.get(job) || []) {
      try { controller.enqueue(wire(value)) } catch { this.listeners.get(job)?.delete(controller) }
    }
  }
  finish(job, status) {
    this.sql.exec('UPDATE jobs SET status = ?, updated = ? WHERE job = ?', status, Date.now(), job)
    this.emit(job, { type: 'status', status })
    for (const controller of this.listeners.get(job) || []) { try { controller.close() } catch { /* Already disconnected. */ } }
    this.listeners.delete(job)
  }
  async dispatch() {
    const agent = this.agent()
    if (!agent || this.rows("SELECT job FROM jobs WHERE status = 'generating'").length) return
    const next = this.rows("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created LIMIT 1")[0]
    if (!next) return
    this.sql.exec("UPDATE jobs SET status = 'generating', updated = ? WHERE job = ?", Date.now(), next.job)
    this.emit(next.job, { type: 'status', status: 'generating' })
    agent.send(JSON.stringify({ type: 'generate', job: next.job, id: next.question, day: next.day, revision: next.revision }))
    await this.schedule()
  }
  async schedule() {
    const next = this.rows("SELECT MIN(created) AS ts FROM jobs WHERE status IN ('queued','generating')")[0]?.ts
    if (next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next + DEADLINE))
    else await this.ctx.storage.setAlarm(Date.now() + 86400000)
  }
  async alarm() {
    for (const row of this.rows("SELECT job FROM jobs WHERE status IN ('queued','generating') AND created <= ?", Date.now() - DEADLINE)) {
      this.agent()?.send(JSON.stringify({ type: 'cancel', job: row.job }))
      this.finish(row.job, 'error')
    }
    this.sql.exec('DELETE FROM jobs WHERE updated < ?', Date.now() - 7 * 86400000)
    await this.dispatch()
    await this.schedule()
  }
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/agent') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426)
      // Reconnection replaces a stale socket and invalidates interrupted work.
      for (const ws of this.ctx.getWebSockets('agent')) ws.close(1000, 'Replaced')
      for (const row of this.rows("SELECT job FROM jobs WHERE status = 'generating'")) this.finish(row.job, 'error')
      const [client, server] = Object.values(new WebSocketPair())
      server.serializeAttachment({ seen: Date.now() })
      this.ctx.acceptWebSocket(server, ['agent'])
      await this.dispatch()
      return new Response(null, { status: 101, webSocket: client })
    }
    if (path === '/status') return json({ online: Boolean(this.agent()), pending: this.rows("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','generating')")[0].n })
    if (path === '/limit') {
      const epoch = this.rows('SELECT epoch FROM control WHERE id = 1')[0].epoch
      const ip = request.headers.get('cf-connecting-ip')
      if (!ip) return new Response(null, { status: 400 })
      if (!(await this.env.PER_IP.limit({ key: `${epoch}:${ip}` })).success) return new Response(null, { status: 429 })
      if (!(await this.env.OVERALL.limit({ key: `${epoch}:daily-ai` })).success) return new Response(null, { status: 429 })
      return new Response(null, { status: 204 })
    }
    if (path === '/reset' && request.method === 'POST') {
      for (const row of this.rows("SELECT job FROM jobs WHERE status IN ('queued','generating')")) {
        this.agent()?.send(JSON.stringify({ type: 'cancel', job: row.job }))
        this.finish(row.job, 'cancelled')
      }
      this.sql.exec('UPDATE control SET epoch = ?, started = 0 WHERE id = 1', crypto.randomUUID())
      return json({ ok: true })
    }
    const parsed = await readBoundedJson(request, 512)
    if (parsed.error || typeof parsed.value?.job !== 'string' || !/^[a-f0-9-]{36}$/.test(parsed.value.job)) return json({ error: 'Invalid job' }, 400)
    const { job } = parsed.value
    if (path === '/start') {
      const { id, day, revision } = parsed.value
      if (!DAILY_AI_IDS.includes(id) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(revision) || revision < 0) return json({ error: 'Invalid choice' }, 400)
      if (this.snapshot(job)) return json({ ok: true })
      if (!this.agent()) return json({ error: 'Homelab offline' }, 503)
      const count = this.rows("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','generating')")[0].n
      if (count >= MAX_QUEUE) return json({ error: 'Queue full' }, 503)
      const control = this.rows('SELECT day, started FROM control WHERE id = 1')[0]
      if (control.day === day && control.started >= 30) return json({ error: 'Daily compute budget reached' }, 503)
      this.sql.exec('UPDATE control SET day = ?, started = ? WHERE id = 1', day, control.day === day ? control.started + 1 : 1)
      this.sql.exec("INSERT INTO jobs (job, question, day, status, created, updated, revision) VALUES (?, ?, ?, 'queued', ?, ?, ?)", job, id, day, Date.now(), Date.now(), revision)
      await this.dispatch()
      await this.schedule()
      return json({ ok: true })
    }
    if (path === '/cancel') {
      const snapshot = this.snapshot(job)
      if (snapshot && !terminal(snapshot.status)) {
        this.agent()?.send(JSON.stringify({ type: 'cancel', job }))
        this.finish(job, 'cancelled')
        await this.dispatch()
      }
      return json({ ok: true })
    }
    if (path === '/job') return json(this.snapshot(job))
    if (path === '/stream') {
      const snapshot = this.snapshot(job)
      if (!snapshot) return json({ error: 'Job unavailable' }, 404)
      const group = this.listeners.get(job) || new Set()
      if (group.size >= 3) return json({ error: 'Too many open streams' }, 429)
      let controller
      const stream = new ReadableStream({
        start: sink => {
          controller = sink
          sink.enqueue(wire({ type: 'snapshot', ...snapshot }))
          if (terminal(snapshot.status)) sink.close()
          else { group.add(sink); this.listeners.set(job, group) }
        },
        cancel: () => { group.delete(controller); if (!group.size) this.listeners.delete(job) },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
    }
    return new Response(null, { status: 404 })
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 8192) return ws.close(1009, 'Message too large')
    let data
    try { data = JSON.parse(message) } catch { return ws.close(1003, 'Invalid JSON') }
    ws.serializeAttachment({ seen: Date.now() })
    if (data.type === 'ping') { ws.send('{"type":"pong"}'); return }
    const job = this.snapshot(data.job)
    if (!job || job.status !== 'generating') return
    if (data.type === 'delta' && ['thinking', 'answer'].includes(data.channel) && typeof data.text === 'string') {
      if (data.text.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.text)) return
      const current = data.channel === 'thinking' ? job.thinking : job.text
      if (current.length + data.text.length > (data.channel === 'thinking' ? 16000 : 6000)) {
        ws.send(JSON.stringify({ type: 'cancel', job: job.job })); this.finish(job.job, 'error'); await this.dispatch(); return
      }
      // Column comes from the fixed channel allowlist, never arbitrary SQL input.
      const column = data.channel === 'thinking' ? 'thinking' : 'answer'
      this.sql.exec(`UPDATE jobs SET ${column} = ${column} || ?, updated = ? WHERE job = ?`, data.text, Date.now(), job.job)
      this.emit(job.job, { type: 'delta', channel: data.channel, text: data.text })
    } else if (data.type === 'done') {
      if (!job.text.trim() || !Array.isArray(data.sources) || data.sources.length < 1 || data.sources.length > 6
          || !data.sources.every(source => typeof source === 'string' && /^\/(?:homelab|tokens|now|projects|blog(?:\/[a-z0-9-]+)?|gallery|spotting|stack|ai)$/.test(source))) {
        this.finish(job.job, 'error')
      } else {
        this.sql.exec('UPDATE jobs SET sources = ? WHERE job = ?', JSON.stringify(data.sources), job.job)
        this.emit(job.job, { type: 'sources', sources: data.sources })
        this.finish(job.job, 'done')
      }
      await this.dispatch()
    } else if (data.type === 'error') { this.finish(job.job, 'error'); await this.dispatch() }
  }
  async webSocketClose(ws) {
    // A replaced socket must not cancel the new runner's jobs.
    if (!this.ctx.getWebSockets('agent').some(socket => socket !== ws && socket.readyState === 1)) {
      for (const row of this.rows("SELECT job FROM jobs WHERE status IN ('queued','generating')")) this.finish(row.job, 'error')
    }
  }
  async webSocketError(ws) { await this.webSocketClose(ws) }
}
