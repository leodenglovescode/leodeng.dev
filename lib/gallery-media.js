import { GALLERY_ASSET } from './gallery-validation.js'
import manifest from '../src/generated/photos.json' with { type: 'json' }

export function galleryMediaKey(parts) {
  if (!Array.isArray(parts) || parts.length !== 2) return null
  const [collection, filename] = parts
  const entries = Object.hasOwn(manifest.collections, collection ?? '') ? manifest.collections[collection] : []
  const entry = entries.find(photo => photo.original === filename && photo.panorama)
  if (!entry) return null
  if (entry.assets) return GALLERY_ASSET.test(entry.assets.full) ? entry.assets.full : null
  return `${manifest.prefix}/${collection}/originals/${filename}`
}
