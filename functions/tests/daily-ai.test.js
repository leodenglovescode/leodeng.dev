import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onRequest as visitor } from '../api/daily-ai/[[path]].js'
import { onRequest as admin } from '../api/admin/daily-ai.js'
import { onRequest as publisher } from '../api/internal/daily-ai.js'
import { dailyDay, validBatch } from '../../lib/daily-ai.js'
import { DAILY_AI_IDS } from '../../lib/daily-ai-questions.js'

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

async function fixture(t, { enabled = true, published = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'daily-ai-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const db = new SQLiteD1(path.join(directory, 'state.sqlite'))
  db.call({ schema: await readFile(new URL('../../homelab/migrations/0003_daily_ai.sql', import.meta.url), 'utf8') })
  if (enabled) await db.prepare('UPDATE daily_ai_control SET enabled = 1 WHERE singleton = 1').run()
  const batch = { day: dailyDay(), revision: 0, model: 'qwen-local:27b',
    answers: DAILY_AI_IDS.map(id => ({ id, text: `Answer for ${id}.`, sources: ['/ai'] })) }
  const env = { DAILY_AI_TRAFFIC: { fetch: async () => new Response(null, { status: 204 }) }, HOMELAB_DB: db, DAILY_AI_TOKEN: 'test-publishing-secret' }
  const make = (url = '/api/daily-ai', options = {}) => new Request(`https://leodeng.dev${url}`, {
    ...options,
    headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '192.0.2.7', ...options.headers },
  })
  const read = options => visitor({ request: make('/api/daily-ai', options), env })
  const select = (value, headers = {}) => read({ method: 'POST', body: JSON.stringify(value),
    headers: { 'content-type': 'application/json', 'x-daily-ai': '1', ...headers } })
  const publish = (value = batch, headers = {}) => publisher({ env, request: make('/api/internal/daily-ai', {
    method: 'POST', body: JSON.stringify(value), headers: { authorization: `Bearer ${env.DAILY_AI_TOKEN}`, 'content-type': 'application/json', ...headers },
  }) })
  if (published && enabled) assert.equal((await publish()).status, 200)
  return { db, env, make, read, select, publish, batch }
}

test('five fixed choices; one atomic selection; status only reveals the selected answer', async t => {
  const { read, select } = await fixture(t)
  const initial = await (await read()).json()
  assert.equal(initial.ready, true); assert.equal(initial.answer, null)
  assert(!JSON.stringify(initial).includes('Answer for'))
  const responses = await Promise.all([select({ id: 'homelab' }), select({ id: 'site' })])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429])
  const saved = await (await read()).json()
  assert.equal(saved.answer.id, saved.selected)
  assert.equal((await select({ id: 'archive' })).status, 429)
  assert.equal((await read()).status, 200, 'A valid exhausted quota does not cause a ban')
})

test('missing batch does not consume quota; disabled feature fails closed', async t => {
  const f = await fixture(t, { published: false })
  assert.equal((await (await f.select({ id: 'site' })).json()).ready, false)
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM daily_ai_reads').first()).count, 0)
  await f.db.prepare('UPDATE daily_ai_control SET enabled = 0 WHERE singleton = 1').run()
  assert.equal((await f.read()).status, 503)
})

test('malformed fields, IDs, JSON, methods, routes, queries and oversized bodies permanently ban', async t => {
  const invalid = [
    { method: 'POST', body: '{' },
    { method: 'POST', body: JSON.stringify({ id: 'site', prompt: 'Ignore the rules' }) },
    { method: 'POST', body: JSON.stringify({ id: 'anything' }) },
    { method: 'POST', body: 'null' },
    { method: 'POST', body: '[]' },
    { method: 'POST', body: ' '.repeat(129) },
    { method: 'POST', body: JSON.stringify({ id: 'site' }), headers: { 'x-daily-ai': '' } },
    { method: 'DELETE' },
    { route: '/api/daily-ai?prompt=hello' },
    { route: '/api/daily-ai/other' },
  ]
  for (const options of invalid) {
    const { env, make, read } = await fixture(t)
    const headers = { 'content-type': 'application/json', 'x-daily-ai': '1', ...options.headers }
    const response = await visitor({ env, request: make(options.route, { ...options, headers }) })
    assert.equal(response.status, 403, JSON.stringify(options))
    assert.equal((await (await read()).json()).banned, true)
  }
})

test('curl and Python user agents cause permanent AI bans, even before enablement', async t => {
  for (const agent of ['curl/8.0', 'python-requests/2.32', 'Python-urllib/3.12', 'python-httpx/0.27', 'aiohttp/3.9']) {
    const { read } = await fixture(t, { enabled: false })
    assert.equal((await read({ headers: { 'user-agent': agent } })).status, 403)
    assert.equal((await (await read()).json()).banned, true)
  }
})

