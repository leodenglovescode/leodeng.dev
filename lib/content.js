import { parseFrontmatter } from './markdown.js'
import { validateShelfItem } from '../src/utils/shelf.js'
export const SHELF_PATH = 'src/content/shelf.json'
export const POST_PATH = /^src\/(posts|drafts)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,199})\.md$/
export const contentPath = path => typeof path === 'string' && (path === SHELF_PATH || POST_PATH.test(path))
export const contentError = (status, message) => Object.assign(new Error(message), {status})
export function validateContent(path, raw) {
  if (!contentPath(path) || typeof raw !== 'string' || new TextEncoder().encode(raw).length > 500000) throw contentError(400, 'Invalid content.')
  if (path === SHELF_PATH) {
    let data
    try { data = JSON.parse(raw) } catch { throw contentError(400,'Invalid shelf JSON.') }
    if (!Array.isArray(data.items) || data.items.length > 5000) throw contentError(400,'Invalid shelf entries.')
    const ids = new Set()
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw contentError(400,'Shelf IDs must be unique.')
      ids.add(item.id)
      const issue = validateShelfItem(item)
      if (issue) throw contentError(400,issue)
    }
  } else {
    const {meta, content} = parseFrontmatter(raw)
    if (!meta.title?.trim()) throw contentError(400,'A title is required.')
    if (path.startsWith('src/posts/') && (!meta.date || !Number.isFinite(Date.parse(meta.date)) || !content.trim())) throw contentError(400,'Published posts need a date and body.')
  }
}
export const CONTENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS site_content (path TEXT PRIMARY KEY, raw TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS site_content_revisions (revision TEXT PRIMARY KEY, path TEXT NOT NULL, raw TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS site_content_revision_path ON site_content_revisions(path,updated_at)`,
  `CREATE TABLE IF NOT EXISTS site_content_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
]
export function contentDatabase(env) {
  if (!env.HOMELAB_DB) throw contentError(503,'Content database is not configured.')
  return env.HOMELAB_DB
}
export async function requireContentReady(env) {
  const db = contentDatabase(env)
  const ready = await db.prepare("SELECT value FROM site_content_meta WHERE key='ready'").first()
  if (ready?.value !== '1') throw contentError(503,'Content migration has not completed.')
  return db
}
export async function readContent(db, path) {
  return db.prepare('SELECT path,raw,revision,updated_at FROM site_content WHERE path=? AND deleted=0').bind(path).first()
}
export async function listContent(db, directory) {
  return (await db.prepare('SELECT path,raw,revision,updated_at FROM site_content WHERE deleted=0 AND path LIKE ? ORDER BY path').bind(directory+'/%').all()).results
}
export async function writeContent(db, {path,raw,sha,originalPath=path,remove=false}) {
  if (!contentPath(path) || !contentPath(originalPath) || (originalPath !== path && (!POST_PATH.test(originalPath) || !POST_PATH.test(path)))) throw contentError(400,'Invalid content path.')
  if (!remove) validateContent(path,raw)
  const revision = crypto.randomUUID(), now = new Date().toISOString()
  let mutation
  if (sha) {
    mutation = db.prepare('UPDATE site_content SET path=?, raw=CASE WHEN ?=1 THEN raw ELSE ? END, revision=?, updated_at=?, deleted=? WHERE path=? AND revision=? AND deleted=0').bind(path,remove?1:0,raw||'',revision,now,remove?1:0,originalPath,sha)
  } else {
    if (remove || originalPath !== path) throw contentError(409,'Reload the entry before changing it.')
    mutation = db.prepare('INSERT INTO site_content(path,raw,revision,updated_at,deleted) VALUES(?,?,?,?,0) ON CONFLICT(path) DO UPDATE SET raw=excluded.raw,revision=excluded.revision,updated_at=excluded.updated_at,deleted=0 WHERE site_content.deleted=1').bind(path,raw,revision,now)
  }
  let results
  try {
    results = await db.batch([mutation,db.prepare('INSERT INTO site_content_revisions(revision,path,raw,updated_at,deleted) SELECT revision,path,raw,updated_at,deleted FROM site_content WHERE revision=?').bind(revision)])
  } catch (error) {
    if (/UNIQUE constraint/.test(error.message)) throw contentError(409,'That destination already exists. Reload before saving.')
    throw error
  }
  if (!results[0].meta.changes) throw contentError(409,'This entry changed since you opened it. Reload before saving.')
  return {content:{sha:revision,path}}
}
export async function exportContent(db) {
  const [current, history] = await db.batch([db.prepare('SELECT path,raw,revision,updated_at,deleted FROM site_content ORDER BY path'), db.prepare('SELECT revision,path,raw,updated_at,deleted FROM site_content_revisions ORDER BY updated_at,revision')])
  const files = current.results, revisions = history.results
  return {version:1,exportedAt:new Date().toISOString(),files,revisions}
}
