import assert from 'node:assert/strict'
import test from 'node:test'
import { findDuplicateAlbum, imdbId, musicBrainzReference, shelfArtwork, shelfLink, shelfStatus, validateShelfItem } from '../../src/utils/shelf.js'
import { onRequest } from '../api/gh/[[path]].js'

const mbid = '76df3287-6cda-33eb-8e9a-044b5e15ffdd'

test('Picard release IDs and MusicBrainz release-group URLs use distinct cover endpoints', () => {
  assert.deepEqual(musicBrainzReference(mbid), { id: mbid, kind: 'release' })
  assert.deepEqual(musicBrainzReference(`https://musicbrainz.org/release-group/${mbid}`), { id: mbid, kind: 'release-group' })
  assert.equal(shelfArtwork({ type: 'album', musicBrainzId: mbid }), `https://coverartarchive.org/release/${mbid}/front-500`)
  assert.equal(shelfArtwork({ type: 'album', musicBrainzId: mbid, musicBrainzKind: 'release-group' }), `https://coverartarchive.org/release-group/${mbid}/front-500`)
  assert.equal(musicBrainzReference(`https://evil.test/release/${mbid}`), null)
  assert.equal(musicBrainzReference(`https://musicbrainz.org/artist/${mbid}`), null)
  assert.equal(shelfArtwork({ type: 'album', musicBrainzId: 'invalid', posterUrl: 'https://evil.test/image.jpg' }), '')
})

test('only IMDb title links become outgoing links, and albums never become links', () => {
  assert.equal(imdbId('https://www.imdb.com/title/tt0133093/?ref_=test'), 'tt0133093')
  assert.equal(shelfLink({ type: 'tv', imdbId: 'tt0903747' }), 'https://www.imdb.com/title/tt0903747/')
  assert.equal(shelfLink({ type: 'album', imdbId: 'tt0133093' }), undefined)
  for (const value of ['javascript:alert(1)', 'https://imdb.com.evil.test/title/tt0133093/', 'https://www.imdb.com/name/nm0000206/']) assert.equal(imdbId(value), '')
  for (const posterUrl of ['javascript:alert(1)', 'http://example.com/a.jpg', 'https://user:password@example.com/a.jpg']) assert.equal(shelfArtwork({ type: 'movie', posterUrl }), '')
})

test('requires identifying fields without requiring artwork, reviews, dates or translations', () => {
  const movie = { type: 'movie', title: { en: 'The Matrix', zh: '' }, imdbId: 'tt0133093' }
  assert.equal(validateShelfItem(movie), '')
  assert.equal(validateShelfItem({ type: 'album', title: { en: 'An album' }, artist: 'An artist' }), '')
  assert.match(validateShelfItem({ ...movie, imdbId: '' }), /IMDb/)
  assert.match(validateShelfItem({ ...movie, year: '20' }), /four digits/)
  assert.match(validateShelfItem({ ...movie, watchedAt: '2025-02-29' }), /valid watched date/)
  assert.equal(validateShelfItem({ ...movie, watchedAt: '2024-02-29' }), '')
})

test('unfinished titles stay separate and cannot claim a finished date', () => {
  const movie = { type: 'movie', title: { en: 'A movie' }, imdbId: 'tt0133093', status: 'watching' }
  assert.equal(shelfStatus(movie), 'watching')
  assert.equal(shelfStatus({ type: 'tv' }), 'finished')
  assert.equal(validateShelfItem(movie), '')
  assert.match(validateShelfItem({ ...movie, watchedAt: '2026-10-18' }), /unfinished/)
  assert.equal(validateShelfItem({ ...movie, status: 'finished', watchedAt: '2026-10-18' }), '')
  assert.match(validateShelfItem({ ...movie, status: 'unknown' }), /In progress or Finished/)
})

function context(target = 'src/content/shelf.json', headers = { 'X-Admin': '1' }) {
  return {
    request: new Request('https://leodeng.dev/api/gh/test', { method: 'PUT', headers: { Cookie: 'gh_session=test-token', ...headers }, body: '{}' }),
    env: {},
    params: { path: ['repos', 'leodenglovescode', 'leodeng.dev', 'contents', ...target.split('/')] },
  }
}

test('migrated shelf cannot be written through GitHub and retains auth, CSRF and traversal checks', async t => {
  const upstream = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === 'https://api.github.com/user') return Response.json({ login: 'leodenglovescode' })
    upstream.push(String(url))
    assert.equal(options.headers.authorization, 'Bearer test-token')
    return Response.json({ content: { sha: 'saved-sha' } })
  })
  assert.equal((await onRequest(context())).status, 410)
  assert.equal(upstream.length, 0)
  assert.equal((await onRequest(context('src/content/secret.json'))).status, 403)
  assert.equal((await onRequest(context('src/content/shelf.json/other'))).status, 403)
  assert.equal((await onRequest(context('src/content/../shelf.json'))).status, 400)
  assert.equal((await onRequest(context('src/content/shelf.json', {}))).status, 403)
  const unsigned = context()
  unsigned.request.headers.delete('Cookie')
  assert.equal((await onRequest(unsigned)).status, 401)
  assert.equal(upstream.length, 0)
})

test('album duplicate checks normalize IDs and URLs, distinguish entities, and allow same-name albums', () => {
  const id = '6e335887-60ba-38f0-95af-fae7774336bf'
  const existing = { id: 'existing', type: 'album', title: { en: 'Weezer' }, musicBrainzId: id, musicBrainzKind: 'release-group' }
  const candidate = { ...existing, id: 'new', title: { en: 'A different name' }, musicBrainzId: id.toUpperCase() }
  assert.equal(findDuplicateAlbum([existing], candidate), existing)
  assert.equal(findDuplicateAlbum([existing], { ...candidate, musicBrainzId: `https://musicbrainz.org/release-group/${id}` }), existing)
  assert.equal(findDuplicateAlbum([existing], { ...candidate, musicBrainzKind: 'release' }), null)
  assert.equal(findDuplicateAlbum([existing], { ...existing, id: 'new', musicBrainzId: 'b1392450-e666-3926-a536-22c65f834433' }), null)
  assert.equal(findDuplicateAlbum([existing], { ...candidate, musicBrainzId: '' }), null)
  assert.equal(findDuplicateAlbum([existing], { ...candidate, type: 'tv' }), null)
  assert.equal(findDuplicateAlbum([existing], candidate, 'existing'), null)
  assert.equal(findDuplicateAlbum([existing, { ...existing, id: 'second-copy' }], candidate, 'existing'), null)
  const different = { ...existing, id: 'different', musicBrainzId: 'b1392450-e666-3926-a536-22c65f834433' }
  assert.equal(findDuplicateAlbum([existing, different], candidate, 'different'), existing)
})
