#!/usr/bin/env node
// Generates a thumbnail and a compressed lightbox copy of every photo in
// each collection folder under src/photos/<collection>/, so the gallery
// never ships full-resolution originals (some of which are several MB) to
// the browser.
// Runs automatically before `dev` and `build` (see package.json pre* scripts).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import exifr from 'exifr'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PHOTOS_ROOT = path.join(__dirname, '../src/photos')
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

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

async function writeExifIndex(collectionDir, files) {
  const entries = []

  for (const file of files) {
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
    const shotAt = wallClockFromName(name) ?? tags.DateTimeOriginal ?? null
    if (!shotAt) continue

    entries.push({
      name,
      shotAt,
      camera: tags.Model ?? null,
      lens: tags.LensModel ?? null,
      focalLength: typeof tags.FocalLength === 'number' ? tags.FocalLength : null,
      aperture: typeof tags.FNumber === 'number' ? tags.FNumber : null,
      iso: typeof tags.ISO === 'number' ? tags.ISO : null,
      shutter: typeof tags.ExposureTime === 'number' ? tags.ExposureTime : null,
    })
  }

  entries.sort((a, b) => a.shotAt.localeCompare(b.shotAt))
  fs.writeFileSync(
    path.join(collectionDir, '_generated/exif.json'),
    JSON.stringify(entries, null, 1),
  )
  return entries.length
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

  for (const file of files) {
    const srcPath = path.join(collectionDir, file)
    const base = path.parse(file).name
    const thumbPath = path.join(thumbsDir, `${base}.webp`)
    const fullPath = path.join(fullDir, `${base}.webp`)

    const thumbStale = isStale(srcPath, thumbPath)
    const fullStale = isStale(srcPath, fullPath)
    if (!thumbStale && !fullStale) continue

    try {
      if (thumbStale) await makeThumb(srcPath, thumbPath)
      if (fullStale) await makeFull(srcPath, fullPath)
      const kb = (fs.statSync(fullPath).size / 1024).toFixed(0)
      console.log(`✓ ${label}/${file} -> thumb + full (${kb} KB)`)
    } catch (err) {
      console.warn(`✗ ${label}/${file}: ${err.message}`)
    }
  }

  // Rewritten every run rather than only for stale files — it's a full index,
  // so a single deleted photo would otherwise leave a phantom frame behind.
  const indexed = await writeExifIndex(collectionDir, files)
  console.log(`  indexed EXIF for ${indexed}/${files.length} ${label} photo${files.length === 1 ? '' : 's'}`)

  // prune derivatives whose source photo was renamed or deleted
  const validBases = new Set(files.map(f => path.parse(f).name))
  for (const dir of [thumbsDir, fullDir]) {
    for (const f of fs.readdirSync(dir)) {
      if (!validBases.has(path.parse(f).name)) {
        fs.unlinkSync(path.join(dir, f))
        console.log(`  removed orphaned ${label}/${path.relative(collectionDir, path.join(dir, f))}`)
      }
    }
  }
}

async function main() {
  if (!fs.existsSync(PHOTOS_ROOT)) {
    console.log('No src/photos directory found.')
    return
  }

  const collectionDirs = fs.readdirSync(PHOTOS_ROOT, { withFileTypes: true })
    .filter(f => f.isDirectory() && !f.name.startsWith('_'))
    .map(f => path.join(PHOTOS_ROOT, f.name))

  if (!collectionDirs.length) {
    console.log('No photo collections found in src/photos.')
    return
  }

  for (const dir of collectionDirs) {
    await processCollection(dir)
  }
}

main()
