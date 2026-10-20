// A fixed calendar year keeps month labels unique and the layout stable even
// in January. Future dates have no contribution data and are marked separately.
export function currentYearDays(source, now = new Date()) {
  const year = now.getUTCFullYear(), today = now.toISOString().slice(0, 10)
  const counts = new Map()
  for (const day of source) {
    if (typeof day.date !== 'string' || !day.date.startsWith(`${year}-`) || day.date > today) continue
    if (typeof day.count !== 'number' || !Number.isFinite(day.count) || day.count < 0) continue
    counts.set(day.date, { count: day.count, level: Math.min(4, Math.max(0, Number(day.level) || 0)) })
  }
  const days = []
  for (const date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10)
    days.push({ date: key, ...(counts.get(key) || { count: 0, level: 0 }), future: key > today })
  }
  return days
}
