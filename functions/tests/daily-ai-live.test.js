import { dailyDay } from '../../lib/daily-ai.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import * as miniflare from 'miniflare'
const { Miniflare } = miniflare
const compatibleOptions = options => miniflare.convertV4MiniflareOptions?.(options) || options
import { consumeDailyAiStream } from '../../src/utils/dailyAiStream.js'

const job = (id = 'site') => ({ job: crypto.randomUUID(), id, day: dailyDay(), revision: 1 })

test('real Durable Object streams model deltas, bounds the queue, replays results and resets all counters', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'daily-ai-live-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bundle = path.join(directory, 'worker.mjs')
  await build({ entryPoints: ['workers/daily-ai-traffic/index.js'], outfile: bundle, bundle: true, format: 'esm', external: ['cloudflare:workers'], platform: 'browser' })
  const mf = new Miniflare(compatibleOptions({ name: 'test-relay', rootPath: directory, modules: true, script: await readFile(bundle, 'utf8'), compatibilityDate: '2026-10-03',
    durableObjects: { LIVE_HUB: { className: 'LiveHub', useSQLite: true } },
    ratelimits: { PER_IP: { namespace_id: '1', simple: { limit: 2, period: 60 } }, OVERALL: { namespace_id: '2', simple: { limit: 30, period: 60 } } },
  }))
  t.after(() => mf.dispose())
  const call = (action, body) => mf.dispatchFetch('http://relay.internal/' + action, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  })
  assert.equal((await call('start', job())).status, 503, 'Offline jobs never enqueue')
  const connected = await mf.dispatchFetch('http://relay.internal/agent', { headers: { Upgrade: 'websocket' } })
  assert.equal(connected.status, 101)
  const agent = connected.webSocket
  agent.accept()
  t.after(() => agent.close())
  const messages = []
  agent.addEventListener('message', event => messages.push(JSON.parse(event.data)))
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('Timed out waiting for relay event')
  }
  const first = job()
  assert.equal((await call('start', first)).status, 200)
  await waitFor(() => messages.some(message => message.job === first.job && message.type === 'generate'))
  const response = await call('stream', { job: first.job })
  const events = []
  const finished = consumeDailyAiStream(response, event => events.push(event))
  await waitFor(() => events.some(event => event.type === 'snapshot'))
  agent.send(JSON.stringify({ type: 'delta', job: first.job, channel: 'thinking', text: 'Checking public sources.' }))
  await waitFor(() => events.some(event => event.channel === 'thinking'))
  assert(!events.some(event => event.status === 'done'), 'Thinking arrives before completion')
  agent.send(JSON.stringify({ type: 'delta', job: first.job, channel: 'answer', text: 'A live answer. 中文' }))
  await waitFor(() => events.some(event => event.channel === 'answer'))
  // Two waiting jobs plus the active one fill the bounded single-GPU queue.
  const second = job('homelab'), third = job('photography')
  assert.equal((await call('start', second)).status, 200)
  assert.equal((await call('start', third)).status, 200)
  assert.equal((await call('start', job('archive'))).status, 503)
  assert.equal((await call('start', job('arbitrary-prompt'))).status, 400)
  agent.send(JSON.stringify({ type: 'done', job: first.job, sources: ['/ai'] }))
  await finished
  const replay = []
  await consumeDailyAiStream(await call('stream', { job: first.job }), event => replay.push(event))
  assert.equal(replay[0].text, 'A live answer. 中文')
  assert.equal(replay[0].thinking, 'Checking public sources.')
  assert.equal(replay[0].status, 'done')
  assert.deepEqual(replay[0].sources, ['/ai'])
  assert.equal((await (await call('job', { job: second.job })).json()).answer, undefined)
  const limit = () => mf.dispatchFetch('http://relay.internal/', { headers: { 'cf-connecting-ip': '192.0.2.1' } })
  assert.equal((await limit()).status, 204)
  assert.equal((await limit()).status, 204)
  assert.equal((await limit()).status, 429)
  assert.equal((await call('reset', {})).status, 200)
  assert.equal((await limit()).status, 204, 'Admin reset changes the traffic counter namespace immediately')
  assert.equal((await (await call('job', { job: second.job })).json()).status, 'cancelled')
  assert.equal((await (await call('status')).json()).pending, 0)
  for (let i = 0; i < 50; i++) {
    const next = job()
    const eventsBefore = messages.length
    assert.equal((await call('start', next)).status, 200)
    await waitFor(() => messages.slice(eventsBefore).some(event => event.type === 'generate' && event.job === next.job))
    agent.send(JSON.stringify({ type: 'delta', job: next.job, channel: 'answer', text: 'Answer' }))
    agent.send(JSON.stringify({ type: 'done', job: next.job, sources: ['/ai'] }))
    await waitFor(() => messages.length >= eventsBefore + 1)
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await (await call('job', { job: next.job })).json()).status === 'done') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const exhausted = await call('start', job())
  assert.equal(exhausted.status, 429)
  assert.equal((await exhausted.json()).code, 'global_daily_limit')
  assert.equal((await (await call('status')).json()).remaining, 0)
  await call('reset', {})
  assert.equal((await (await call('status')).json()).remaining, 50)
  // Late tokens from cancelled inference cannot revive an answer.
  agent.send(JSON.stringify({ type: 'delta', job: second.job, channel: 'answer', text: 'late token' }))
  assert.equal((await (await call('job', { job: second.job })).json()).text, '')
})

test('browser stream decoder handles split UTF-8, split frames and incomplete data', async () => {
  const data = new TextEncoder().encode('data: {"type":"delta","text":"中文"}\n\n')
  const stream = new ReadableStream({ start(controller) {
    for (const byte of data) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })
  const events = []
  await consumeDailyAiStream(new Response(stream), event => events.push(event))
  assert.equal(events[0].text, '中文')
  await assert.rejects(consumeDailyAiStream(new Response('data: {'), () => {}), /Incomplete/)
})