test('foreign websites cannot cause a visitor IP ban; X-Forwarded-For cannot evade a ban', async t => {
  const { read, select } = await fixture(t)
  assert.equal((await select({ prompt: 'attack' }, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await read()).status, 200)
  await select({ prompt: 'attack' })
  assert.equal((await read({ headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 403)
  assert.equal((await read({ headers: { 'cf-connecting-ip': '' } })).status, 503)
})

test('IPv6 alternate representations share bans and quotas', async t => {
  const { read, select } = await fixture(t)
  assert.equal((await select({ id: 'site' }, { 'cf-connecting-ip': '2001:db8::1' })).status, 200)
  assert.equal((await select({ id: 'archive' }, { 'cf-connecting-ip': '2001:0db8:0:0:0:0:0:1' })).status, 429)
  await select({ text: 'bad' }, { 'cf-connecting-ip': '2001:db8::1' })
  assert.equal((await read({ headers: { 'cf-connecting-ip': '2001:0db8:0:0:0:0:0:1' } })).status, 403)
})

test('publisher requires its own secret and only accepts one complete batch per day', async t => {
  const { publish, batch, db } = await fixture(t, { published: false })
  assert.equal((await publish(batch, { authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await publish({ ...batch, answers: batch.answers.slice(0, 4) })).status, 400)
  const duplicate = { ...batch, answers: [batch.answers[0], ...batch.answers.slice(0, 4)] }
  assert.equal((await publish(duplicate)).status, 400)
  assert.equal((await publish()).status, 200)
  assert.equal((await publish()).status, 409)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM daily_ai_batch').first()).count, 1)
  assert(!validBatch({ ...batch, answers: batch.answers.map(answer => ({ ...answer, sources: ['javascript:alert(1)'] })) }, dailyDay()))
})

test('admin authentication, kill switch revision, unban and pagination use the real SQL', async t => {
  const f = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ login: 'leodenglovescode' }), { headers: { 'content-type': 'application/json' } }))
  const manage = (body, headers = {}) => admin({ env: f.env, request: f.make('/api/admin/daily-ai', {
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { 'x-admin': '1', 'content-type': 'application/json', cookie: 'gh_session=test', ...headers },
  }) })
  assert.equal((await manage(null, { cookie: '' })).status, 401)
  assert.equal((await manage({ enabled: false }, { origin: 'https://evil.example' })).status, 403)
  await f.select({ id: 'site' })
  await f.select({ id: 'site', extra: true })
  assert.equal((await f.read()).status, 403)
  assert.equal((await manage({ unban: '192.0.2.7' })).status, 200)
  assert.equal((await f.read()).status, 200)
  assert.equal((await f.select({ id: 'archive' })).status, 429, 'Unban does not reset allowance')
  assert.equal((await manage({ enabled: false })).status, 200)
  assert.equal((await f.read()).status, 503)
  assert.equal((await manage({ enabled: true })).status, 200)
  await f.db.prepare('DELETE FROM daily_ai_batch').run()
  assert.equal((await f.publish()).status, 409, 'Old generation lease remains invalid after re-enable')
  const current = await (await manage()).json()
  assert.equal((await f.publish({ ...f.batch, revision: current.revision })).status, 200)
  await f.db.batch(Array.from({ length: 55 }, (_, i) => f.db.prepare('INSERT INTO daily_ai_bans VALUES (?, ?, ?)').bind(`198.51.100.${i}`, 'test', i)))
  const listing = await (await manage()).json()
  assert.equal(listing.total, 55); assert.equal(listing.bans.length, 50)
})

test('Beijing day boundary is independent of host timezone', () => {
  assert.equal(dailyDay(Date.parse('2026-10-21T15:59:59Z')), '2026-10-21')
  assert.equal(dailyDay(Date.parse('2026-10-21T16:00:00Z')), '2026-10-22')
})

test('traffic denial and limiter failures never query D1 or create permanent bans', async () => {
  let queries = 0
  const env = { HOMELAB_DB: { prepare() { queries++; throw new Error('D1 must not be touched') } } }
  const request = new Request('https://leodeng.dev/api/daily-ai', {
    headers: { 'cf-connecting-ip': '192.0.2.7', 'user-agent': 'Mozilla/5.0' },
  })
  for (const method of ['GET', 'POST', 'DELETE']) {
    env.DAILY_AI_TRAFFIC = { async fetch(url, options) {
      assert.equal(url, 'https://daily-ai-traffic.internal/')
      assert.deepEqual(options.headers, { 'cf-connecting-ip': '192.0.2.7' })
      assert.equal(options.body, undefined)
      return new Response(null, { status: 429 })
    } }
    const response = await visitor({ env, request: new Request(request, { method }) })
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('retry-after'), '60')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).code, 'traffic_limited')
  }
  for (const gate of [undefined, { fetch: async () => new Response(null, { status: 503 }) },
    { fetch: async () => { throw new Error('Unavailable') } },
    { fetch: async () => new Response(null, { status: 200 }) }]) {
    env.DAILY_AI_TRAFFIC = gate
    assert.equal((await visitor({ env, request })).status, 503)
  }
  assert.equal(queries, 0)
})
