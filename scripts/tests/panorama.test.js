import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPanorama } from '../lib/panorama.js'

function xmp(values) {
  return Buffer.from(Object.entries(values).map(([key, value]) => `GPano:${key}="${value}"`).join(' '))
}
const complete = {
  ProjectionType: 'equirectangular', FullPanoWidthPixels: 8704, FullPanoHeightPixels: 4352,
  CroppedAreaImageWidthPixels: 8704, CroppedAreaImageHeightPixels: 4352,
  CroppedAreaLeftPixels: 0, CroppedAreaTopPixels: 0,
}
test('complete GPano images are spheres even without the Pixel filename', () => {
  const result = readPanorama(xmp(complete), 'holiday.jpg', 8704, 4352)
  assert.equal(result.kind, 'photosphere')
  assert.equal(result.panorama.top, 0)
})
test('a cropped Pixel panorama retains its full sphere dimensions and crop offset', () => {
  const result = readPanorama(xmp({ ...complete, FullPanoWidthPixels: 8422, FullPanoHeightPixels: 4211,
    CroppedAreaImageWidthPixels: 8422, CroppedAreaImageHeightPixels: 1582, CroppedAreaTopPixels: 1250 }),
  'PXL.PANO.jpg', 8422, 1582)
  assert.equal(result.kind, 'panorama')
  assert.equal(result.panorama.top, 1250)
  assert.equal(result.panorama.fullHeight, 4211)
})
test('ordinary photos are not mistaken for spheres based on their aspect ratio', () => {
  assert.equal(readPanorama(Buffer.from(''), 'holiday.jpg', 2000, 1000), null)
})
test('designated special images without GPano remain uncompressed flat panoramas', () => {
  assert.deepEqual(readPanorama(Buffer.from(''), 'wide.jpg', 6000, 1500, true), { kind: 'panorama' })
})
test('missing sphere metadata and impossible crops fail before processing', () => {
  assert.throws(() => readPanorama(Buffer.from(''), 'PXL.PHOTOSPHERE.jpg', 8704, 4352), /Missing/)
  assert.throws(() => readPanorama(xmp({ ...complete, CroppedAreaTopPixels: 1 }), 'sphere.jpg', 8704, 4352), /Invalid/)
})
