// LRC timestamps are relative to the recording, in milliseconds.
export function parseSyncedLyrics(source) {
  if (typeof source !== 'string' || source.length > 100_000) return []
  const offset = Number(source.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im)?.[1] || 0)
  const lines = []
  for (const row of source.split(/\r?\n/)) {
    const timestamps = [...row.matchAll(/\[(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?\]/g)]
    const text = row.replace(/\[[^\]]*\]/g, '').trim()
    for (const match of timestamps) {
      const milliseconds = Number((match[3] || '').padEnd(3, '0'))
      lines.push({ timeMs: Math.max(0, Number(match[1]) * 60_000 + Number(match[2]) * 1000 + milliseconds - offset), text })
      if (lines.length > 2000) return []
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

export function currentLyricIndex(lines, positionMs) {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (lines[middle].timeMs <= positionMs) low = middle + 1
    else high = middle
  }
  return low - 1
}
