// Shared read-only catalog search for authenticated Pages admin and Vite dev.
// Providers are fixed here: the client cannot choose an upstream URL.
import { imageUrl, imdbId } from '../src/utils/shelf.js'

const USER_AGENT = 'LeoPersonalShelf/1.0 (https://leodeng.dev)'
export function createShelfCatalogSearch(fetcher = (...args) => globalThis.fetch(...args)) {
  const cache = new Map()
  let lastAlbumSearch = 0
  const fail = (status, message) => Object.assign(new Error(message), { status })
  const year = value => String(value || '').match(/^\+?(\d{4})/)?.[1] || ''
  function endpoint(base, params) { const url = new URL(base); url.search = new URLSearchParams(params); return url.href }
  async function getJSON(url) {
    const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw fail([429, 503].includes(response.status) ? 429 : 502, 'The catalog is temporarily unavailable. Please try again shortly.')
    const data = await response.json()
    if (data.error) throw fail(502, 'The catalog could not complete this search. Try a shorter title.')
    return data
  }
  const values = (entity, property) => (entity.claims?.[property] || []).filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value).filter(value => value !== undefined)

  async function movies(query) {
    const search = await getJSON(endpoint('https://www.wikidata.org/w/api.php', { action: 'wbsearchentities', search: query, language: 'en', type: 'item', format: 'json', limit: '20', maxlag: '5' }))
    const ids = (search.search || []).map(item => item.id).filter(id => /^Q\d+$/.test(id))
    if (!ids.length) return []
    const data = await getJSON(endpoint('https://www.wikidata.org/w/api.php', { action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|descriptions|sitelinks', languages: 'en|zh|zh-hans', format: 'json', maxlag: '5' }))
    const results = ids.map(id => data.entities?.[id]).filter(Boolean).filter(entity => {
      const film = values(entity, 'P31').some(value => ['Q11424', 'Q202866', 'Q24869', 'Q506240'].includes(value.id)) || /\b(film|movie)\b/i.test(entity.descriptions?.en?.value || '')
      return film && values(entity, 'P345').some(value => imdbId(value))
    }).slice(0, 8).map(entity => ({
      catalogId: entity.id, type: 'movie', title: { en: entity.labels?.en?.value || query, zh: entity.labels?.['zh-hans']?.value || entity.labels?.zh?.value || '' },
      year: values(entity, 'P577').map(value => year(value.time)).filter(Boolean).sort()[0] || '',
      imdbId: values(entity, 'P345').map(imdbId).find(Boolean), posterUrl: '',
      description: entity.descriptions?.en?.value || '',
      wikipediaTitle: entity.sitelinks?.enwiki?.title || '',
    }))
    const titles = results.map(item => item.wikipediaTitle).filter(Boolean)
    if (titles.length) {
      // Missing artwork must not prevent adding an otherwise identified film.
      try {
        const images = await getJSON(endpoint('https://en.wikipedia.org/w/api.php', { action: 'query', titles: titles.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any', format: 'json', formatversion: '2', maxlag: '5' }))
        const pages = new Map((images.query?.pages || []).map(page => [page.title, page]))
        for (const item of results) {
          item.posterUrl = imageUrl(pages.get(item.wikipediaTitle)?.thumbnail?.source)
          if (item.posterUrl) item.posterSourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.wikipediaTitle.replaceAll(' ', '_'))}`
        }
      } catch { /* Leave a title placeholder; the editor also supports R2 uploads. */ }
    }
    return results.map(({ wikipediaTitle, ...item }) => item)
  }
  async function shows(query) {
    const data = await getJSON(endpoint('https://api.tvmaze.com/search/shows', { q: query }))
    return data.slice(0, 8).map(({ show }) => ({
      catalogId: `tvmaze-${show.id}`, type: 'tv', title: { en: show.name, zh: '' }, year: year(show.premiered),
      imdbId: imdbId(show.externals?.imdb), posterUrl: imageUrl(show.image?.medium),
      description: [show.language, show.network?.name || show.webChannel?.name].filter(Boolean).join(' · '),
    }))
  }
  async function albums(query, artist) {
    // MusicBrainz asks clients to stay at or below one metadata request/second.
    if (Date.now() - lastAlbumSearch < 1100) throw fail(429, 'Please wait a moment before searching MusicBrainz again.')
    lastAlbumSearch = Date.now()
    const quote = text => text.replace(/[\\"]/g, '\\$&')
    const expression = `releasegroup:"${quote(query)}" AND primarytype:album${artist ? ` AND artist:"${quote(artist)}"` : ''}`
    const data = await getJSON(endpoint('https://musicbrainz.org/ws/2/release-group/', { query: expression, fmt: 'json', limit: '8' }))
    return (data['release-groups'] || []).map(group => ({
      catalogId: group.id, type: 'album', title: { en: group.title, zh: '' }, year: year(group['first-release-date']),
      artist: (group['artist-credit'] || []).map(credit => typeof credit === 'string' ? credit : `${credit.name || credit.artist?.name || ''}${credit.joinphrase || ''}`).join(''),
      musicBrainzId: group.id, musicBrainzKind: 'release-group', description: group.disambiguation || '',
    }))
  }
  async function searchShelfCatalog(params) {
    const type = params.get('type')
    const query = (params.get('q') || '').trim()
    const artist = (params.get('artist') || '').trim()
    if (!['movie', 'tv', 'album'].includes(type)) throw fail(400, 'Choose Movies, TV shows or Albums.')
    if (query.length < 2 || query.length > 160 || artist.length > 160) throw fail(400, 'Search titles must have 2 to 160 characters.')
    const key = JSON.stringify([type, query.toLowerCase(), artist.toLowerCase()])
    const saved = cache.get(key)
    if (saved && saved.expires > Date.now()) return saved.data
    try {
      const items = await (type === 'movie' ? movies(query) : type === 'tv' ? shows(query) : albums(query, artist))
      const data = { items, provider: type === 'movie' ? 'Wikidata / Wikipedia' : type === 'tv' ? 'TVmaze' : 'MusicBrainz / Cover Art Archive' }
      if (cache.size >= 50) cache.delete(cache.keys().next().value)
      cache.set(key, { data, expires: Date.now() + 10 * 60_000 })
      return data
    } catch (error) {
      if (error.status) throw error
      throw fail(502, 'The catalog could not be reached. You can retry or fill in the fields manually.')
    }
  }

  return searchShelfCatalog
}

export const searchShelfCatalog = createShelfCatalogSearch()
