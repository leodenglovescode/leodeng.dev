// Node-only preview transport. Private connection settings stay outside Git.
import { readFile } from 'node:fs/promises'
import { createServer, createConnection } from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'

export async function loadClockHost(root) {
  let settings
  try { settings = JSON.parse(await readFile(path.join(root, '.local-admin/clock-config.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const host = settings?.sshHost
  if (typeof host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host)) {
    throw new Error('Invalid local clock host')
  }
  return host
}

export async function openClockTunnel(host) {
  const port = await new Promise((resolve, reject) => {
    const reservation = createServer()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port
      reservation.close(error => error ? reject(error) : resolve(port))
    })
  })
  let child, retry, closed = false
  const launch = () => {
    child = spawn('ssh', [
      '-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=5',
      '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
      '-L', `127.0.0.1:${port}:127.0.0.1:8099`, host,
    ], { stdio: 'ignore', shell: false })
    child.on('error', () => {}) // Startup failures are reported by the bounded readiness check.
    child.once('close', () => { if (!closed) retry = setTimeout(launch, 2000) })
  }
  const close = () => { closed = true; clearTimeout(retry); child?.kill() }
  launch()
  try {
    const deadline = performance.now() + 5500
    while (true) {
      const ready = await new Promise(resolve => {
        const probe = createConnection({ host: '127.0.0.1', port })
        const finish = success => { probe.destroy(); resolve(success) }
        probe.setTimeout(200, () => finish(false))
        probe.once('error', () => finish(false))
        probe.once('connect', () => finish(true))
      })
      if (ready) break
      if (performance.now() >= deadline) throw new Error('Local clock connection unavailable')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return { target: `http://127.0.0.1:${port}`, close }
  } catch (error) { close(); throw error }
}

export function clockDevPlugin({ connect = openClockTunnel } = {}) {
  const install = kind => async server => {
    let connection
    try {
      const host = await loadClockHost(server.config.root)
      if (!host) return
      connection = await connect(host)
      server.config[kind].proxy['/api/time'] = {
        target: connection.target,
        changeOrigin: true,
        rewrite: url => url.replace(/^\/api\/time(?=\?|$)/, '/time'),
      }
      server.httpServer?.once('close', () => connection.close())
      server.config.logger.info('Clock preview: connected directly to the receiver host over SSH.')
    } catch {
      connection?.close()
      server.config.logger.warn('Local clock connection unavailable; using the public clock API.')
    }
  }
  return { name: 'clock-preview', apply: 'serve',
    configureServer: install('server'), configurePreviewServer: install('preview') }
}
