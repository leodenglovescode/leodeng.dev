// Verified release-group identities for ambiguous library titles. Keeping the
// IDs explicit avoids trusting a provider's first self-titled search result.
// Blue: https://musicbrainz.org/release-group/c7b245c9-8099-32ea-af95-893acedde2cf
// Green: https://musicbrainz.org/release-group/923d5ba6-7eee-3bce-bcb2-c913b2bd69d4
const albums = [
  { artist:'Weezer', id:'c7b245c9-8099-32ea-af95-893acedde2cf', aliases:[
    'Weezer (Blue Album)', 'Weezer [Blue Album]', 'Weezer (Deluxe Edition)',
  ] },
  { artist:'Weezer', id:'923d5ba6-7eee-3bce-bcb2-c913b2bd69d4', aliases:[
    'Weezer (Green Album)', 'Weezer [Green Album]',
  ] },
]
const key = value => value.normalize('NFKC').trim().toLowerCase()
export function verifiedAlbum(artist, title) {
  return albums.find(album => key(album.artist) === key(artist) && album.aliases.some(alias => key(alias) === key(title))) || null
}
export function ambiguousAlbum(artist, title) {
  return key(artist) === 'weezer' && key(title) === 'weezer'
}
