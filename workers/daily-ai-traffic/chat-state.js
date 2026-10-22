import { DurableObject } from 'cloudflare:workers'
import { dailyDay } from '../../lib/daily-ai.js'
import { readBoundedJson } from '../../lib/nowPlaying.js'

const json = (body, status = 200) => Response.json(body, { status })
const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
export class ChatState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec("CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY, epoch TEXT, revision INTEGER, enabled INTEGER)")
    this.sql.exec("INSERT OR IGNORE INTO control VALUES (1, 'initial', -1, 1)")
    this.sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS turns (job TEXT PRIMARY KEY, session TEXT NOT NULL, day TEXT NOT NULL,
      revision INTEGER NOT NULL, message TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', thinking TEXT NOT NULL DEFAULT '',
      stats TEXT, status TEXT NOT NULL, code TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL)`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS turns_session ON turns(session, day, created)')
  }
  rows(query, ...values) { return this.sql.exec(query, ...values).toArray() }
  async alarm() {
    this.sql.exec("UPDATE turns SET status = 'error', code = 'generation_timeout' WHERE status = 'running' AND expires <= ?", Date.now())
    this.sql.exec('DELETE FROM turns WHERE day <> ?', dailyDay())
    this.sql.exec('DELETE FROM daily WHERE day <> ?', dailyDay())
    await this.schedule()
  }
  async schedule() {
    const expiry = this.rows("SELECT MIN(expires) AS ts FROM turns WHERE status = 'running'")[0]?.ts
    const midnight = Date.parse(dailyDay() + 'T00:00:00+08:00') + 86400000
    await this.ctx.storage.setAlarm(Math.min(expiry || midnight, midnight) + 1000)
  }
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/limit') {
      const ip = request.headers.get('cf-connecting-ip')
      if (!ip) return new Response(null, { status: 400 })
      const { epoch } = this.rows('SELECT epoch FROM control WHERE id = 1')[0]
      if (!(await this.env.PER_IP.limit({ key: `${epoch}:${ip}` })).success
          || !(await this.env.OVERALL.limit({ key: `${epoch}:chat` })).success) return new Response(null, { status: 429 })
      return new Response(null, { status: 204 })
    }
    if (path === '/status') {
      const used = this.rows('SELECT used FROM daily WHERE day = ?', dailyDay())[0]?.used || 0
      return json({ globalLimit: 50, globalRemaining: Math.max(0, 50 - used) })
    }
    const parsed = await readBoundedJson(request, path === '/finish' ? 96 * 1024 : 12 * 1024)
    if (parsed.error || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return json({ error: 'Invalid relay request.' }, 400)
    const body = parsed.value
    if (path === '/control') {
      if (!Number.isSafeInteger(body.revision) || typeof body.enabled !== 'boolean') return json({ error: 'Invalid controls.' }, 400)
      const control = this.rows('SELECT revision FROM control WHERE id = 1')[0]
      if (body.revision < control.revision) return json({ error: 'Stale controls.' }, 409)
      this.sql.exec('UPDATE control SET revision = ?, enabled = ? WHERE id = 1', body.revision, Number(body.enabled))
      this.sql.exec("UPDATE turns SET status = 'cancelled', code = 'generation_cancelled' WHERE status = 'running'")
      if (body.reset === true) {
        this.sql.exec('DELETE FROM daily')
        this.sql.exec('UPDATE control SET epoch = ? WHERE id = 1', crypto.randomUUID())
      }
      return json({ ok: true })
    }
    if (!validId(body.session) || body.day !== dailyDay()) return json({ error: 'Invalid session.' }, 400)
    if (path === '/history') {
      const turns = this.rows('SELECT job AS id, message, answer AS text, thinking, stats, status, code FROM turns WHERE session = ? AND day = ? ORDER BY created DESC, rowid DESC LIMIT 20', body.session, body.day).reverse()
      return json({ turns: turns.map(turn => ({ ...turn, stats: turn.stats ? JSON.parse(turn.stats) : null })) })
    }
    if (!validId(body.job)) return json({ error: 'Invalid turn.' }, 400)
    if (path === '/prepare') {
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000
          || !Number.isSafeInteger(body.revision) || typeof body.whitelisted !== 'boolean') return json({ error: 'Invalid message.' }, 400)
      const control = this.rows('SELECT revision, enabled FROM control WHERE id = 1')[0]
      if (body.revision < control.revision || body.revision === control.revision && !control.enabled) return json({ error: 'Controls changed.' }, 409)
      if (body.revision > control.revision) this.sql.exec('UPDATE control SET revision = ?, enabled = 1 WHERE id = 1', body.revision)
      this.sql.exec("UPDATE turns SET status = 'error', code = 'generation_timeout' WHERE status = 'running' AND expires <= ?", Date.now())
      if (this.rows("SELECT job FROM turns WHERE session = ? AND day = ? AND status = 'running'", body.session, body.day).length) return json({ error: 'A reply is already running.', code: 'chat_busy' }, 409)
      if (this.rows("SELECT COUNT(*) AS n FROM turns WHERE status = 'running'")[0].n >= 3) return json({ error: 'Chat is busy.', code: 'chat_busy' }, 503)
      const used = this.rows('SELECT used FROM daily WHERE day = ?', body.day)[0]?.used || 0
      if (!body.whitelisted && used >= 50) return json({ error: 'Public daily limit reached.', code: 'global_daily_limit' }, 429)
      const history = this.rows("SELECT message, answer FROM turns WHERE session = ? AND day = ? AND status = 'done' ORDER BY created DESC, rowid DESC LIMIT 4", body.session, body.day).reverse()
      if (!body.whitelisted) this.sql.exec('INSERT INTO daily VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1', body.day)
      this.sql.exec("INSERT INTO turns (job, session, day, revision, message, status, created, expires) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)", body.job, body.session, body.day, body.revision, body.message, Date.now(), Date.now() + 120000)
      await this.schedule()
      return json({ history })
    }
    if (path === '/finish') {
      const row = this.rows('SELECT status, revision FROM turns WHERE job = ? AND session = ? AND day = ?', body.job, body.session, body.day)[0]
      const control = this.rows('SELECT revision, enabled FROM control WHERE id = 1')[0]
      if (!row || row.status !== 'running' || row.revision !== control.revision || !control.enabled) return json({ error: 'Turn cancelled.' }, 409)
      if (!['done', 'error'].includes(body.status) || typeof body.answer !== 'string' || body.answer.length > 16000
          || typeof body.thinking !== 'string' || body.thinking.length > 24000) return json({ error: 'Invalid response.' }, 400)
      const codes = ['provider_error', 'provider_auth', 'provider_balance', 'provider_busy', 'stream_incomplete', 'output_limit', 'generation_timeout', 'generation_cancelled', 'empty_answer']
      this.sql.exec('UPDATE turns SET answer = ?, thinking = ?, stats = ?, status = ?, code = ? WHERE job = ?', body.answer, body.thinking,
        body.stats && JSON.stringify(body.stats).length <= 2048 ? JSON.stringify(body.stats) : null, body.status, codes.includes(body.code) ? body.code : null, body.job)
      this.sql.exec('DELETE FROM turns WHERE session = ? AND day = ? AND job NOT IN (SELECT job FROM turns WHERE session = ? AND day = ? ORDER BY created DESC, rowid DESC LIMIT 20)', body.session, body.day, body.session, body.day)
      return json({ ok: true })
    }
    return json({ error: 'Not found.' }, 404)
  }
}
