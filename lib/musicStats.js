const validNumber = n => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER
export function musicSummary(body) {
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.through) || new Date(body.through).toISOString().slice(0, 10) !== body.through) throw new Error('Invalid summary')
  const ranges = {}
  for (const key of ['7', '30', 'all']) {
    const value = body.ranges?.[key]
    if (!value || !validNumber(value.plays) || !validNumber(value.listenedMs)) throw new Error('Invalid totals')
    const clean = { plays: value.plays, listenedMs: value.listenedMs }
    for (const kind of ['artists', 'albums', 'tracks']) {
      if (!Array.isArray(value[kind]) || value[kind].length > 10) throw new Error('Invalid ranking')
      clean[kind] = value[kind].map(row => {
        if (typeof row.name !== 'string' || !row.name || row.name.length > 500 || typeof row.artist !== 'string' || row.artist.length > 500 || !validNumber(row.plays) || !validNumber(row.listenedMs)) throw new Error('Invalid item')
        return { name: row.name, artist: row.artist, plays: row.plays, listenedMs: row.listenedMs }
      })
    }
    ranges[key] = clean
  }
  if (!Array.isArray(body.daily) || body.daily.length > 90) throw new Error('Invalid series')
  let previous = ''
  const daily = body.daily.map(row => {
    if (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || new Date(row.day).toISOString().slice(0,10) !== row.day || row.day <= previous || row.day > body.through || !validNumber(row.plays) || !validNumber(row.listenedMs)) throw new Error('Invalid day')
    previous = row.day
    return { day: row.day, plays: row.plays, listenedMs: row.listenedMs }
  })
  return { through: body.through, ranges, daily }
}
export async function musicSchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS music_summary (id INTEGER PRIMARY KEY CHECK(id=1), through TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL)').run()
}
