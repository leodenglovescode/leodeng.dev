// Explicitly allow only aggregate satellite counts across the public boundary.
export function satelliteCounts(value) {
  if (!value || !Number.isInteger(value.used) || !Number.isInteger(value.visible)
      || value.used < 0 || value.visible < value.used || value.visible > 512) return null
  return { used: value.used, visible: value.visible }
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
