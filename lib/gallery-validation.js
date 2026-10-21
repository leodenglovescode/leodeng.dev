export const GALLERY_PATH = 'src/generated/photos.json'
export const GALLERY_ASSET = /^gallery-[a-f0-9-]{36}-(?:thumb|full|legacy-thumb|legacy-full|poster)\.(?:jpg|jpeg|png|webp)$/
export const GALLERY_VIDEO_ASSET = /^gallery-[a-f0-9-]{36}-full\.(?:mp4|webm)$/
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function validatePhotoMetadata(data) {
  if (!object(data)) throw new Error('Expected photo metadata.')
  const allowed = new Set(['caption', 'shotAt', 'make', 'camera', 'lens', 'focalLength', 'aperture', 'iso', 'shutter', 'location'])
  if (Object.keys(data).some(key => !allowed.has(key))) throw new Error('Unknown photo metadata field.')
  for (const key of ['caption', 'shotAt', 'make', 'camera', 'lens']) {
    if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 2000)) throw new Error(`Invalid ${key}.`)
  }
  if (data.shotAt && !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(data.shotAt)) throw new Error('Use a complete capture date and time.')
  for (const key of ['focalLength', 'aperture', 'iso', 'shutter']) {
    if (data[key] != null && (!Number.isFinite(data[key]) || data[key] <= 0)) throw new Error(`${key} must be a positive number.`)
  }
  if (data.location != null && (!object(data.location) || !Number.isFinite(data.location.latitude) || !Number.isFinite(data.location.longitude) ||
      Math.abs(data.location.latitude) > 90 || Math.abs(data.location.longitude) > 180)) throw new Error('Enter valid latitude and longitude together.')
  return data
}
export function validateGalleryManifest(data) {
  if (!object(data) || !object(data.collections) || typeof data.base !== 'string' || typeof data.prefix !== 'string') throw new Error('Invalid gallery manifest.')
  const base = new URL(data.base)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Gallery media needs an HTTPS base URL.')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(data.prefix)) throw new Error('Invalid gallery media prefix.')
  for (const [slug, entries] of Object.entries(data.collections)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !Array.isArray(entries)) throw new Error('Invalid collection.')
    const names = new Set()
    for (const entry of entries) {
      if (!object(entry) || typeof entry.name !== 'string' || !entry.name || /[\\/\0]/.test(entry.name) || names.has(entry.name)) throw new Error('Invalid or duplicate photo name.')
      names.add(entry.name)
      if (entry.metadata) validatePhotoMetadata(entry.metadata)
      if (entry.assets && (!object(entry.assets) || !['thumb', 'full', 'legacyThumb', 'legacyFull'].every(key => (entry.kind === 'video' && ['full', 'legacyFull'].includes(key) ? GALLERY_VIDEO_ASSET : GALLERY_ASSET).test(entry.assets[key])))) throw new Error('Invalid gallery assets.')
      if (entry.kind && !['photo', 'panorama', 'photosphere', 'video'].includes(entry.kind)) throw new Error('Invalid photo type.')
      if (entry.kind === 'video' && (!entry.assets || !GALLERY_ASSET.test(entry.assets.poster) || ![entry.width, entry.height, entry.duration].every(n => Number.isFinite(n) && n > 0) || entry.panorama || entry.original)) throw new Error('Invalid video metadata or poster.')
      if (entry.panorama) {
        const p = entry.panorama
        if (!['fullWidth', 'fullHeight', 'width', 'height', 'left', 'top'].every(k => Number.isFinite(p[k])) ||
            p.width <= 0 || p.height <= 0 || p.fullWidth <= 0 || p.fullHeight <= 0 || p.left < 0 || p.top < 0 ||
            p.left + p.width > p.fullWidth || p.top + p.height > p.fullHeight) throw new Error('Invalid panorama crop.')
      }
    }
  }
  if (data.featured != null) {
    if (!Array.isArray(data.featured) || data.featured.length > 5) throw new Error('Choose up to five featured works.')
    const seen = new Set()
    for (const item of data.featured) {
      if (!object(item) || !data.collections[item.collection]?.some(entry => entry.name === item.name)) throw new Error('Featured work must exist in a collection.')
      const key = JSON.stringify([item.collection, item.name])
      if (seen.has(key)) throw new Error('Duplicate featured work.')
      seen.add(key)
    }
  }
  if (data.excluded && (!object(data.excluded) || Object.entries(data.excluded).some(([slug, names]) =>
      !/^[a-z0-9][a-z0-9-]*$/.test(slug) || !Array.isArray(names) || names.some(name => typeof name !== 'string' || /[\\/\0]/.test(name))))) throw new Error('Invalid removed-photo records.')
  if (data.titles && (!object(data.titles) || Object.values(data.titles).some(t => typeof t !== 'string' || t.length > 300))) throw new Error('Invalid collection titles.')
  return data
}
