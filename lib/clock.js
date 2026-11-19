// Explicitly allow only aggregate satellite counts across the public boundary.
export function satelliteCounts(value) {
  if (!value || !Number.isInteger(value.used) || !Number.isInteger(value.visible)
      || value.used < 0 || value.visible < value.used || value.visible > 512) return null
  return { used: value.used, visible: value.visible,
    ...(Number.isInteger(value.tracked) && value.tracked >= 0 && value.tracked <= value.visible
      ? { tracked: value.tracked } : {}),
  }
}

// Keep this list narrow: no coordinates, source addresses, satellite IDs or angles.
const trackingRanges = {
  systemOffsetSeconds: [-3600, 3600], lastOffsetSeconds: [-3600, 3600],
  rmsOffsetSeconds: [0, 3600], frequencyPpm: [-100000, 100000],
  residualFrequencyPpm: [-100000, 100000], skewPpm: [0, 100000],
  rootDelaySeconds: [-3600, 3600], rootDispersionSeconds: [0, 3600],
  updateIntervalSeconds: [0, 86400], referenceAgeSeconds: [0, 150],
  sampleAgeSeconds: [0, 30], lockedForSeconds: [0, 1e9],
}

export function clockDiagnostics(value) {
  const receiver = {}, tracking = {}
  const mode = value?.receiver?.fixMode
  const tdop = value?.receiver?.tdop
  if (Number.isInteger(mode) && mode >= 0 && mode <= 3) receiver.fixMode = mode
  if (typeof tdop === 'number' && Number.isFinite(tdop) && tdop >= 0 && tdop <= 1000) receiver.tdop = tdop
  for (const [key, [min, max]] of Object.entries(trackingRanges)) {
    const number = value?.tracking?.[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max) tracking[key] = number
  }
  return {
    ...(Object.keys(receiver).length ? { receiver } : {}),
    ...(Object.keys(tracking).length ? { tracking } : {}),
  }
}

export function clockStability(value, nowMs) {
  if (!value || value.intervalSeconds !== 10 || !Array.isArray(value.days)
      || value.days.length > 91 || !Number.isFinite(nowMs) || nowMs <= 0 || nowMs >= 8.64e15) return null
  const today = new Date(nowMs).toISOString().slice(0, 10)
  const earliest = new Date(nowMs - 90 * 86400000).toISOString().slice(0, 10)
  const seen = new Set()
  const days = []
  for (const day of value.days) {
    if (!day || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
        || !Number.isFinite(Date.parse(`${day.date}T00:00:00Z`))
        || new Date(`${day.date}T00:00:00Z`).toISOString().slice(0, 10) !== day.date
        || day.date < earliest || day.date > today || seen.has(day.date)
        || !Number.isInteger(day.observed) || day.observed < 1 || day.observed > 8640
        || !Number.isInteger(day.locked) || day.locked < 0 || day.locked > day.observed) return null
    seen.add(day.date)
    days.push({ date: day.date, observed: day.observed, locked: day.locked })
  }
  return { days: days.sort((a, b) => a.date.localeCompare(b.date)), intervalSeconds: 10 }
}

export function validClockSample(value) {
  return value && value.synchronized === true
    && value.source === 'gps-pps' && value.stratum === 1
    && [value.receivedAtMs, value.sentAtMs].every(n => (
      typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 8.64e15
    ))
    && value.sentAtMs >= value.receivedAtMs
    && value.sentAtMs - value.receivedAtMs <= 2000
}

export function estimateClockSample(value, startedAtMs, elapsedMs) {
  if (!validClockSample(value) || !Number.isFinite(startedAtMs)
      || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 3000) return null
  const processingMs = value.sentAtMs - value.receivedAtMs
  const networkMs = elapsedMs - processingMs
  if (networkMs < 0) return null
  return {
    // Equivalent to the four-timestamp offset estimate, anchored at receipt.
    nowMs: value.sentAtMs + networkMs / 2,
    offsetMs: (value.receivedAtMs + value.sentAtMs) / 2 - startedAtMs - elapsedMs / 2,
    roundTripMs: elapsedMs,
    networkMs,
  }
}
