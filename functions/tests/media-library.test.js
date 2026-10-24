import test from 'node:test'
import assert from 'node:assert/strict'
import { marked } from 'marked'
import { matchesMedia, mediaMarkdown, sortMedia } from '../../src/utils/mediaLibrary.js'

test('search finds original Unicode names and normalizes older renamed files', () => {
  const photo = { name: 'file-3.jpg', originalName: '假期 IMG_1234.JPG' }
  assert.ok(matchesMedia(photo, '假期'))
  assert.ok(matchesMedia(photo, 'IMG_1234.JPG'))
  assert.ok(matchesMedia(photo, 'file 3'))
  assert.ok(matchesMedia({ name: 'img-1234.jpg' }, 'IMG_1234.JPG'))
  assert.ok(matchesMedia(photo, ''))
  assert.equal(matchesMedia(photo, 'other'), false)
})
test('newest uploads appear first without mutating the library, with filename sorting available', () => {
  const files = [
    { name: 'a.jpg', uploaded: '2026-01-01', originalName: 'Zebra.jpg' },
    { name: 'z.jpg', uploaded: '2026-10-24', originalName: 'Apple.jpg' },
    { name: 'legacy.jpg' },
  ]
  assert.deepEqual(sortMedia(files).map(file => file.name), ['z.jpg', 'a.jpg', 'legacy.jpg'])
  assert.deepEqual(sortMedia(files, 'name').map(file => file.name), ['z.jpg', 'legacy.jpg', 'a.jpg'])
  assert.equal(files[0].name, 'a.jpg')
})
test('insertion uses original names without letting filename punctuation break Markdown', () => {
  const file = { name: 'photo.jpg', originalName: '假期 [one] <two>_*.jpg', url: 'https://media.example/photo.jpg' }
  const html = marked.parse(mediaMarkdown(file))
  assert.match(html, /alt="假期 \[one\] &lt;two&gt; \*"/)
  assert.equal((html.match(/<img /g) || []).length, 1)
  assert.doesNotMatch(html, /<two>/)
  assert.match(mediaMarkdown({ name: 'clip.mp4', url: 'https://media.example/clip.mp4' }), /^<video .*controls/)
})
