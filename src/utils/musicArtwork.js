import { statsJson } from '../../lib/monkeyStats.js'
import { validArtwork } from '../../lib/musicArtwork.js'
// Cached images load immediately. Cold lookups are serialized and spaced for
// the provider's free limit, then reused across rankings and range changes.
const requests = new Map()
let queue = Promise.resolve(), nextLookup = 0
export function musicArtwork(kind, name, artist = '', evidence = '') {
  let hash = 0
  for (let index=0; index<evidence.length; index++) hash = ((hash << 5) - hash + evidence.charCodeAt(index)) | 0
  const evidenceVersion = ('00000000' + (hash >>> 0).toString(16)).slice(-8)
  const query = new URLSearchParams({ v:'3', e:evidenceVersion, kind, name, artist: kind === 'artists' ? '' : artist })
  const requestQuery = query.toString()
  const key = requestQuery + '|' + evidence
  if (!requests.has(key)) {
    const pending = statsJson('/api/stats/music-artwork?' + requestQuery + '&cached=1').then(cached => {
      if (validArtwork(cached.artwork)) return cached.artwork
      if (!cached.pending) return null
      const lookup = queue.then(async () => {
        const delay = nextLookup - Date.now()
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
        nextLookup = Date.now() + 2100
        try {
          const data = await statsJson('/api/stats/music-artwork?' + requestQuery)
          return validArtwork(data.artwork) ? data.artwork : null
        } catch { return null }
      })
      queue = lookup.then(() => {})
      return lookup
    }).catch(() => null)
    requests.set(key, pending)
  }
  return requests.get(key)
}
