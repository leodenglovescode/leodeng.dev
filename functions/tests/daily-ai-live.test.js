import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import * as miniflare from 'miniflare'
import { dailyDay } from '../../lib/daily-ai.js'
import { readProviderStream, providerBody, cloudStats } from '../../lib/deepseek-chat.js'
const compatibleOptions = options => miniflare.convertV4MiniflareOptions?.(options) || options

test('real SQLite coordinator enforces global caps, concurrency, whitelist exemption and cancellation', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloud-chat-do-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bundle = path.join(directory, 'worker.mjs')
  await build({ entryPoints: ['workers/daily-ai-traffic/index.js'], outfile: bundle, bundle: true, format: 'esm', external: ['cloudflare:workers'], platform: 'browser' })
  const mf = new miniflare.Miniflare(compatibleOptions({ name: 'test-chat', rootPath: directory, modules: true, script: await readFile(bundle, 'utf8'), compatibilityDate: '2026-10-03',
    durableObjects: { CHAT_STATE: { className: 'ChatState', useSQLite: true } },
    ratelimits: { PER_IP: { namespace_id: '1', simple: { limit: 2, period: 60 } }, OVERALL: { namespace_id: '2', simple: { limit: 300, period: 60 } } },
  }))
  t.after(() => mf.dispose())
  const call = (action, body) => mf.dispatchFetch('http://private/' + action, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const next = () => ({ job: crypto.randomUUID(), session: crypto.randomUUID(), day: dailyDay(), revision: 1, message: 'Hello', whitelisted: false })
  const finish = turn => call('finish', { ...turn, status: 'done', answer: 'Public answer', thinking: 'Thinking', stats: null, code: null })
  const a = next(), b = next(), c = next()
  assert.equal((await call('prepare', a)).status, 200)
  assert.equal((await call('prepare', { ...next(), session: a.session })).status, 409)
  assert.equal((await call('prepare', b)).status, 200)
  assert.equal((await call('prepare', c)).status, 200)
  assert.equal((await call('prepare', next())).status, 503)
  for (const turn of [a, b, c]) assert.equal((await finish(turn)).status, 200)
  assert.equal((await (await call('history', { session: a.session, day: dailyDay() })).json()).turns.length, 1)
  assert.equal((await (await call('history', { session: crypto.randomUUID(), day: dailyDay() })).json()).turns.length, 0)
  for (let i = 3; i < 50; i++) { const turn = next(); assert.equal((await call('prepare', turn)).status, 200); await finish(turn) }
  assert.equal((await call('prepare', next())).status, 429)
  const white = { ...next(), whitelisted: true }
  assert.equal((await call('prepare', white)).status, 200)
  assert.equal((await (await call('status')).json()).globalRemaining, 0)
  await call('control', { revision: 2, enabled: false, reset: false })
  assert.equal((await finish(white)).status, 409)
  assert.equal((await call('prepare', next())).status, 409)
  await call('control', { revision: 3, enabled: true, reset: true })
  assert.equal((await (await call('status')).json()).globalRemaining, 50)
  for (const retired of ['agent', 'start', 'stream', 'job', 'reset']) assert.equal((await call(retired)).status, 404)
  const limit = () => mf.dispatchFetch('http://private/', { headers: { 'cf-connecting-ip': '192.0.2.1' } })
  assert.equal((await limit()).status, 204); assert.equal((await limit()).status, 204); assert.equal((await limit()).status, 429)
  await call('control', { revision: 4, enabled: true, reset: true })
  assert.equal((await limit()).status, 204)
})

test('provider stream handles split UTF-8 and CRLF, terminal usage and rejects incomplete/tool output', async () => {
  const frames = [
    { choices: [{ delta: { reasoning_content: '思考' } }] },
    { choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }], usage: { completion_tokens: 15 } },
  ].map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  const bytes = new TextEncoder().encode(frames), parts = []
  const response = new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close() } }))
  const result = await readProviderStream(response, (channel, text) => parts.push([channel, text]), new AbortController().signal)
  assert.deepEqual(parts, [['thinking', '思考'], ['answer', 'Answer']]); assert.equal(result.usage.completion_tokens, 15)
  for (const text of ['data: [DONE]\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{}]}}]}\n\n']) {
    await assert.rejects(readProviderStream(new Response(text), () => {}, new AbortController().signal))
  }
})

test('provider request bounds history, disables tools and never replays reasoning', () => {
  const body = providerBody('Hello', true, Array.from({ length: 20 }, () => ({ message: '你'.repeat(2000), answer: '你'.repeat(10000), thinking: 'SECRET_REASONING' })), 'public')
  assert.equal(body.model, 'deepseek-flash'); assert.equal(body.tools, undefined)
  assert.equal(body.max_tokens, 4096); assert.equal(body.reasoning_effort, 'low')
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length <= 32768)
  assert.ok(!JSON.stringify(body).includes('SECRET_REASONING'))
  assert.equal(providerBody('Hi', false, [], '').max_tokens, 1024)
  const stats = cloudStats({ completion_tokens: 100, prompt_tokens: 200 }, 0, 1000, 3000, 'stop')
  assert.equal(stats.tokensPerSecond, 50); assert.equal(stats.durationMs, 3000)
})
