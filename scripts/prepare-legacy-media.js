// Build JPEG alternatives for WebP-only assets. Only the URL map is committed;
// image bytes go to R2, just like the existing photo derivative pipeline.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parse } from 'parse5'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import { loadCredentials, putObject } from './lib/r2.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = path.join(root, 'src/generated/legacy-media.json')
const media = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({ version: 1, images: {} }))
const photos = JSON.parse(await fs.readFile(path.join(root, 'src/generated/photos.json'), 'utf8'))
const routes = JSON.parse(await fs.readFile(path.join(root, 'dist/_site-routes.json'), 'utf8'))
const sources = new Set()
for (const [collection, entries] of Object.entries(photos.collections)) for (const { name } of entries) {
  for (const variant of ['thumbs', 'full']) sources.add(`${photos.base}/${photos.prefix}/${collection}/${variant}/${encodeURIComponent(name)}.webp`)
}
function scan(node) {
  if (node.tagName === 'img') {
    const source = node.attrs.find(attribute => attribute.name === 'src')?.value
    if (source && /\.webp(?:[?#]|$)/i.test(source)) sources.add(source)
  }
  for (const child of node.childNodes || []) scan(child)
}
for (const route of routes) {
  const filename = route.path === '/' ? 'index.html' : `${route.path.slice(1)}.html`
  scan(parse(await fs.readFile(path.join(root, 'dist', filename), 'utf8')))
}
const pending = [...sources].filter(source => process.argv.includes('--refresh') || !media.images[source])
if (!pending.length) { console.log('Legacy JPEG alternatives are up to date.'); process.exit(0) }
const credentials = loadCredentials()
const dispatcher = new EnvHttpProxyAgent()
setGlobalDispatcher(dispatcher)
let completed = 0
const errors = []
const publicBase = (process.env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
async function convert(source) {
  let bytes
  if (source.startsWith('/') && !source.startsWith('//')) {
    const filename = path.resolve(root, 'public', `.${decodeURIComponent(source)}`)
    if (!filename.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Invalid local media path.')
    bytes = await fs.readFile(filename)
  } else {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.hostname !== 'media.leodeng.dev') throw new Error('Legacy conversion only reads the configured media host.')
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0 leodeng-legacy-build' } })
    if (!response.ok) throw new Error(`Media fetch returned HTTP ${response.status}.`)
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 10 * 1024 * 1024) throw new Error('Media exceeds conversion limit.')
      chunks.push(chunk)
    }
    bytes = Buffer.concat(chunks)
  }
  const jpeg = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
  const key = `legacy/images/${crypto.createHash('sha256').update(jpeg).digest('hex')}.jpg`
  await putObject(credentials, process.env.R2_BUCKET || 'leodeng-media', key, jpeg, { contentType: 'image/jpeg' })
  media.images[source] = `${publicBase}/${key}`
  completed++
  if (completed % 20 === 0 || completed === pending.length) console.log(`Prepared ${completed}/${pending.length} JPEG alternatives.`)
}
try {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
    while (next < pending.length) {
      const source = pending[next++]
      try { await convert(source) } catch (error) { errors.push({ source, message: error.message }) }
    }
  }))
  media.images = Object.fromEntries(Object.entries(media.images).sort(([a], [b]) => a.localeCompare(b)))
  await fs.writeFile(manifestPath, JSON.stringify(media, null, 2) + '\n')
  if (errors.length) {
    console.error(`${errors.length} conversions failed. First error: ${errors[0].message}`)
    process.exitCode = 1
  }
} finally { await dispatcher.close() }
