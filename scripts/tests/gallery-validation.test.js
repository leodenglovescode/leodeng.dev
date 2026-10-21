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
