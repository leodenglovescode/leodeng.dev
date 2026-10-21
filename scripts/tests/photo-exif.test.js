import { test } from 'node:test'
import assert from 'node:assert/strict'
import { photoDetailsFromExif } from '../lib/photo-exif.js'

test('GPS preserves zero and signed coordinates instead of treating zero as absent', () => {
  assert.deepEqual(photoDetailsFromExif({ latitude: 0, longitude: -73.9857 }).location, { latitude: 0, longitude: -73.9857 })
  assert.deepEqual(photoDetailsFromExif({ latitude: -33.8688, longitude: 151.2093 }).location, { latitude: -33.8688, longitude: 151.2093 })
})
test('missing, nonfinite, incomplete and out-of-range GPS never becomes a map location', () => {
  for (const tags of [{}, { latitude: 1 }, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 10 }, { latitude: 5, longitude: -181 }]) {
    assert.equal(photoDetailsFromExif(tags).location, null)
  }
})
test('camera settings stay numeric and missing EXIF is handled', () => {
  const data = photoDetailsFromExif({ Make: 'Google', Model: 'Pixel 7', FNumber: 1.85, ExposureTime: 1 / 125, ISO: 100 })
  assert.equal(data.camera, 'Pixel 7')
  assert.equal(data.aperture, 1.85)
  assert.equal(data.shutter, 1 / 125)
  assert.equal(photoDetailsFromExif().camera, null)
})
