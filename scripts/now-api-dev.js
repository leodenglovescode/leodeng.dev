// Keep Vite dev and preview aligned with the deployed, public endpoint.
import { readFile } from 'node:fs/promises'
import { nowResponse } from '../lib/now-api.js'

export function nowApiPlugin() {
  const install = server => { server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/now') return next()
    try {
      const data = JSON.parse(await readFile(new URL('../src/content/now.json', import.meta.url), 'utf8'))
      const response = nowResponse(new Request(url, { method: req.method }), data)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(req.method === 'HEAD' ? undefined : await response.text())
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'Now data unavailable.' }))
    }
  }) }
  return { name: 'now-api', configureServer: install, configurePreviewServer: install }
}
