import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateGalleryManifest, validatePhotoMetadata } from '../../lib/gallery-validation.js'
const asset = suffix => `gallery-12345678-1234-4234-8234-123456789abc-${suffix}`
const manifest = () => ({ base: 'https://media.leodeng.dev', prefix: 'photos', titles: { trips: 'Trips' }, collections: { trips: [{ name: 'one', kind: 'photo', assets: {
  thumb: asset('thumb.webp'), full: asset('full.jpg'), legacyThumb: asset('legacy-thumb.jpg'), legacyFull: asset('full.jpg'),
}, metadata: { caption: 'A photo', location: { latitude: 0, longitude: -1 } } }] } })
test('gallery accepts immutable asset references and zero coordinates', () => assert.equal(validateGalleryManifest(manifest()).collections.trips.length, 1))
test('gallery rejects duplicate names, traversal assets, and invalid coordinates', () => {
  const duplicate = manifest(); duplicate.collections.trips.push(duplicate.collections.trips[0]); assert.throws(() => validateGalleryManifest(duplicate), /duplicate/)
  const traversal = manifest(); traversal.collections.trips[0].assets.full = '../secrets.jpg'; assert.throws(() => validateGalleryManifest(traversal), /assets/)
  assert.throws(() => validatePhotoMetadata({ location: { latitude: 91, longitude: 0 } }), /latitude/)
  assert.throws(() => validatePhotoMetadata({ shutter: Infinity }), /positive/)
})

test('featured works must be unique, exist, and fit five slots', () => {
  const data = manifest()
  data.featured = [{ collection: 'trips', name: 'one' }]
  assert.equal(validateGalleryManifest(data).featured.length, 1)
  data.featured.push({ collection: 'trips', name: 'one' })
  assert.throws(() => validateGalleryManifest(data), /Duplicate featured/)
  data.featured = [{ collection: 'trips', name: 'missing' }]
  assert.throws(() => validateGalleryManifest(data), /must exist/)
  for (let i = 2; i <= 5; i++) data.collections.trips.push({ name: `work-${i}` })
  data.featured = data.collections.trips.map(entry => ({ collection: 'trips', name: entry.name }))
  assert.equal(validateGalleryManifest(data).featured.length, 5)
  data.featured = Array(6).fill({ collection: 'trips', name: 'one' })
  assert.throws(() => validateGalleryManifest(data), /five/)
})
test('videos require safe video assets, an image poster, and readable dimensions and duration', () => {
  const data = manifest(), video = data.collections.trips[0]
  Object.assign(video, { kind: 'video', width: 1920, height: 1080, duration: 12.5 })
  video.assets.full = video.assets.legacyFull = asset('full.mp4')
  video.assets.poster = asset('poster.jpg')
  assert.equal(validateGalleryManifest(data).collections.trips[0].kind, 'video')
  video.assets.thumb = asset('full.mp4')
  assert.throws(() => validateGalleryManifest(data), /assets/)
  video.assets.thumb = asset('thumb.webp')
  video.duration = Infinity
  assert.throws(() => validateGalleryManifest(data), /video/)
  video.duration = 12.5
  delete video.assets.poster
  assert.throws(() => validateGalleryManifest(data), /poster/)
})
