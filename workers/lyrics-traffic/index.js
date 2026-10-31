import { DurableObject } from 'cloudflare:workers'
import { readBoundedJson } from '../../lib/nowPlaying.js'
import { consume, initialize } from './counters.js'

export class LyricsTraffic extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    initialize(ctx.storage.sql)
  }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/check') return new Response(null, { status: 404 })
    const parsed = await readBoundedJson(request, 256)
    const { phase, identity } = parsed.value || {}
    if (parsed.error || !['request', 'upstream'].includes(phase) || !/^[a-f0-9]{64}$/.test(identity || '')) return new Response(null, { status: 400 })
    const now = Date.now()
    const allowed = this.ctx.storage.transactionSync(() => consume(this.ctx.storage.sql, phase, identity, now))
    if (allowed && await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(now + 120000)
    return new Response(null, { status: allowed ? 204 : 429, headers: {
      'Cache-Control': 'no-store', 'Retry-After': String(Math.max(1, 60 - Math.floor(now / 1000) % 60)),
    } })
  }

  async alarm() {
    const minute = Math.floor(Date.now() / 60000)
    this.ctx.storage.sql.exec('DELETE FROM counters WHERE minute < ?', minute - 1)
    if (this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM counters').toArray()[0].n) await this.ctx.storage.setAlarm(Date.now() + 120000)
  }
}

// This Worker exposes no public API. Pages uses a private namespace binding.
export default { fetch: () => new Response(null, { status: 404 }) }
