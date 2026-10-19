// Server-only R2 adapter for the Vite admin. Uses the same credentials as the
// photo uploader; no browser tokens, local media files, or GitHub media writes.
import { deleteObject, listObjects, loadCredentials, putObject } from './r2.js'

const SAFE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/
export function createR2MediaStore(env = process.env) {
  const bucket = env.R2_BUCKET || 'leodeng-media'
  const base = (env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
  function credentials() {
    try { return loadCredentials(env) }
    catch { throw Object.assign(new Error('R2 media needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .dev.vars. Use an Object Read & Write token scoped to the media bucket.'), { status: 503 }) }
  }
  return {
    async list() {
      const objects = await listObjects(credentials(), bucket)
      return { base, files: objects.filter(object => SAFE_KEY.test(object.key)).map(object => ({
        name: object.key, size: object.size, uploaded: object.uploaded, url: `${base}/${object.key}`,
      })).sort((a, b) => a.name.localeCompare(b.name)) }
    },
    async put(key, bytes, contentType) {
      await putObject(credentials(), bucket, key, bytes, { contentType, preventOverwrite: true })
      return { name: key, url: `${base}/${key}` }
    },
    async delete(key) { await deleteObject(credentials(), bucket, key); return { deleted: key } },
  }
}
