import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyPhotoDetails } from '../legacy-gallery.js'

test('legacy GPS includes zero latitude, negative longitude and a valid map link', () => {
  const html = legacyPhotoDetails({ make: 'Google', camera: 'Pixel 7', location: { latitude: 0, longitude: -73.9857 } })
  assert.match(html, /Google Pixel 7/)
  assert.match(html, /0\.000000, -73\.985700/)
  assert.match(html, /mlat=0&amp;mlon=-73.9857/)
})
test('legacy photo details escape EXIF strings and omit invalid locations', () => {
  const html = legacyPhotoDetails({ camera: '<script>bad</script>', location: { latitude: NaN, longitude: 1 } }, true)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /没有记录 GPS/)
  assert.doesNotMatch(html, /openstreetmap/)
})
