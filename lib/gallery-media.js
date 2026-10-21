import keys from '../src/generated/gallery-media.js'

export function galleryMediaKey(parts) {
  if (!Array.isArray(parts) || parts.length !== 2) return null
  const key = parts.join('/')
  return Object.hasOwn(keys, key) ? keys[key] : null
}
