import { statsJson } from './monkeyStats.js'
const origin = 'https://www.theaudiodb.com'
const normalize = text => text.normalize('NFKC').trim().toLocaleLowerCase('en')
export function artworkQuery(url) {
  const params = new URL(url).searchParams
  if ([...params.keys()].some(key => !['kind','name','artist','cached','v','e'].includes(key)) || [...params.keys()].some(key => params.getAll(key).length !== 1)) throw new Error('Invalid query')
  if (params.has('e') && !/^[a-f0-9]{8}$/.test(params.get('e'))) throw new Error('Invalid evidence version')
  if (params.has('v') && params.get('v') !== '3') throw new Error('Invalid version')
  if (params.has('cached') && params.get('cached') !== '1') throw new Error('Invalid query')
  const kind = params.get('kind'), name = params.get('name')?.trim(), artist = params.get('artist')?.trim() || ''
  if (!['artists','albums'].includes(kind) || !name || name.length > 200 || artist.length > 200 || (kind === 'albums' && !artist) || /[\u0000-\u001f]/.test(name + artist)) throw new Error('Invalid query')
  return { kind, name, artist: kind === 'artists' ? '' : artist }
}
export function isRankedArtwork(summary, query) {
  return ['7','30','all'].some(range => summary?.ranges?.[range]?.[query.kind]?.some(row => normalize(row.name) === normalize(query.name) && (query.kind === 'artists' || normalize(row.artist) === normalize(query.artist))))
}
export function albumArtworkContext(summary, query) {
  const rows = ['7','30','all'].flatMap(range => summary?.ranges?.[range]?.albums || [])
    .filter(row => normalize(row.name) === normalize(query.name) && normalize(row.artist) === normalize(query.artist))
  const samples = [...new Set(rows.flatMap(row => row.sampleTracks || []))].sort()
  const matches = rows.filter(row => row.catalogMatch)
  if (!matches.length || matches.some(row => row.catalogMatch.releaseGroupId !== matches[0].catalogMatch.releaseGroupId)) return { sampleTracks:samples }
  const confirmed = new Set(matches.flatMap(row => row.catalogMatch.matchedTracks))
  if (!samples.length || samples.some(title => !confirmed.has(title))) return { sampleTracks:samples }
  return { sampleTracks:samples, catalogMatch:{releaseGroupId:matches[0].catalogMatch.releaseGroupId,matchedTracks:samples} }
}
export async function artworkCacheKey(query, context = {}) {
  const value = JSON.stringify([query.kind,normalize(query.name),normalize(query.artist),context.catalogMatch?.releaseGroupId || '',context.sampleTracks || []])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return 'stats/artwork/v3/' + [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('') + '.json'
}
export function validArtwork(value) {
  if (!value || typeof value.image !== 'string' || typeof value.source !== 'string') return false
  try {
    const image = new URL(value.image), source = new URL(value.source)
    if (image.username || image.password || source.username || source.password) return false
    const releaseGroup = /^\/release-group\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/front-250$/.exec(image.pathname)
    if (image.origin === 'https://coverartarchive.org' && releaseGroup && !image.search && !image.hash
      && source.origin === 'https://musicbrainz.org' && source.pathname === '/release-group/' + releaseGroup[1] && !source.search && !source.hash) return true
    return image.protocol === 'https:' && !image.port && ['www.theaudiodb.com','r2.theaudiodb.com'].includes(image.hostname)
      && /^\/images\/media\/artist\//.test(image.pathname) && source.origin === origin
      && /^\/artist\/\d+$/.test(source.pathname) && !source.search && !source.hash
  } catch { return false }
}
export async function lookupMusicArtwork(query, fetcher = fetch, context = {}) {
  if (query.kind === 'albums') {
    // Catalog identity comes only from the publisher's song-membership checks.
    // No album-name fallback, arbitrary first result, or per-artist exception.
    const match = context.catalogMatch
    if (!match || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(match.releaseGroupId) || !match.matchedTracks?.length) return null
    return { image:`https://coverartarchive.org/release-group/${match.releaseGroupId}/front-250`, source:`https://musicbrainz.org/release-group/${match.releaseGroupId}`, provider:'MusicBrainz / Cover Art Archive' }
  }
  const url = new URL(`${origin}/api/v1/json/123/search.php`)
  url.searchParams.set('s',query.name)
  const data = await statsJson(url.href, { headers: { Accept:'application/json', 'User-Agent':'leodeng.dev/1.0 (music stats; https://leodeng.dev/stats)' } }, fetcher)
  if (!Array.isArray(data.artists)) return null
  const exact = data.artists.filter(row => typeof row?.strArtist === 'string' && normalize(row.strArtist) === normalize(query.name))
  if (exact.length !== 1) return null
  const row = exact[0]
  if (!/^\d+$/.test(String(row.idArtist)) || typeof row.strArtistThumb !== 'string' || !row.strArtistThumb) return null
  const value = { image:row.strArtistThumb.replace(/\/$/,'')+'/small',source:`${origin}/artist/${row.idArtist}`,provider:'TheAudioDB' }
  return validArtwork(value) ? value : null
}
