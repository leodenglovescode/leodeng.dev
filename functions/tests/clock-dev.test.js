import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { clockDevPlugin, loadClockHost } from '../../scripts/clock-dev.js'

async function fixture(t, config) {
  const root = await mkdtemp(path.join(tmpdir(), 'clock-preview-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  if (config !== undefined) {
    await mkdir(path.join(root, '.local-admin'))
    await writeFile(path.join(root, '.local-admin/clock-config.json'), JSON.stringify(config))
  }
  return root
}

test('clock preview is opt-in and rejects SSH options in host configuration', async t => {
  assert.equal(await loadClockHost(await fixture(t)), null)
  for (const host of ['-oProxyCommand=anything', 'user@host extra', '', null]) {
    await assert.rejects(loadClockHost(await fixture(t, { sshHost: host })), /Invalid local clock host/)
  }
  assert.equal(await loadClockHost(await fixture(t, { sshHost: 'operator@clock.internal' })), 'operator@clock.internal')
})

test('dev and preview use a loopback tunnel and close it with the server', async t => {
  for (const kind of ['server', 'preview']) {
    const root = await fixture(t, { sshHost: 'operator@clock.internal' })
    const httpServer = new EventEmitter()
    let closed = 0
    const plugin = clockDevPlugin({ connect: async host => {
      assert.equal(host, 'operator@clock.internal')
      return { target: 'http://127.0.0.1:12345', close: () => closed++ }
    } })
    const config = { root, [kind]: { proxy: { '/api/time': { target: 'https://public.example' } } },
      logger: { info() {}, warn() {} } }
    await plugin[kind === 'server' ? 'configureServer' : 'configurePreviewServer']({ config, httpServer })
    const proxy = config[kind].proxy['/api/time']
    assert.equal(proxy.target, 'http://127.0.0.1:12345')
    assert.equal(proxy.rewrite('/api/time'), '/time')
    assert.equal(proxy.rewrite('/api/time?unexpected=1'), '/time?unexpected=1')
    assert.equal(proxy.rewrite('/api/time-extra'), '/api/time-extra')
    httpServer.emit('close')
    assert.equal(closed, 1)
  }
})

test('absent or unavailable private transport preserves the public fallback without logging details', async t => {
  for (const configured of [false, true]) {
    const root = await fixture(t, configured ? { sshHost: 'operator@clock.internal' } : undefined)
    const warnings = []
    let attempts = 0
    const plugin = clockDevPlugin({ connect: async () => { attempts++; throw new Error('private diagnostic') } })
    const config = { root, server: { proxy: { '/api/time': { target: 'https://public.example' } } },
      logger: { info() {}, warn: value => warnings.push(value) } }
    await plugin.configureServer({ config, httpServer: new EventEmitter() })
    assert.equal(config.server.proxy['/api/time'].target, 'https://public.example')
    assert.equal(attempts, configured ? 1 : 0)
    assert.deepEqual(warnings, configured ? ['Local clock connection unavailable; using the public clock API.'] : [])
  }
})
