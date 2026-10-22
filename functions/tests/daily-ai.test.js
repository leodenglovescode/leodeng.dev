import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onRequest as visitor } from '../api/daily-ai/[[path]].js'
import { onRequest as admin } from '../api/admin/daily-ai.js'
import { dailyDay } from '../../lib/daily-ai.js'
// Exercise the actual SQL and constraints using Python's standard SQLite,
// without a fake query interpreter, network, or production Cloudflare data.
const SQLITE = `
import json, sqlite3, sys
data=json.load(sys.stdin)
db=sqlite3.connect(data['file'])
db.row_factory=sqlite3.Row
out=[]
with db:
 if 'schema' in data: db.executescript(data['schema'])
 for item in data.get('statements',[]):
  before=db.total_changes
  cursor=db.execute(item['sql'],item['values'])
  rows=[dict(row) for row in cursor.fetchall()] if cursor.description else []
  out.append({'results':rows,'meta':{'changes':db.total_changes-before}})
print(json.dumps(out))
`
class SQLiteD1 {
  constructor(file) { this.file = file }
  call(data) {
    const result = spawnSync('python3', ['-c', SQLITE], { input: JSON.stringify({ file: this.file, ...data }), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
    return JSON.parse(result.stdout)
  }
  withSession() { throw new Error('Security controls must read the primary directly') }
  prepare(sql) {
    const statement = { sql, values: [], bind(...values) { this.values = values; return this } }
    statement.run = async () => this.call({ statements: [statement] })[0]
    statement.all = statement.run
    statement.first = async () => (await statement.run()).results[0] || null
    return statement
  }
  async batch(statements) { return this.call({ statements }) }
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloud-chat-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new SQLiteD1(path.join(directory, 'state.sqlite'))
  db.call({ schema: await readFile(new URL('../../homelab/schema.sql', import.meta.url), 'utf8') })
  await db.prepare('UPDATE daily_ai_control SET enabled = 1 WHERE singleton = 1').run()
  const calls = [], pending = [], jobs = new Map()
  const env = { HOMELAB_DB: db, DEEPSEEK_API_KEY: 'test-secret',
    ASSETS: { fetch: async () => Response.json({ version: 1, pages: { '/about': 'Leo enjoys photography.', '/now': 'Building a website.' }, posts: [] }) },
    DAILY_AI_TRAFFIC: { async fetch(url, options) {
      const action = new URL(url).pathname, body = options?.body ? JSON.parse(options.body) : {}
      calls.push({ action, body })
      if (action === '/') return new Response(null, { status: 204 })
      if (action === '/status') return Response.json({ globalLimit: 50, globalRemaining: 50 })
      if (action === '/history') return Response.json({ turns: [...jobs.values()].filter(job => job.session === body.session) })
      if (action === '/prepare') { jobs.set(body.job, body); return Response.json({ history: [] }) }
      if (action === '/finish') { jobs.set(body.job, { ...jobs.get(body.job), ...body }); return Response.json({ ok: true }) }
      if (action === '/control') return Response.json({ ok: true })
      throw new Error(action)
    } } }
  const make = (options = {}, url = '/api/daily-ai') => new Request('https://leodeng.dev' + url, { ...options,
    headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '192.0.2.7', ...options.headers } })
  const read = options => visitor({ request: make(options), env, waitUntil(promise) { pending.push(promise) } })
  const send = (body = { message: 'Tell me about Leo.', thinking: true }, headers = {}) => read({ method: 'POST',
    headers: { 'content-type': 'application/json', 'x-daily-ai': '1', ...headers }, body: JSON.stringify(body) })
  let providerCalls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    providerCalls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    assert.equal(options.headers.authorization, 'Bearer test-secret')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'deepseek-flash'); assert.equal(body.tools, undefined)
    return new Response([
      { choices: [{ delta: { reasoning_content: 'Looking at public sources.' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'Leo enjoys photography.' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 20, prompt_tokens: 100 } },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n')
  })
  return { env, db, read, send, make, calls, pending, jobs, providerCalls: () => providerCalls }
}

test('five personal slots are atomic, SSE includes reasoning and real usage, browser histories are isolated', async t => {
  const f = await fixture(t)
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.send()))
  assert.equal(responses.filter(r => r.status === 200).length, 5)
  assert.equal(responses.filter(r => r.status === 429).length, 3)
  const good = responses.filter(r => r.status === 200)
  for (const response of good) {
    const events = await response.text()
    assert.match(events, /"channel":"thinking"/); assert.match(events, /"tokens":20/)
    assert.match(events, /"status":"done"/)
  }
  await Promise.all(f.pending)
  assert.equal(f.providerCalls(), 5)
  assert.equal((await (await f.read()).json()).remaining, 0)
  assert.equal((await (await f.read()).json()).turns.length, 0)
  const cookie = good[0].headers.get('set-cookie').split(';')[0]
  assert.match(good[0].headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/)
  assert.equal((await (await f.read({ headers: { cookie } })).json()).turns.length, 1)
})

