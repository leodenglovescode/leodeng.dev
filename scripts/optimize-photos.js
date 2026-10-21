#!/usr/bin/env node
// Turns the originals in src/photos/<collection>/ into a thumbnail and a
// compressed lightbox copy each, uploads those to R2, and writes the manifest
// the site actually reads.
//
// The originals are NOT in the repo — src/photos is gitignored and usually
// absent entirely. They were 121MB of frames no visitor ever received (the
// browser only ever gets the derivatives), sitting in a public repo behind a
// Download ZIP button. They're archived outside this project.
//
// So the manifest at src/generated/photos.json — not src/photos — is the record
// of what's in the gallery, and it's merged rather than rebuilt. Derivatives
// live in R2 and stay valid whether or not their original is on this disk.
// With no src/photos at all, this is a no-op, which is what Cloudflare hits on
// every deploy.
//
// Travel imports: src/photos/travel-import/<category>/ maps to a named gallery.
// GPano metadata or Pixel filenames preserve panorama/sphere originals byte for
// byte; only their separate grid previews are resized. Originals are never edited.
// Successful-upload receipts under _generated prevent repeat uploads on builds.
//
// Adding photos: drop the new files in src/photos/<collection>/ and run it.
// You do NOT need the rest of the collection present — the manifest is merged,
// not rebuilt, so existing entries survive an empty or partial folder.
//
//   npm run generate                   process + upload whatever is on disk
//   npm run generate -- --prune        also drop manifest entries with no local
//                                      original (needs the full collection)
//   npm run generate -- --upload-all   re-upload every derivative (resync)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import exifr from 'exifr'
import { loadCredentials, putObject } from './lib/r2.js'
import { readPanorama } from './lib/panorama.js'
import { photoDetailsFromExif } from './lib/photo-exif.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PHOTOS_ROOT = path.join(__dirname, '../src/photos')
const MANIFEST_PATH = path.join(__dirname, '../src/generated/photos.json')
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const BUCKET = process.env.R2_BUCKET || 'leodeng-media'
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
const KEY_PREFIX = 'photos'

const UPLOAD_ALL = process.argv.includes('--upload-all')
const PRUNE = process.argv.includes('--prune')
// Signed PUTs are cheap, so this is just about not opening 150 sockets at once.
const UPLOAD_CONCURRENCY = 8

const THUMB_MAX = 640 // grid cell, ~2x a 320px column
const FULL_MAX = 2200 // lightbox long edge
const FULL_TARGET_BYTES = 1024 * 1024 // <1MB

function isStale(srcPath, outPath) {
  if (!fs.existsSync(outPath)) return true
  return fs.statSync(srcPath).mtimeMs > fs.statSync(outPath).mtimeMs
}

async function makeThumb(srcPath, outPath) {
  await sharp(srcPath)
    .rotate() // apply EXIF orientation, then strip it
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(outPath)
}

async function makeFull(srcPath, outPath) {
  let buffer
  for (let quality = 82; quality >= 40; quality -= 6) {
    buffer = await sharp(srcPath)
      .rotate()
      .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()
    if (buffer.length <= FULL_TARGET_BYTES) break
  }
  fs.writeFileSync(outPath, buffer)
}

// The shot data behind /spotting. Read with reviveValues:false so
// DateTimeOriginal stays the raw "2025:10:18 10:43:39" wall clock — exifr's
// revived Date would be interpreted in the build machine's timezone, and a CI
// box running UTC would shift every hour-of-day bucket by eight.
const EXIF_FIELDS = [
  'DateTimeOriginal', 'Make', 'Model', 'LensModel',
  'FocalLength', 'FNumber', 'ISO', 'ExposureTime',
  'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef',
]

function wallClockFromName(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null
}

