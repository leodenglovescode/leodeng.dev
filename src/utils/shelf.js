const MBID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const SHELF_TYPES = ['movie', 'tv', 'album']

// Keep A-Z order consistent between both site languages and the editor.
const titleOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
export function compareShelfTitles(a, b) {
  return titleOrder.compare(a.title?.en || '', b.title?.en || '') || titleOrder.compare(a.id, b.id)
}

// Older entries predate progress tracking and represent finished watches.
export function shelfStatus(item) {
  return item.status === 'watching' ? 'watching' : 'finished'
}

export function imdbId(value) {
  const text = String(value || '').trim()
  if (/^tt\d{7,}$/.test(text)) return text
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || !['imdb.com', 'www.imdb.com', 'm.imdb.com'].includes(url.hostname)) return ''
    return url.pathname.match(/^\/title\/(tt\d{7,})(?:\/|$)/)?.[1] || ''
  } catch { return '' }
}

// Picard stores a release ID; an album's MusicBrainz page may instead be a
// release group. Keep that distinction when constructing the CAA endpoint.
export function musicBrainzReference(value, kind = 'release') {
  const text = String(value || '').trim()
  if (MBID.test(text)) return { id: text.toLowerCase(), kind: kind === 'release-group' ? kind : 'release' }
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || !['musicbrainz.org', 'www.musicbrainz.org'].includes(url.hostname)) return null
    const match = url.pathname.match(/^\/(release|release-group)\/([^/]+)\/?$/)
    return match && MBID.test(match[2]) ? { id: match[2].toLowerCase(), kind: match[1] } : null
  } catch { return null }
}

// Compare catalog identities, never titles: different albums can share a name.
export function findDuplicateAlbum(items, candidate, originalId = null) {
  if (candidate.type !== 'album') return null
  const reference = musicBrainzReference(candidate.musicBrainzId, candidate.musicBrainzKind)
  if (!reference) return null
  const matches = item => {
    if (item.type !== 'album') return false
    const other = musicBrainzReference(item.musicBrainzId, item.musicBrainzKind)
    return other?.id === reference.id && other.kind === reference.kind
  }
  // Updating the same saved album doesn't add a duplicate, even if the user
  // previously chose to keep more than one copy of it.
  const original = items.find(item => item.id === originalId)
  if (original && matches(original)) return null
  return items.find(item => item.id !== originalId && matches(item)) || null
}

export function imageUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function wikipediaSourceUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'en.wikipedia.org' && url.pathname.startsWith('/wiki/') && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function shelfArtwork(item) {
  if (item.artworkMode === 'custom') return imageUrl(item.customArtworkUrl)
  if (item.type === 'album') {
    const reference = musicBrainzReference(item.musicBrainzId, item.musicBrainzKind)
    return reference ? `https://coverartarchive.org/${reference.kind}/${reference.id}/front-500` : ''
  }
  return imageUrl(item.posterUrl)
}

export function shelfLink(item) {
  const id = item.type !== 'album' && imdbId(item.imdbId)
  return id ? `https://www.imdb.com/title/${id}/` : undefined
}

export function validateShelfItem(item) {
  if (!SHELF_TYPES.includes(item.type)) return 'Choose a movie, TV show or album.'
  if (!item.title?.en?.trim()) return 'Add a title.'
  if (item.type === 'album' && !item.artist?.trim()) return 'Add the album artist.'
  if (item.artworkMode && !['original', 'custom'].includes(item.artworkMode)) return 'Choose original artwork or your own image.'
  if (item.artworkMode === 'custom' && !imageUrl(item.customArtworkUrl)) return 'Upload an image to R2 for your custom cover.'
  if (item.customArtworkUrl && !imageUrl(item.customArtworkUrl)) return 'Custom artwork must use an HTTPS image URL.'
  if (item.year && !/^\d{4}$/.test(String(item.year))) return 'Year must have four digits.'
  if (item.type !== 'album' && item.status && !['watching', 'finished'].includes(item.status)) return 'Choose In progress or Finished.'
  if (item.type !== 'album' && item.status === 'watching' && item.watchedAt) return 'An unfinished title cannot have a finished watching date.'
  if (item.type !== 'album' && !imdbId(item.imdbId)) return 'Add a valid IMDb title link or ID (tt followed by digits).'
  if (item.type !== 'album' && item.posterUrl && !imageUrl(item.posterUrl)) return 'Poster URL must be a full HTTPS image URL.'
  if (item.type === 'album' && item.musicBrainzId && !musicBrainzReference(item.musicBrainzId, item.musicBrainzKind)) {
    return 'Add a MusicBrainz release or release-group link, or a valid MBID.'
  }
  if (item.watchedAt) {
    const date = new Date(`${item.watchedAt}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.watchedAt) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.watchedAt) {
      return 'Choose a valid watched date.'
    }
  }
  return ''
}
