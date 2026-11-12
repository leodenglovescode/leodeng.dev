import { validatePlayback, sha256Hex } from './nowPlaying.js'

const sourcePattern = /^(mac|android|music-assistant):[a-zA-Z0-9._:-]{1,100}$/
const devicePattern = /^[a-zA-Z0-9._:-]{1,128}$/
const priorities = { mac: 30, android: 20, 'music-assistant': 10 }

export function validSourceId(id) {
  return typeof id === 'string' && sourcePattern.test(id)
}

export function validateSource(value) {
  if (!value || !validSourceId(value.sourceId)) return { error: 'sourceId is invalid.' }
  const kind = value.sourceId.split(':', 1)[0]
  const deviceId = value.deviceId ?? value.sourceId
  if (typeof deviceId !== 'string' || !devicePattern.test(deviceId)) return { error: 'deviceId is invalid.' }
  const label = typeof value.sourceLabel === 'string' ? value.sourceLabel.trim() : null
  if (typeof label !== 'string' || !label || label.length > 64 || /[\x00-\x1f\x7f]/.test(label)) return { error: 'sourceLabel is invalid.' }
  if (value.playing != null && typeof value.playing !== 'boolean') return { error: 'playing is invalid.' }
  const playback = value.playing === false ? { value: {} } : validatePlayback(value)
  if (playback.error) return playback
  return { value: { ...playback.value, sourceId: value.sourceId, deviceId, sourceLabel: label, priority: priorities[kind], playing: value.playing !== false } }
}

export function sourceStatement(db, source, now) {
  return db.prepare(`INSERT INTO now_playing_sources
    (source_id, device_id, source_label, priority, playing, track_key, title, artist, album,
     duration_ms, position_ms, artwork_key, changed_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      device_id=excluded.device_id, source_label=excluded.source_label, priority=excluded.priority,
      playing=excluded.playing, track_key=excluded.track_key, title=excluded.title,
      artist=excluded.artist, album=excluded.album, duration_ms=excluded.duration_ms,
      position_ms=excluded.position_ms, artwork_key=excluded.artwork_key,
      changed_at=CASE WHEN now_playing_sources.playing != excluded.playing
        OR now_playing_sources.track_key IS NOT excluded.track_key THEN excluded.changed_at
        ELSE now_playing_sources.changed_at END,
      received_at=excluded.received_at
    WHERE now_playing_sources.received_at <= excluded.received_at - 1`)
    .bind(source.sourceId, source.deviceId, source.sourceLabel, source.priority, Number(source.playing),
      source.trackKey ?? null, source.title ?? null, source.artist ?? null, source.album ?? null,
      source.durationMs ?? null, source.positionMs ?? null, source.artworkKey ?? null, now, now)
}

export async function publicSources(rows, now, mediaBase) {
  // A source's heartbeat must not reorder cards. Direct device reports win
  // over MA observations of the same configured physical device.
  const ordered = preferredSources(rows, now)
  const devices = new Set()
  const sources = []
  for (const row of ordered) {
    if (!row.playing || now - row.received_at > 30 || devices.has(row.device_id)) continue
    devices.add(row.device_id)
    sources.push({
      id: (await sha256Hex(new TextEncoder().encode(row.device_id))).slice(0, 24),
      device: publicDeviceName(row),
      playing: true, title: row.title, artist: row.artist, album: row.album,
      durationMs: row.duration_ms, positionMs: row.position_ms,
      observedAt: row.received_at * 1000,
      artworkUrl: row.artwork_key ? `${mediaBase}/${row.artwork_key}` : null,
    })
    if (sources.length === 3) break
  }
  return sources
}

function publicDeviceName(row) {
  if (row.device_id.startsWith('mac:') || row.source_id.startsWith('mac:')) return "Leo's Mac"
  if (row.device_id.startsWith('android:') || row.source_id.startsWith('android:') || row.track_key?.startsWith('android:')) return "Leo's Phone"
  return row.source_id.startsWith('music-assistant:') ? 'Music Assistant' : 'Music'
}

export function preferredSources(rows, now) {
  const devices = new Set()
  return [...rows].sort((a, b) => b.priority - a.priority || b.changed_at - a.changed_at || a.source_id.localeCompare(b.source_id)).filter(row => {
    if (!row.playing || now - row.received_at > 30 || devices.has(row.device_id)) return false
    devices.add(row.device_id)
    return true
  })
}