async function readExif(collectionDir, file) {
  const name = path.parse(file).name
  let tags = {}
  try {
    tags = await exifr.parse(path.join(collectionDir, file), {
      tiff: true, exif: true, gps: true, pick: EXIF_FIELDS, reviveValues: false,
    }) ?? {}
  } catch {
    // A photo with unreadable EXIF still counts as a frame; it just
    // contributes nothing to the gear or exposure breakdowns.
  }

  // The filename is the more trustworthy clock of the two: photos are named
  // by scripts/rename-photos.js from the original capture time, and the name
  // survives re-exports that rewrite EXIF.
  return {
    name,
    // Null rather than dropped, unlike the old per-collection exif.json: the
    // gallery needs every photo listed, and /spotting already skips frames it
    // can't date.
    shotAt: wallClockFromName(name) ?? tags.DateTimeOriginal ?? null,
    ...photoDetailsFromExif(tags),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retried because a signed PUT can still lose to a flaky network; the earlier
// wrangler-based version needed this far more often.
async function uploadOne(creds, localPath, key, contentType, attempts = 4) {
  const body = fs.readFileSync(localPath)
  for (let attempt = 1; ; attempt += 1) {
    try {
      await putObject(creds, BUCKET, key, body, { contentType })
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      await sleep(500 * 2 ** (attempt - 1))
    }
  }
}

async function uploadAll(jobs) {
  if (!jobs.length) {
    console.log('  nothing to upload')
    return
  }
  const creds = loadCredentials()
  console.log(`  uploading ${jobs.length} file${jobs.length === 1 ? '' : 's'} to r2://${BUCKET}…`)

  let done = 0
  let failed = 0
  const queue = [...jobs]

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const job = queue.shift()
        try {
          await uploadOne(creds, job.localPath, job.key, job.contentType)
          done += 1
          if (done % 20 === 0) console.log(`    ${done}/${jobs.length}…`)
        } catch (err) {
          failed += 1
          console.warn(`    ✗ ${job.key}: ${err.message.split('\n')[0]}`)
        }
      }
    }),
  )

  console.log(`  uploaded ${done}/${jobs.length}${failed ? ` (${failed} failed)` : ''}`)
  if (failed) throw new Error(`${failed} upload(s) failed — manifest not written`)
}

