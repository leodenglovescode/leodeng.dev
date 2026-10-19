import test from 'node:test'
import assert from 'node:assert/strict'
import { searchShelfCatalog } from '../../lib/shelf-search.js'
import { onRequest } from '../api/shelf-search.js'
import { shelfArtwork, shelfLink, validateShelfItem } from '../../src/utils/shelf.js'

const params = (type, q, artist = '') => new URLSearchParams({ type, q, artist })
test('catalog search is authenticated in production and validates requests before contacting providers', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
  const response = await onRequest({ request: new Request('https://leodeng.dev/api/shelf-search?type=tv&q=Suits&local=true', { headers: { 'X-Local-Admin': '1' } }), env: { LOCAL_ADMIN: 'true' } })
  assert.equal(response.status, 401)
  await assert.rejects(searchShelfCatalog(params('bad', 'query')), error => error.status === 400)
  await assert.rejects(searchShelfCatalog(params('movie', 'a')), error => error.status === 400)
  await assert.rejects(searchShelfCatalog(params('album', 'a'.repeat(161))), error => error.status === 400)
})

test('TV search supplies available IMDb IDs and poster URLs without guessing watched status', async t => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    count++
    assert.equal(new URL(url).hostname, 'api.tvmaze.com')
    assert.match(init.headers['User-Agent'], /leodeng.dev/)
    return Response.json([{ show: { id: 172, name: 'Suits', premiered: '2011-06-23', externals: { imdb: 'tt1632701' }, image: { medium: 'https://static.tvmaze.com/suits.jpg' } } }])
  })
  const result = await searchShelfCatalog(params('tv', 'Suits test'))
  assert.equal(result.items[0].imdbId, 'tt1632701')
  assert.equal(result.items[0].year, '2011')
  assert.equal(result.items[0].status, undefined)
  assert.equal(validateShelfItem(result.items[0]), '')
  await searchShelfCatalog(params('tv', 'Suits test'))
  assert.equal(count, 1, 'repeat searches use the cache')
})

test('movie search filters non-films and joins Wikipedia artwork to the correct movie', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url)
    if (parsed.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: [{ id: 'Q1' }, { id: 'Q2' }] })
    if (parsed.searchParams.get('action') === 'wbgetentities') return Response.json({ entities: {
      Q1: { id: 'Q1', labels: { en: { value: 'A Film' }, zh: { value: '电影' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }], P345: [{ mainsnak: { datavalue: { value: 'tt0111161' } } }], P577: [{ mainsnak: { datavalue: { value: { time: '+1994-09-23T00:00:00Z' } } } }] }, sitelinks: { enwiki: { title: 'A Film' } } },
      Q2: { id: 'Q2', labels: { en: { value: 'A Novel' } }, claims: {} },
    } })
    assert.equal(parsed.hostname, 'en.wikipedia.org')
    return Response.json({ query: { pages: [{ title: 'A Film', thumbnail: { source: 'https://upload.wikimedia.org/a-film.jpg' } }] } })
  })
  const { items } = await searchShelfCatalog(params('movie', 'A Film test'))
  assert.equal(items.length, 1)
  assert.equal(items[0].title.zh, '电影')
  assert.equal(items[0].posterUrl, 'https://upload.wikimedia.org/a-film.jpg')
  assert.equal(items[0].posterSourceUrl, 'https://en.wikipedia.org/wiki/A_Film')
  assert.equal(items[0].imdbId, 'tt0111161')
})

test('albums use release-group IDs, cache searches and respect the MusicBrainz rate limit', async t => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async url => {
    count++
    assert.equal(new URL(url).hostname, 'musicbrainz.org')
    assert.match(new URL(url).searchParams.get('query'), /artist:"Radiohead"/)
    return Response.json({ 'release-groups': [{ id: '6e335887-60ba-38f0-95af-fae7774336bf', title: 'In Rainbows', 'first-release-date': '2007-10-10', 'artist-credit': [{ name: 'Radiohead' }] }] })
  })
  const result = await searchShelfCatalog(params('album', 'In Rainbows test', 'Radiohead'))
  assert.equal(result.items[0].artist, 'Radiohead')
  assert.equal(result.items[0].musicBrainzKind, 'release-group')
  assert.match(shelfArtwork(result.items[0]), /release-group\/.*\/front-500$/)
  await searchShelfCatalog(params('album', 'In Rainbows test', 'Radiohead'))
  assert.equal(count, 1)
  await assert.rejects(searchShelfCatalog(params('album', 'Another album')), error => error.status === 429)
})

test('custom covers work for all media while retaining original artwork and album link behavior', () => {
  for (const type of ['movie', 'tv', 'album']) {
    const entry = { type, title: { en: 'Example' }, artist: 'Artist', imdbId: 'tt0111161', posterUrl: 'https://example.com/original.jpg', musicBrainzId: '6e335887-60ba-38f0-95af-fae7774336bf', musicBrainzKind: 'release-group', artworkMode: 'custom', customArtworkUrl: 'https://media.leodeng.dev/own.png' }
    assert.equal(validateShelfItem(entry), '')
    assert.equal(shelfArtwork(entry), entry.customArtworkUrl)
    assert.notEqual(shelfArtwork({ ...entry, artworkMode: 'original' }), entry.customArtworkUrl)
    assert.match(validateShelfItem({ ...entry, customArtworkUrl: 'javascript:alert(1)' }), /Upload an image/)
    if (type === 'album') assert.equal(shelfLink(entry), undefined)
  }
})
