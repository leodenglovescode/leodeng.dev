export function playbackSources(payload, serverNow, syncedAt) {
  const candidates = Array.isArray(payload?.sources) ? payload.sources : [payload]
  return candidates.filter(track => track?.playing === true
    && typeof track.title === 'string' && track.title.length > 0
    && typeof track.artist === 'string' && track.artist.length > 0
    && Number.isFinite(track.durationMs) && track.durationMs > 0
    && Number.isFinite(track.positionMs) && Number.isFinite(track.observedAt)
    && serverNow - track.observedAt <= 30_000).slice(0, 3).map((track, index) => ({
      id: typeof track.id === 'string' ? track.id : `legacy-${index}`,
      device: typeof track.device === 'string' ? track.device : '',
      title: track.title, artist: track.artist,
      album: typeof track.album === 'string' ? track.album : '',
      artworkUrl: typeof track.artworkUrl === 'string' ? track.artworkUrl : '',
      durationMs: track.durationMs,
      syncedPositionMs: Math.min(track.durationMs, Math.max(0, track.positionMs + Math.max(0, serverNow - track.observedAt))),
      expiresAt: syncedAt + Math.max(0, 30_000 - Math.max(0, serverNow - track.observedAt)),
      syncedAt,
    }))
}
