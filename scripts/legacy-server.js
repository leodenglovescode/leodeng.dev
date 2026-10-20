// Dedicated HTTP preview for an actual old browser. No Vite transforms, HMR,
// modules, certificates or external image connections reach the iPad.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { cleanLegacyPath, MODERN_ORIGIN } from '../lib/legacy.js'
import { legacyMediaKey } from '../lib/legacy-media.js'
import { loadMonkeyStats } from '../lib/monkeyStats.js'
import { lookupLyrics } from '../lib/lyricsProxy.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const publicApis = new Set(['/api/now-playing', '/api/homelab', '/api/tokens', '/api/time', '/api/ip', '/api/lyrics', '/api/stats/monkeytype'])
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' }

export function createLegacyPreview({ directory = path.join(projectRoot, 'dist/_legacy'), fetchUpstream = fetch, cssFile = path.join(projectRoot, 'legacy/legacy.css') } = {}) {
  const cache = new Map()
  let cachedBytes = 0
  const maxCacheBytes = 16 * 1024 * 1024
  async function image(key) {
    const cached = cache.get(key)
    if (cached) return cached
    const upstream = await fetchUpstream(`https://media.leodeng.dev/${key}`, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0 leodeng-legacy-preview' } })
    const expectedType = key.endsWith('.png') ? 'image/png' : 'image/jpeg'
    if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith(expectedType)) return null
    const chunks = []
    let size = 0
    for await (const chunk of upstream.body) {
      size += chunk.length
      if (size > 3 * 1024 * 1024) throw new Error('Image exceeds preview limit.')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    while (cachedBytes + bytes.length > maxCacheBytes && cache.size) {
      const oldest = cache.keys().next().value
      cachedBytes -= cache.get(oldest).length
      cache.delete(oldest)
    }
    cache.set(key, bytes); cachedBytes += bytes.length
    return bytes
  }
  return async function respond(request) {
    const url = new URL(request.url)
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } })
    if (url.pathname === '/_legacy') return new Response(null, { status: 302, headers: { Location: `/_legacy/${url.search}` } })
    const rawPath = url.pathname.replace(/^\/_legacy(?=\/|$)/, '') || '/'
    const pathname = cleanLegacyPath(rawPath)
    if (!pathname) return new Response('Invalid path.', { status: 400 })
    if (pathname.startsWith('/api/')) {
      if (!publicApis.has(pathname)) return new Response('Not found.', { status: 404 })
      if (pathname === '/api/stats/monkeytype') return Response.json(await loadMonkeyStats({}, fetchUpstream), { headers: { 'Cache-Control': 'no-store' } })
      if (pathname === '/api/lyrics') return lookupLyrics(request, fetchUpstream)
      try {
        const upstream = await fetchUpstream(`${MODERN_ORIGIN}${pathname}${pathname === '/api/lyrics' ? url.search : ''}`, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json' } })
        if (![200, 204].includes(upstream.status)) return new Response('Live reading unavailable.', { status: 503 })
        if (upstream.status === 204) return new Response(null, { status: 204 })
        return new Response(request.method === 'HEAD' ? null : upstream.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
      } catch { return new Response('Live reading unavailable.', { status: 503 }) }
    }
    const key = legacyMediaKey(pathname)
    if (key) {
      try {
        const bytes = await image(key)
        return bytes ? new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': key.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } }) : new Response('Image not found.', { status: 404 })
      } catch { return new Response('Image unavailable.', { status: 502 }) }
    }
    if (!path.extname(pathname) && !pathname.endsWith('/')) return new Response(null, { status: 302, headers: { Location: `${url.pathname}/${url.search}` } })
    const filename = path.resolve(directory, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '')
    if (!filename.startsWith(path.resolve(directory) + path.sep)) return new Response('Invalid path.', { status: 400 })
    let bytes, status = 200
    try { bytes = await fs.readFile(filename) } catch {
      status = 404
      try { bytes = await fs.readFile(path.join(directory, '404.html')) } catch { bytes = Buffer.from('Run npm run build to prepare the classic edition.') }
    }
    const type = status === 404 ? mimeTypes['.html'] : mimeTypes[path.extname(filename)] || 'application/octet-stream'
    if (type.startsWith('text/html')) {
      // CSS changes appear on refresh without rebuilding the modern app.
      const css = await fs.readFile(cssFile, 'utf8')
      bytes = Buffer.from(bytes.toString('utf8').replace(/<style id="legacy-style">[\s\S]*?<\/style>/, () => `<style id="legacy-style">${css}</style>`))
    }
    return new Response(request.method === 'HEAD' ? null : bytes, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Legacy-Site': 'true' } })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { EnvHttpProxyAgent, fetch: upstreamFetch } = await import('undici')
  const dispatcher = new EnvHttpProxyAgent()
  const { buildLegacySite } = await import('./build-legacy.js')
  try { await fs.access(path.join(projectRoot, 'dist/_site-routes.json')) } catch {
    const result = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
  }
  const { collections } = await import('../dist-ssr/entry-server.js')
  const routes = JSON.parse(await fs.readFile(path.join(projectRoot, 'dist/_site-routes.json'), 'utf8'))
  await buildLegacySite({ routes, collections })
  const respond = createLegacyPreview({ fetchUpstream: (url, options) => upstreamFetch(url, { ...options, dispatcher }) })
  const port = Number(process.env.LEGACY_PORT || 5176)
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const response = await respond(new Request(new URL(incoming.url, 'http://localhost'), { method: incoming.method }))
      let bytes = Buffer.from(await response.arrayBuffer())
      const headers = Object.fromEntries(response.headers)
      if (incoming.method !== 'HEAD' && /\bgzip\b/.test(incoming.headers['accept-encoding'] || '') && /^(text\/|application\/(javascript|json))/.test(headers['content-type'] || '')) {
        bytes = gzipSync(bytes); headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding'
      }
      headers['content-length'] = bytes.length
      outgoing.writeHead(response.status, headers); outgoing.end(bytes)
    } catch { outgoing.writeHead(500, { 'Content-Type': 'text/plain' }); outgoing.end('Preview unavailable. Rebuild the classic edition.'); }
  })
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other server, or set LEGACY_PORT to another port.` : 'Could not start the classic preview.'); process.exitCode = 1; void dispatcher.close() })
  server.listen(port, '0.0.0.0', () => {
    console.log(`\nClassic edition: http://localhost:${port}/`)
    try { for (const [name, entries] of Object.entries(os.networkInterfaces())) for (const address of entries || []) if (address.family === 'IPv4' && !address.internal && !/^(?:docker|br-|veth|virbr|tailscale|headscale|tun|tap)/.test(name) && !address.address.startsWith('169.254.')) console.log(`iPad / LAN:     http://${address.address}:${port}/`) } catch { console.log(`iPad / LAN: http://YOUR-COMPUTER-IP:${port}/`) }
    console.log('Plain HTTP, inline styling, no Vite client. Refresh after CSS edits.\n')
  })
}
