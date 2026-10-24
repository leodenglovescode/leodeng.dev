// Vite development middleware only. Never import this from src/ or functions/.
import { STACK_PATH, validateStack } from '../lib/stack-validation.js'
import { GALLERY_PATH, validateGalleryManifest } from '../lib/gallery-validation.js'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { createR2MediaStore } from './lib/admin-media.js'
import { EnvHttpProxyAgent, fetch as nodeFetch } from 'undici'
import { createShelfCatalogSearch, searchShelfCatalog } from '../lib/shelf-search.js'

const REPO = 'local/workspace'
const CONTENT = new Set([GALLERY_PATH, 'src/content/now.json', 'src/content/projects.json', 'src/content/shelf.json', STACK_PATH])
const POST = /^src\/(posts|drafts)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/
const MEDIA = /^[a-z0-9][a-z0-9._-]{0,127}$/

const fail = (status, message) => Object.assign(new Error(message), { status })
const sha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)) }

export async function createLocalAdminMiddleware(projectRoot, { media = createR2MediaStore(), catalogSearch = searchShelfCatalog } = {}) {
  const root = await realpath(projectRoot)
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  let interfaces = {}
  try { interfaces = networkInterfaces() } catch { /* Restricted environments stay loopback-only. */ }
  for (const addresses of Object.values(interfaces)) {
    for (const { address } of addresses || []) hosts.add(address.includes(':') ? `[${address}]` : address)
  }
  const pending = new Map()
  async function serial(key, action) {
    const previous = pending.get(key) || Promise.resolve()
    const task = previous.catch(() => {}).then(action)
    pending.set(key, task)
    try { return await task } finally { if (pending.get(key) === task) pending.delete(key) }
  }
  async function safeFile(target) {
    // All callers first match an exact allowlist. Reject symlinks too, including
    // directory symlinks, so the file API cannot escape the workspace.
    let file = root
    for (const part of target.split('/')) {
      file = path.join(file, part)
      const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (info?.isSymbolicLink()) throw fail(403, 'Symlink paths are not allowed.')
    }
    return file
  }
  async function optionalRead(file) {
    try { return await readFile(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function body(req, limit) {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw fail(413, 'File is too large.')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  async function atomicWrite(file, bytes) {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.tmp-${randomUUID()}`
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, file) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  function segments(url, prefix) {
    const raw = url.pathname.slice(prefix.length).split('/')
    const parts = raw.map(decodeURIComponent)
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\0]/.test(part))) throw fail(400, 'Malformed path.')
    return parts.join('/')
  }
  return async (req, res, next) => {
    const rawPath = (req.url || '').split('?')[0]
    const handled = /^\/api\/(me|auth|callback|logout|gh|media|shelf-search)(\/|$)/.test(rawPath)
    if (!handled) return next()
    try {
      const origin = `http://${req.headers.host}`
      const url = new URL(req.url, origin)
      if (!hosts.has(url.hostname) || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Local admin requires a same-origin request to this computer.')
      if (['/api/auth', '/api/callback'].includes(url.pathname) && req.method === 'GET') {
        res.writeHead(302, { Location: '/admin', 'Cache-Control': 'no-store' }); return res.end()
      }
      // Requiring a non-simple header on reads as well as writes also prevents
      // cross-origin forms/fetches from using the automatic local session.
      if (req.headers['x-admin'] !== '1') throw fail(403, 'Missing X-Admin header.')
      if (url.pathname === '/api/me' && req.method === 'GET') return json(res, { authenticated: true, local: true, login: 'local', name: 'Local editor', repo: REPO })
      if (url.pathname === '/api/logout' && req.method === 'POST') return json(res, { ok: true })
      if (url.pathname === '/api/shelf-search') {
        if (req.method !== 'GET') throw fail(405, 'Method not allowed.')
        return json(res, await catalogSearch(url.searchParams))
      }
      if (url.pathname === '/api/media' || url.pathname.startsWith('/api/media/')) {
        if (url.pathname === '/api/media' && req.method === 'GET') return json(res, await media.list())
        const key = segments(url, '/api/media/')
        if (!MEDIA.test(key)) throw fail(400, 'Malformed media name.')
        if (req.method === 'PUT') {
          let originalName
          try { originalName = decodeURIComponent(req.headers['x-original-filename'] || key) }
          catch { throw fail(400, 'Invalid original filename.') }
          if (originalName.length > 512 || /[\x00-\x1f\x7f]/.test(originalName)) throw fail(400, 'Invalid original filename.')
          const bytes = await body(req, 95 * 1024 * 1024)
          return json(res, await media.put(key, bytes, req.headers['content-type'] || 'application/octet-stream', originalName), 201)
        }
        if (req.method === 'DELETE') return json(res, await media.delete(key))
        throw fail(405, 'Method not allowed.')
      }
      if (!url.pathname.startsWith('/api/gh/')) throw fail(404, 'Local endpoint not found.')
      const ghPath = segments(url, '/api/gh/')
      const prefix = `repos/${REPO}/contents/`
      if (!ghPath.startsWith(prefix)) throw fail(403, 'Repository path not allowed.')
      const target = ghPath.slice(prefix.length)
      const directory = ['src/posts', 'src/drafts'].includes(target)
      if (!directory && !POST.test(target) && !CONTENT.has(target)) throw fail(403, 'Content path not allowed.')
      const file = await safeFile(target)
      if (req.method === 'GET') {
        if (directory) {
          const names = await readdir(file).catch(error => { if (error.code === 'ENOENT') return []; throw error })
          const files = []
          for (const name of names.filter(name => POST.test(`${target}/${name}`)).sort()) {
            const source = await safeFile(`${target}/${name}`)
            const info = await lstat(source)
            if (info.isFile()) files.push({ name, path: `${target}/${name}`, type: 'file', sha: sha(await readFile(source)) })
          }
          return json(res, files)
        }
        const bytes = await optionalRead(file)
        if (!bytes) throw fail(404, 'File not found.')
        return json(res, { name: path.basename(file), path: target, content: bytes.toString('base64'), encoding: 'base64', sha: sha(bytes) })
      }
      if (directory || !['PUT', 'DELETE'].includes(req.method)) throw fail(405, 'Method not allowed.')
      let data
      try { data = JSON.parse((await body(req, 4 * 1024 * 1024)).toString('utf8')) } catch (error) { if (error.status) throw error; throw fail(400, 'Invalid JSON.') }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Expected a JSON object.')
      if (req.method === 'PUT' && (typeof data?.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.content))) throw fail(400, 'Invalid base64 content.')
      return await serial(file, async () => {
        const current = await optionalRead(file)
        if (current ? data.sha !== sha(current) : !!data.sha) throw fail(409, 'The local file changed. Reload before saving.')
        if (target === GALLERY_PATH && req.method === 'DELETE') throw fail(405, 'The gallery manifest cannot be deleted.')
        if (target === STACK_PATH && req.method === 'DELETE') throw fail(405, 'The stack file cannot be deleted.')
        if (req.method === 'DELETE') {
          if (!current) throw fail(404, 'File not found.')
          await unlink(file)
          return json(res, { content: null })
        }
        const bytes = Buffer.from(data.content, 'base64')
        if (CONTENT.has(target)) {
          try { JSON.parse(bytes.toString('utf8')) } catch { throw fail(400, 'Content files must contain valid JSON.') }
        }
        if (target === GALLERY_PATH) {
          try { validateGalleryManifest(JSON.parse(bytes.toString('utf8'))) } catch (error) { throw fail(400, error.message) }
        }
        if (target === STACK_PATH) {
          try { validateStack(JSON.parse(bytes.toString('utf8'))) } catch (error) { throw fail(400, error.message) }
        }
        await atomicWrite(file, bytes)
        return json(res, { content: { path: target, sha: sha(bytes) } }, current ? 200 : 201)
      })
    } catch (error) {
      json(res, { error: error.status ? error.message : 'Local admin could not access the file.' }, error.status || 500)
    }
  }
}

export function localAdminPlugin() {
  return {
    name: 'local-admin',
    apply: 'serve',
    async configureServer(server) {
      // Honor the machine's proxy settings for public catalog lookups. This is
      // Node-only; production Pages uses its native fetch without this adapter.
      const dispatcher = new EnvHttpProxyAgent()
      const catalogSearch = createShelfCatalogSearch((url, init) => nodeFetch(url, { ...init, dispatcher }))
      server.httpServer?.once('close', () => { void dispatcher.close() })
      server.middlewares.use(await createLocalAdminMiddleware(server.config.root, { catalogSearch }))
    },
  }
}
