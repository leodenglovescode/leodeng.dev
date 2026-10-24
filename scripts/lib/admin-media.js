// Server-only R2 adapter for the Vite admin. Uses the same credentials as the
// photo uploader; no browser tokens, local media files, or GitHub media writes.
import { deleteObject, listObjects, loadCredentials, originalObjectName, putObject } from './r2.js'

const SAFE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/
export function createR2MediaStore(env = process.env) {
  const bucket = env.R2_BUCKET || 'leodeng-media'
  const base = (env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
  const names = new Map()
  function credentials() {
    try { return loadCredentials(env) }
    catch { throw Object.assign(new Error('R2 media needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .dev.vars. Use an Object Read & Write token scoped to the media bucket.'), { status: 503 }) }
  }
  return {
    async list() {
      const creds = credentials()
      const objects = await listObjects(creds, bucket)
      const flat = objects.filter(object => SAFE_KEY.test(object.key))
      // Bound concurrent metadata reads because S3 listings omit custom metadata.
      let index = 0
      await Promise.all(Array.from({ length: Math.min(8, flat.length) }, async () => {
        while (index < flat.length) {
          const object = flat[index++]
          const cached = names.get(object.key)
          object.originalName = cached?.uploaded === object.uploaded ? cached.name : await originalObjectName(creds, bucket, object.key)
          names.set(object.key, { uploaded: object.uploaded, name: object.originalName })
        }
      }))
      const present = new Set(flat.map(object => object.key))
      for (const key of names.keys()) if (!present.has(key)) names.delete(key)
      return { base, files: flat.map(object => ({
        name: object.key, originalName: object.originalName, size: object.size, uploaded: object.uploaded, url: `${base}/${object.key}`,
      })).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded) || a.name.localeCompare(b.name)) }
    },
    async put(key, bytes, contentType, originalName = key) {
      await putObject(credentials(), bucket, key, bytes, { contentType, preventOverwrite: true, originalName })
      return { name: key, originalName, size: bytes.length, uploaded: new Date().toISOString(), url: `${base}/${key}` }
    },
    async delete(key) { await deleteObject(credentials(), bucket, key); names.delete(key); return { deleted: key } },
  }
}
