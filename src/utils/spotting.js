// Shooting stats for /spotting, derived from the EXIF index that
// scripts/optimize-photos.js writes next to the generated thumbnails.
//
// Everything here is computed at module load from data that only exists
// because the photos exist — no hand-maintained counters, so the page can't
// drift away from the gallery.
const exifModules = import.meta.glob('../photos/*/_generated/exif.json', { eager: true, import: 'default' })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2025:10:18 10:43:39" — a wall clock with no timezone attached, which is
// exactly what the hour-of-day and per-month buckets want.
function parseShotAt(raw) {
  const m = String(raw).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, year, month, day, hour, minute, second] = m.map(Number)
  return { year, month, day, hour, minute, second, dayKey: `${m[1]}-${m[2]}-${m[3]}` }
}

function collectionFromPath(p) {
  return p.match(/\/photos\/([^/]+)\/_generated\/exif\.json$/)?.[1] ?? null
}

function loadFrames() {
  const frames = []
  for (const [p, entries] of Object.entries(exifModules)) {
    const collection = collectionFromPath(p)
    if (!collection || !Array.isArray(entries)) continue
    for (const e of entries) {
      const when = parseShotAt(e.shotAt)
      if (!when) continue
      frames.push({ ...e, collection, when })
    }
  }
  return frames.sort((a, b) => a.shotAt.localeCompare(b.shotAt))
}

// Descending tally of a field, skipping frames that don't carry it.
function tally(frames, key, { limit = Infinity } = {}) {
  const counts = new Map()
  for (const f of frames) {
    const v = f[key]
    if (v == null || v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, share: count / frames.length }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    .slice(0, limit)
}

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Canon writes the marketing name; the interesting part is the range.
export function shortLens(model) {
  if (!model) return 'Unknown lens'
  return String(model)
    .replace(/^(RF|EF|EF-S|FE|Z)\s*/i, m => m.trim().toUpperCase() + ' ')
    .replace(/\s+IS\b/g, '')
    .replace(/\s+USM\b/g, '')
    .replace(/\s+L\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatShutter(seconds) {
  if (seconds == null) return '—'
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`
  return `1/${Math.round(1 / seconds)}`
}

export function formatDay(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

// Focal lengths cluster hard around the ends of each zoom, so fixed-width
// buckets would be mostly empty. These edges match how the lenses are used.
const FOCAL_BUCKETS = [
  { label: '≤ 70mm', test: f => f <= 70 },
  { label: '71–120', test: f => f > 70 && f <= 120 },
  { label: '121–199', test: f => f > 120 && f < 200 },
  { label: '200mm', test: f => f === 200 },
  { label: '201–500', test: f => f > 200 && f <= 500 },
  { label: '> 500mm', test: f => f > 500 },
]

function buildStats() {
  const frames = loadFrames()

  if (!frames.length) {
    return { empty: true, frames: [], total: 0 }
  }

  // A "session" is a calendar day with at least one frame — planespotting
  // happens in outings, so days are the unit that actually means something.
  const byDay = new Map()
  for (const f of frames) {
    if (!byDay.has(f.when.dayKey)) byDay.set(f.when.dayKey, [])
    byDay.get(f.when.dayKey).push(f)
  }
  const sessions = [...byDay.entries()]
    .map(([dayKey, fs]) => ({
      dayKey,
      label: formatDay(dayKey),
      count: fs.length,
      // Elapsed time between the first and last frame of the day.
      minutes: Math.round(
        (fs.at(-1).when.hour * 60 + fs.at(-1).when.minute) -
        (fs[0].when.hour * 60 + fs[0].when.minute),
      ),
    }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  for (const f of frames) hours[f.when.hour].count++

  const months = new Map()
  for (const f of frames) {
    const key = `${f.when.year}-${String(f.when.month).padStart(2, '0')}`
    months.set(key, (months.get(key) ?? 0) + 1)
  }
  // Fill the gaps so a quiet month reads as a gap rather than vanishing.
  const monthKeys = [...months.keys()].sort()
  const timeline = []
  if (monthKeys.length) {
    let [y, m] = monthKeys[0].split('-').map(Number)
    const [endY, endM] = monthKeys.at(-1).split('-').map(Number)
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      timeline.push({ key, label: MONTHS[m - 1], year: y, count: months.get(key) ?? 0 })
      if (++m > 12) { m = 1; y++ }
    }
  }

  const focalLengths = frames.map(f => f.focalLength).filter(f => f != null)
  const isos = frames.map(f => f.iso).filter(v => v != null)
  const shutters = frames.map(f => f.shutter).filter(v => v != null)
  const apertures = frames.map(f => f.aperture).filter(v => v != null)

  const focalHistogram = FOCAL_BUCKETS
    .map(b => ({ label: b.label, count: focalLengths.filter(b.test).length }))
    .filter(b => b.count > 0)

  const busiest = [...sessions].sort((a, b) => b.count - a.count)[0]
  const peakHour = [...hours].sort((a, b) => b.count - a.count)[0]

  return {
    empty: false,
    total: frames.length,
    firstDay: sessions[0].label,
    lastDay: sessions.at(-1).label,
    sessions,
    sessionCount: sessions.length,
    perSession: frames.length / sessions.length,
    busiest,
    hours,
    peakHour,
    timeline,
    bodies: tally(frames, 'camera'),
    lenses: tally(frames, 'lens'),
    focalHistogram,
    focal: {
      min: Math.min(...focalLengths),
      max: Math.max(...focalLengths),
      median: median(focalLengths),
    },
    iso: { min: Math.min(...isos), max: Math.max(...isos), median: median(isos) },
    shutter: { fastest: Math.min(...shutters), slowest: Math.max(...shutters), median: median(shutters) },
    aperture: { widest: Math.min(...apertures), narrowest: Math.max(...apertures) },
  }
}

export const stats = buildStats()
