import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createLocalAdminMiddleware, localAdminPlugin } from '../../scripts/local-admin.js'
import { onRequestGet as productionMe } from '../api/me.js'
import { onRequest as productionContents } from '../api/gh/[[path]].js'
import { onRequest as productionMedia } from '../api/media/[[path]].js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'local-admin-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src/posts'), { recursive: true })
  await mkdir(path.join(root, 'src/content'), { recursive: true })
  const objects = new Map()
  const media = {
    async list() { return { base: 'https://media.leodeng.dev', files: [...objects.keys()].map(name => ({ name, url: `https://media.leodeng.dev/${name}` })) } },
    async put(key, bytes) { objects.set(key, bytes); return { name: key, url: `https://media.leodeng.dev/${key}` } },
    async delete(key) { objects.delete(key); return { deleted: key } },
  }
  const middleware = await createLocalAdminMiddleware(root, { media })
  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    const bytes = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const req = Readable.from([Buffer.from(bytes)])
    Object.assign(req, { url, method, headers: { host: 'localhost:5173', 'x-admin': '1', ...headers } })
    const res = { status: 0, headers: {}, writeHead(status, headers) { this.status = status; this.headers = headers }, end(bytes) { this.bytes = bytes?.toString() || ''; try { this.body = JSON.parse(this.bytes) } catch {} } }
    await middleware(req, res, () => { res.next = true })
    return res
  }
  const file = target => `/api/gh/repos/local/workspace/contents/${target}`
  const content = text => Buffer.from(text).toString('base64')
  return { root, request, file, content, objects }
}

test('local editor reads and saves UTF-8 drafts, publishes locally, and detects stale/concurrent edits', async t => {
  const { root, request, file, content } = await fixture(t)
  assert.equal((await request('/api/me')).body.local, true)
  assert.equal((await request('/api/auth', { headers: { 'x-admin': undefined } })).headers.Location, '/admin')
  const draft = file('src/drafts/a-post.md')
  const text = '# A post\n中文 👋\n'
  const created = await request(draft, { method: 'PUT', body: { content: content(text) } })
  assert.equal(created.status, 201)
  assert.equal(await readFile(path.join(root, 'src/drafts/a-post.md'), 'utf8'), text)
  const read = await request(draft)
  assert.equal(Buffer.from(read.body.content, 'base64').toString(), text)
  assert.equal((await request(file('src/drafts'))).body[0].type, 'file')
  assert.equal((await request(draft, { method: 'PUT', body: { content: content('stale') } })).status, 409)
  const edits = await Promise.all(['one', 'two'].map(text => request(draft, { method: 'PUT', body: { sha: read.body.sha, content: content(text) } })))
  assert.deepEqual(edits.map(result => result.status).sort(), [200, 409])
  const current = (await request(draft)).body
  assert.equal((await request(file('src/posts/a-post.md'), { method: 'PUT', body: { content: current.content } })).status, 201)
  assert.equal((await request(draft, { method: 'DELETE', body: { sha: current.sha } })).status, 200)
  assert.equal((await request(draft)).status, 404)
  assert.equal((await request(file('src/posts/a-post.md'))).status, 200)
  assert.equal((await request(file('src/content/shelf.json'), { method: 'PUT', body: { content: content('{bad') } })).status, 400)
  assert.equal((await request(file('src/content/shelf.json'), { method: 'PUT', body: { content: content('{"items":[]}') } })).status, 201)
})

test('local API rejects foreign hosts/origins, missing headers, traversal, unlisted files and symlinks', async t => {
  const { root, request, file, content } = await fixture(t)
  for (const headers of [{ host: 'attacker.example:5173' }, { origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }, { 'x-admin': undefined }]) {
    assert.equal((await request('/api/me', { headers })).status, 403)
  }
  assert.equal((await request('/api/me', { headers: { origin: 'http://localhost:5173' } })).status, 200)
  for (const target of ['src/style.css', '.dev.vars', 'src/content/secret.json', 'src/posts/evil.js', 'src/posts/nested/no.md']) {
    assert.equal((await request(file(target), { method: 'PUT', body: { content: content('blocked') } })).status, 403)
  }
  assert.equal((await request(file('src/posts/%2e%2e%2fsecret.md'))).status, 400)
  assert.equal((await request(file('src/posts/%00bad.md'))).status, 400)
  await writeFile(path.join(root, 'secret.md'), 'secret')
  await symlink(path.join(root, 'secret.md'), path.join(root, 'src/posts/link.md'))
  assert.equal((await request(file('src/posts/link.md'))).status, 403)
  assert.equal((await request(file('src/posts/link.md'), { method: 'PUT', body: { content: content('blocked') } })).status, 403)
  assert.equal(await readFile(path.join(root, 'secret.md'), 'utf8'), 'secret')
  for (const body of ['{', 'null', '[]', '{"content":"not base64!"}']) {
    assert.equal((await request(file('src/posts/bad.md'), { method: 'PUT', body })).status, 400)
  }
  assert.equal((await request('/api/time')).next, true)
})

test('local media delegates to R2, returns permanent URLs, and never writes media to disk', async t => {
  const { root, request, objects } = await fixture(t)
  assert.equal((await request('/api/media')).body.files.length, 0)
  const uploaded = await request('/api/media/test.png', { method: 'PUT', body: 'image bytes' })
  assert.equal(uploaded.status, 201)
  assert.equal(uploaded.body.url, 'https://media.leodeng.dev/test.png')
  assert.equal(objects.get('test.png').toString(), 'image bytes')
  await assert.rejects(readFile(path.join(root, '.local-admin/media/test.png')), { code: 'ENOENT' })
  assert.equal((await request('/api/media')).body.files.length, 1)
  assert.equal((await request('/api/media/%2e%2e%2fsecret', { method: 'PUT', body: 'no' })).status, 400)
  assert.equal((await request('/api/media/test.png', { method: 'DELETE' })).status, 200)
  assert.equal(objects.size, 0)
})

test('production APIs still require GitHub sessions regardless of local-looking hosts, flags or headers', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Bad credentials' }, { status: 401 }))
  for (const handler of [productionMe, productionContents, productionMedia]) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      for (const cookie of ['', 'local_admin=true', 'gh_session=local']) {
        const request = new Request('http://localhost:5173/api/me?local=true', { method, headers: { 'X-Admin': '1', 'X-Local-Admin': '1', Cookie: cookie } })
        const response = await handler({ request, env: { LOCAL_ADMIN: 'true', NODE_ENV: 'development' }, params: { path: ['repos', 'local', 'workspace', 'contents', 'src', 'posts', 'test.md'] } })
        assert.equal(response.status, 401)
      }
    }
  }
  const plugin = localAdminPlugin()
  assert.equal(plugin.apply, 'serve')
  assert.equal(plugin.configurePreviewServer, undefined)
})
