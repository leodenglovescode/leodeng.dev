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
  'DateTimeOriginal', 'Model', 'LensModel',
  'FocalLength', 'FNumber', 'ISO', 'ExposureTime',
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
      tiff: true, exif: true, pick: EXIF_FIELDS, reviveValues: false,
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
    camera: tags.Model ?? null,
    lens: tags.LensModel ?? null,
    focalLength: typeof tags.FocalLength === 'number' ? tags.FocalLength : null,
    aperture: typeof tags.FNumber === 'number' ? tags.FNumber : null,
    iso: typeof tags.ISO === 'number' ? tags.ISO : null,
    shutter: typeof tags.ExposureTime === 'number' ? tags.ExposureTime : null,
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

async function processCollection(collectionDir) {
  const label = path.basename(collectionDir)
  const thumbsDir = path.join(collectionDir, '_generated/thumbs')
  const fullDir = path.join(collectionDir, '_generated/full')
  fs.mkdirSync(thumbsDir, { recursive: true })
  fs.mkdirSync(fullDir, { recursive: true })

  const files = fs.readdirSync(collectionDir, { withFileTypes: true })
    .filter(f => f.isFile() && EXTENSIONS.has(path.extname(f.name).toLowerCase()))
    .map(f => f.name)

  const uploads = []

  for (const file of files) {
    const srcPath = path.join(collectionDir, file)
    const base = path.parse(file).name
    const thumbPath = path.join(thumbsDir, `${base}.webp`)
    const fullPath = path.join(fullDir, `${base}.webp`)

    const thumbStale = isStale(srcPath, thumbPath)
    const fullStale = isStale(srcPath, fullPath)

    if (thumbStale || fullStale) {
      try {
        if (thumbStale) await makeThumb(srcPath, thumbPath)
        if (fullStale) await makeFull(srcPath, fullPath)
        const kb = (fs.statSync(fullPath).size / 1024).toFixed(0)
        console.log(`✓ ${label}/${file} -> thumb + full (${kb} KB)`)
      } catch (err) {
        console.warn(`✗ ${label}/${file}: ${err.message}`)
        continue
      }
    }

    // Anything regenerated this run is out of date in the bucket. --upload-all
    // re-sends everything, which is what the initial migration needs.
    if (UPLOAD_ALL || thumbStale) {
      uploads.push({ localPath: thumbPath, key: `${KEY_PREFIX}/${label}/thumbs/${base}.webp`, contentType: 'image/webp' })
    }
    if (UPLOAD_ALL || fullStale) {
      uploads.push({ localPath: fullPath, key: `${KEY_PREFIX}/${label}/full/${base}.webp`, contentType: 'image/webp' })
    }
  }

  const entries = []
  for (const file of files) entries.push(await readExif(collectionDir, file))
  entries.sort((a, b) => String(b.name).localeCompare(String(a.name))) // newest first

  const dated = entries.filter(e => e.shotAt).length
  console.log(`  indexed EXIF for ${dated}/${files.length} ${label} photo${files.length === 1 ? '' : 's'}`)

  // Prune derivatives whose source photo was renamed or deleted. The bucket
  // copy is left alone deliberately — an orphan there costs a fraction of a
  // cent and is invisible, whereas a delete is unrecoverable.
  const validBases = new Set(files.map(f => path.parse(f).name))
  for (const dir of [thumbsDir, fullDir]) {
    for (const f of fs.readdirSync(dir)) {
      if (!validBases.has(path.parse(f).name)) {
        fs.unlinkSync(path.join(dir, f))
        console.log(`  removed orphaned local ${label}/${path.basename(dir)}/${f}`)
      }
    }
  }

  return { label, entries, uploads }
}

async function main() {
  if (!fs.existsSync(PHOTOS_ROOT)) {
    // The build machine has no originals. The committed manifest is already
    // correct there, so touching it would only blank the gallery.
    console.log('No src/photos directory — keeping the existing photo manifest.')
    return
  }

  const collectionDirs = fs.readdirSync(PHOTOS_ROOT, { withFileTypes: true })
    .filter(f => f.isDirectory() && !f.name.startsWith('_'))
    .map(f => path.join(PHOTOS_ROOT, f.name))

  if (!collectionDirs.length) {
    console.log('No photo collections found in src/photos — keeping the existing manifest.')
    return
  }

  const results = []
  for (const dir of collectionDirs) results.push(await processCollection(dir))

  await uploadAll(results.flatMap(r => r.uploads))

  // Merged into the existing manifest rather than replacing it. The derivatives
  // live in R2 and stay there whether or not the original is still on this
  // disk, so the manifest — not src/photos — is the record of what's in the
  // gallery. That means you can drop in five new photos and run this without
  // first restoring the other sixty-eight.
  //
  // The flip side: a photo can't leave the gallery by deleting its original,
  // because "absent" and "not restored yet" look identical. Removing one is
  // deliberate — --prune, with the collection fully present.
  const previous = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).collections ?? {}
    : {}

  const collections = { ...previous }
  for (const { label, entries } of results) {
    const byName = new Map((previous[label] ?? []).map(e => [e.name, e]))
    for (const entry of entries) byName.set(entry.name, entry) // fresh EXIF wins

    if (PRUNE) {
      const onDisk = new Set(entries.map(e => e.name))
      for (const name of [...byName.keys()]) if (!onDisk.has(name)) byName.delete(name)
    }

    collections[label] = [...byName.values()].sort((a, b) => String(b.name).localeCompare(String(a.name)))
  }

  const manifest = { base: PUBLIC_BASE, prefix: KEY_PREFIX, collections }
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
