import { verifiedAlbum, ambiguousAlbum } from './musicArtworkAlbums.js'
import { statsJson } from './monkeyStats.js'
const origin = 'https://www.theaudiodb.com'
const normalize = text => text.normalize('NFKC').trim().toLocaleLowerCase('en')
// Edition decorations may use the original album cover; color titles remain significant.
const albumTitle = text => text.replace(/\s*[\[(](?:deluxe|expanded|remastered|anniversary)(?:[^)\]]{0,80})[)\]]\s*$/i, '').trim()
export function artworkQuery(url) {
  const params = new URL(url).searchParams
  if ([...params.keys()].some(key => !['kind','name','artist','cached','v'].includes(key)) || [...params.keys()].some(key => params.getAll(key).length !== 1)) throw new Error('Invalid query')
  if (params.has('v') && params.get('v') !== '2') throw new Error('Invalid version')
  if (params.has('cached') && params.get('cached') !== '1') throw new Error('Invalid query')
  const kind = params.get('kind'), name = params.get('name')?.trim(), artist = params.get('artist')?.trim() || ''
  if (!['artists','albums'].includes(kind) || !name || name.length > 200 || artist.length > 200 || (kind === 'albums' && !artist) || /[\u0000-\u001f]/.test(name + artist)) throw new Error('Invalid query')
  return { kind, name, artist: kind === 'artists' ? '' : artist }
}
export function isRankedArtwork(summary, query) {
  return ['7','30','all'].some(range => summary?.ranges?.[range]?.[query.kind]?.some(row => normalize(row.name) === normalize(query.name) && (query.kind === 'artists' || normalize(row.artist) === normalize(query.artist))))
}
export async function artworkCacheKey(query) {
  const value = JSON.stringify([query.kind,normalize(query.name),normalize(query.artist)])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return 'stats/artwork/v2/' + [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('') + '.json'
}
export function validArtwork(value) {
  if (!value || typeof value.image !== 'string' || typeof value.source !== 'string') return false
  try {
    const image = new URL(value.image), source = new URL(value.source)
    if (image.username || image.password || source.username || source.password) return false
    const releaseGroup = /^\/release-group\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/front-250$/.exec(image.pathname)
    if (image.origin === 'https://coverartarchive.org' && releaseGroup && !image.search && !image.hash
      && source.origin === 'https://musicbrainz.org' && source.pathname === '/release-group/' + releaseGroup[1] && !source.search && !source.hash) return true
    return image.protocol === 'https:' && !image.username && !image.password && !image.port && ['www.theaudiodb.com','r2.theaudiodb.com'].includes(image.hostname)
      && /^\/images\/media\/(artist|album)\//.test(image.pathname) && source.origin === origin && !source.username && !source.password
      && /^\/(artist|album)\/\d+$/.test(source.pathname) && !source.search && !source.hash
  } catch { return false }
}
export async function lookupMusicArtwork(query, fetcher = fetch) {
  if (query.kind === 'albums') {
    const album = verifiedAlbum(query.artist, query.name)
    if (album) return { image:`https://coverartarchive.org/release-group/${album.id}/front-250`, source:`https://musicbrainz.org/release-group/${album.id}`, provider:'MusicBrainz / Cover Art Archive' }
    if (ambiguousAlbum(query.artist, albumTitle(query.name))) return null
  }
  const endpoint = query.kind === 'artists' ? 'search.php' : 'searchalbum.php'
  const url = new URL(`${origin}/api/v1/json/123/${endpoint}`)
  url.searchParams.set('s', query.kind === 'artists' ? query.name : query.artist)
  if (query.kind === 'albums') url.searchParams.set('a', albumTitle(query.name))
  const data = await statsJson(url.href, { headers: { Accept:'application/json', 'User-Agent':'leodeng.dev/1.0 (music stats; https://leodeng.dev/stats)' } }, fetcher)
  const rows = data[query.kind === 'artists' ? 'artists' : 'album']
  if (!Array.isArray(rows)) return null
  const exact = rows.filter(row => typeof row.strArtist === 'string' && normalize(row.strArtist) === normalize(query.kind === 'artists' ? query.name : query.artist)
    && (query.kind === 'artists' || (typeof row.strAlbum === 'string' && normalize(albumTitle(row.strAlbum)) === normalize(albumTitle(query.name)))))
  // Do not attach an unrelated record or guess between identically named editions.
  if (exact.length !== 1) return null
  const row = exact[0], id = row[query.kind === 'artists' ? 'idArtist' : 'idAlbum']
  const image = row[query.kind === 'artists' ? 'strArtistThumb' : 'strAlbumThumb']
  if (!/^\d+$/.test(String(id)) || typeof image !== 'string' || !image) return null
  const value = { image: image.replace(/\/$/, '') + '/small', source: `${origin}/${query.kind === 'artists' ? 'artist' : 'album'}/${id}`, provider:'TheAudioDB' }
  return validArtwork(value) ? value : null
}