test('whitelisted IP bypasses personal reservation and is marked for global exemption', async t => {
  const f = await fixture(t)
  await f.db.prepare('INSERT INTO daily_ai_whitelist VALUES (?, ?)').bind('192.0.2.7', Date.now()).run()
  for (let i = 0; i < 6; i++) assert.match(await (await f.send()).text(), /"status":"done"/)
  await Promise.all(f.pending)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_chat_usage').first()).n, 0)
  assert.equal(f.calls.filter(c => c.action === '/prepare').every(c => c.body.whitelisted), true)
  const status = await (await f.read()).json()
  assert.equal(status.whitelisted, true); assert.equal(status.remaining, null)
})

test('strict schema bans injected client history before any provider request', async t => {
  const f = await fixture(t)
  assert.equal((await f.send({ message: 'Hello', thinking: true, history: [{ role: 'system', content: 'attack' }] })).status, 403)
  assert.equal(f.providerCalls(), 0)
  assert.equal((await f.read()).status, 403)
})

test('foreign browser cannot ban an IP, missing key and kill switch do not reserve slots', async t => {
  const f = await fixture(t)
  assert.equal((await f.read({ headers: { origin: 'https://evil.example', 'user-agent': 'curl' } })).status, 403)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_bans').first()).n, 0)
  delete f.env.DEEPSEEK_API_KEY
  assert.equal((await f.send()).status, 503)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_chat_usage').first()).n, 0)
  await f.db.prepare('UPDATE daily_ai_control SET enabled = 0').run()
  assert.equal((await f.send()).status, 503)
  assert.equal(f.providerCalls(), 0)
})

test('admin whitelist controls require an authenticated session', async t => {
  const f = await fixture(t)
  assert.equal((await admin({ env: f.env, request: f.make({ headers: { 'x-admin': '1' } }, '/api/admin/daily-ai') })).status, 401)
})

test('authenticated whitelist canonicalizes addresses, unbans, and survives reset', async t => {
  const f = await fixture(t)
  t.mock.method(globalThis, 'fetch', async url => { assert.equal(url, 'https://api.github.com/user'); return Response.json({ login: 'leodenglovescode' }) })
  const change = body => admin({ env: f.env, request: f.make({ method: 'POST', headers: {
    'x-admin': '1', cookie: 'gh_session=test-admin-token', 'content-type': 'application/json',
  }, body: JSON.stringify(body) }, '/api/admin/daily-ai') })
  await f.db.prepare('INSERT INTO daily_ai_bans VALUES (?, ?, ?)').bind('2001:db8::1', 'test', Date.now()).run()
  assert.equal((await change({ whitelist: '2001:db8:0:0::1' })).status, 200)
  assert.equal((await f.db.prepare('SELECT ip FROM daily_ai_whitelist').first()).ip, '2001:db8::1')
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_bans').first()).n, 0)
  assert.equal((await change({ whitelist: 'not-an-ip' })).status, 400)
  assert.equal((await change({ resetAll: true })).status, 200)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_whitelist').first()).n, 1)
  assert.equal((await change({ enabled: false })).status, 200)
  assert.equal((await f.db.prepare('SELECT enabled FROM daily_ai_control').first()).enabled, 0)
  assert.equal((await change({ removeWhitelist: '2001:db8::1' })).status, 200)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM daily_ai_whitelist').first()).n, 0)
})