async function processCollection(collectionDir, { label = path.basename(collectionDir), title, preserve = false } = {}) {
  const thumbsDir = path.join(collectionDir, '_generated/thumbs')
  const fullDir = path.join(collectionDir, '_generated/full')
  const receiptPath = path.join(collectionDir, '_generated/uploaded.json')
  fs.mkdirSync(thumbsDir, { recursive: true })
  fs.mkdirSync(fullDir, { recursive: true })
  const receipts = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : {}
  const files = fs.readdirSync(collectionDir, { withFileTypes: true })
    .filter(f => f.isFile() && EXTENSIONS.has(path.extname(f.name).toLowerCase()))
    .map(f => f.name).sort()
  const uploads = []
  const entries = []
  const names = new Set()
  function enqueue(localPath, key, contentType) {
    const stat = fs.statSync(localPath)
    const stamp = `${stat.size}:${stat.mtimeMs}`
    if (UPLOAD_ALL || receipts[key] !== stamp) uploads.push({ localPath, key, contentType, stamp })
  }
  for (const file of files) {
    const srcPath = path.join(collectionDir, file)
    const base = path.parse(file).name
    if (names.has(base)) throw new Error(`Duplicate photo name in ${label}: ${base}`)
    names.add(base)
    const meta = await sharp(srcPath).metadata()
    const special = readPanorama(fs.readFileSync(srcPath), file, meta.width, meta.height, preserve)
    const thumbPath = path.join(thumbsDir, `${base}.webp`)
    const fullPath = path.join(fullDir, `${base}.webp`)
    // Separate grid previews never replace or re-encode a special image's original.
    if (isStale(srcPath, thumbPath)) await makeThumb(srcPath, thumbPath)
    enqueue(thumbPath, `${KEY_PREFIX}/${label}/thumbs/${base}.webp`, 'image/webp')
    if (special) {
      enqueue(srcPath, `${KEY_PREFIX}/${label}/originals/${file}`, meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`)
    } else {
      if (isStale(srcPath, fullPath)) await makeFull(srcPath, fullPath)
      enqueue(fullPath, `${KEY_PREFIX}/${label}/full/${base}.webp`, 'image/webp')
    }
    const entry = await readExif(collectionDir, file)
    entries.push({ ...entry, width: meta.width, height: meta.height,
      ...(special ? { ...special, original: file } : {}) })
    console.log(`✓ ${label}/${file}: ${special ? `${special.kind}, original preserved` : `${Math.round(fs.statSync(fullPath).size / 1024)} KB`}`)
  }
  console.log(`  indexed ${entries.length} ${label} photos`)
  return { label, title, entries, uploads, receiptPath, receipts }
}

async function main() {
  if (!fs.existsSync(PHOTOS_ROOT)) {
    // The build machine has no originals. The committed manifest is already
    // correct there, so touching it would only blank the gallery.
    console.log('No src/photos directory — keeping the existing photo manifest.')
    return
  }

  const collectionDirs = fs.readdirSync(PHOTOS_ROOT, { withFileTypes: true })
    .filter(f => f.isDirectory() && !f.name.startsWith('_') && f.name !== 'travel-import')
    .map(f => path.join(PHOTOS_ROOT, f.name))

  const importRoot = path.join(PHOTOS_ROOT, 'travel-import')
  const imports = fs.existsSync(importRoot) ? fs.readdirSync(importRoot, { withFileTypes: true })
    .filter(f => f.isDirectory() && !f.name.startsWith('_'))
    .map(f => ({ dir: path.join(importRoot, f.name), title: f.name,
      label: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      preserve: /panorama|photosphere/i.test(f.name) })) : []
  const labels = [...collectionDirs.map(d => path.basename(d)), ...imports.map(i => i.label)]
  if (new Set(labels).size !== labels.length || labels.some(l => !l)) throw new Error('Duplicate or empty collection slug')
  if (!collectionDirs.length && !imports.length) {
    console.log('No photo collections found in src/photos — keeping the existing manifest.')
    return
  }

  const results = []
  for (const dir of collectionDirs) results.push(await processCollection(dir))

  for (const { dir, ...options } of imports) results.push(await processCollection(dir, options))

  await uploadAll(results.flatMap(r => r.uploads))
  // Save receipts only after successful uploads, so interrupted runs retry safely.
  for (const result of results) {
    for (const job of result.uploads) result.receipts[job.key] = job.stamp
    fs.writeFileSync(result.receiptPath, JSON.stringify(result.receipts))
  }

  // Merged into the existing manifest rather than replacing it. The derivatives
  // live in R2 and stay there whether or not the original is still on this
  // disk, so the manifest — not src/photos — is the record of what's in the
  // gallery. That means you can drop in five new photos and run this without
  // first restoring the other sixty-eight.
  //
  // The flip side: a photo can't leave the gallery by deleting its original,
  // because "absent" and "not restored yet" look identical. Removing one is
  // deliberate — --prune, with the collection fully present.
  const previousManifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {}
  const previous = previousManifest.collections ?? {}

  const collections = { ...previous }
  for (const { label, entries } of results) {
    const byName = new Map((previous[label] ?? []).map(e => [e.name, e]))
    for (const entry of entries) byName.set(entry.name, { ...byName.get(entry.name), ...entry }) // fresh EXIF wins

    // Admin removals stay removed even when their local originals are present.
    for (const name of previousManifest.excluded?.[label] ?? []) byName.delete(name)

    if (PRUNE) {
      const onDisk = new Set(entries.map(e => e.name))
      for (const name of [...byName.keys()]) if (!onDisk.has(name)) byName.delete(name)
    }

    collections[label] = [...byName.values()].sort((a, b) => String(b.name).localeCompare(String(a.name)))
  }

  const titles = { ...previousManifest.titles }
  for (const result of results) if (result.title) titles[result.label] = result.title
  const manifest = { base: PUBLIC_BASE, prefix: KEY_PREFIX, titles, collections,
    ...(previousManifest.excluded ? { excluded: previousManifest.excluded } : {}) }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`)

  const total = Object.values(collections).reduce((n, e) => n + e.length, 0)
  const added = total - Object.values(previous).reduce((n, e) => n + e.length, 0)
  const delta = added > 0 ? ` (+${added})` : added < 0 ? ` (${added}, pruned)` : ''
  const names = Object.keys(collections).length
  console.log(`  wrote manifest: ${total} photo${total === 1 ? '' : 's'}${delta} across ${names} collection${names === 1 ? '' : 's'}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
