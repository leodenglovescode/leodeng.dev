#!/usr/bin/env node
// Renames photos in each src/photos/<collection>/ folder to a sortable
// date-based filename. Date source, in priority order: EXIF capture date ->
// file mtime -> file atime.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import exifr from 'exifr'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PHOTOS_ROOT = path.join(__dirname, '../src/photos')
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const NAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/
// Defaults to a dry run. `npm run photos:rename --dry-run` looks like it would
// pass `--dry-run` through, but npm silently swallows flags unless you write
// `npm run photos:rename -- --dry-run` — so requiring an explicit --apply to
// do anything destructive is the only way this can't misfire.
const apply = process.argv.includes('--apply')
const dryRun = !apply

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

async function getDate(filePath) {
  try {
    const exif = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] })
    const exifDate = exif?.DateTimeOriginal ?? exif?.CreateDate
    if (exifDate instanceof Date && !isNaN(exifDate)) return { date: exifDate, source: 'exif' }
  } catch {
    // unreadable or no EXIF block — fall through to filesystem timestamps
  }

  const stat = fs.statSync(filePath)
  if (stat.mtime && !isNaN(stat.mtime) && stat.mtime.getTime() > 0) {
    return { date: stat.mtime, source: 'mtime' }
  }
  return { date: stat.atime, source: 'atime' }
}

async function renameCollection(collectionDir) {
  const label = path.basename(collectionDir)
  const files = fs.readdirSync(collectionDir, { withFileTypes: true })
    .filter(f => f.isFile() && EXTENSIONS.has(path.extname(f.name).toLowerCase()))
    .map(f => f.name)

  if (!files.length) return

  const usedNames = new Set(files)

  for (const file of files) {
    if (NAMED_PATTERN.test(path.parse(file).name)) {
      console.log(`= ${label}/${file} (already named, skipped)`)
      continue
    }

    const filePath = path.join(collectionDir, file)
    const ext = path.extname(file).toLowerCase()
    const { date, source } = await getDate(filePath)

    const base = formatDate(date)
    let newName = `${base}${ext}`
    let suffix = 1
    while (usedNames.has(newName)) {
      suffix += 1
      newName = `${base}-${suffix}${ext}`
    }

    usedNames.delete(file)
    usedNames.add(newName)

    console.log(`${dryRun ? '[dry-run] ' : ''}${label}/${file} -> ${newName}  (${source})`)
    if (!dryRun) {
      fs.renameSync(filePath, path.join(collectionDir, newName))
    }
  }
}

async function main() {
  if (!fs.existsSync(PHOTOS_ROOT)) {
    console.error(`Not found: ${PHOTOS_ROOT}`)
    process.exit(1)
  }

  const collectionDirs = fs.readdirSync(PHOTOS_ROOT, { withFileTypes: true })
    .filter(f => f.isDirectory() && !f.name.startsWith('_'))
    .map(f => path.join(PHOTOS_ROOT, f.name))

  if (!collectionDirs.length) {
    console.log('No photo collections found in src/photos.')
    return
  }

  for (const dir of collectionDirs) {
    await renameCollection(dir)
  }

  if (dryRun) {
    console.log('\nDry run only — no files were renamed. Run `npm run photos:rename:apply` to apply.')
  }
}

main()
