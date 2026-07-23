#!/usr/bin/env node
// Generates a thumbnail and a compressed lightbox copy of every photo in
// src/photos/planespotting, so the gallery never ships full-resolution
// originals (some of which are several MB) to the browser.
// Runs automatically before `dev` and `build` (see package.json pre* scripts).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = path.join(__dirname, '../src/photos/planespotting')
const THUMBS_DIR = path.join(SOURCE_DIR, '_generated/thumbs')
const FULL_DIR = path.join(SOURCE_DIR, '_generated/full')
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

async function main() {
  fs.mkdirSync(THUMBS_DIR, { recursive: true })
  fs.mkdirSync(FULL_DIR, { recursive: true })

  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => EXTENSIONS.has(path.extname(f).toLowerCase()))

  if (!files.length) {
    console.log('No source photos found in src/photos/planespotting.')
  }

  for (const file of files) {
    const srcPath = path.join(SOURCE_DIR, file)
    const base = path.parse(file).name
    const thumbPath = path.join(THUMBS_DIR, `${base}.webp`)
    const fullPath = path.join(FULL_DIR, `${base}.webp`)

    const thumbStale = isStale(srcPath, thumbPath)
    const fullStale = isStale(srcPath, fullPath)
    if (!thumbStale && !fullStale) continue

    try {
      if (thumbStale) await makeThumb(srcPath, thumbPath)
      if (fullStale) await makeFull(srcPath, fullPath)
      const kb = (fs.statSync(fullPath).size / 1024).toFixed(0)
      console.log(`✓ ${file} -> thumb + full (${kb} KB)`)
    } catch (err) {
      console.warn(`✗ ${file}: ${err.message}`)
    }
  }

  // prune derivatives whose source photo was renamed or deleted
  const validBases = new Set(files.map(f => path.parse(f).name))
  for (const dir of [THUMBS_DIR, FULL_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      if (!validBases.has(path.parse(f).name)) {
        fs.unlinkSync(path.join(dir, f))
        console.log(`  removed orphaned ${path.relative(SOURCE_DIR, path.join(dir, f))}`)
      }
    }
  }
}

main()
