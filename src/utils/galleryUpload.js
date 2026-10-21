import { newContentId } from './adminApi.js'
import { readPanorama } from '../../scripts/lib/panorama.js'
import { photoDetailsFromExif } from '../../scripts/lib/photo-exif.js'

export const COMPRESSION = {
  original: { label: 'Original (no compression)', edge: null, quality: null },
  normal: { label: 'Normal', edge: 2200, quality: 0.82 },
  maximum: { label: 'Maximum', edge: 1600, quality: 0.55 },
}
export function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser cannot decode this image. Use a JPEG, PNG, or WebP file.')) }
    image.src = url
  })
}
export async function inspectGalleryPhoto(file) {
  if (/\.(?:mp4|webm)$/i.test(file.name)) return inspectGalleryVideo(file)
  if (!/\.(?:jpe?g|png|webp)$/i.test(file.name)) throw new Error('Choose a JPEG, PNG, or WebP photo.')
  if (!file.size || file.size > 95 * 1024 * 1024) throw new Error('Photos must be smaller than 95 MB.')
  const image = await loadPhoto(file)
  const exifr = await import('exifr')
  let tags = {}
  try { tags = await exifr.parse(file, { gps: true, reviveValues: false }) ?? {} } catch { /* Manual metadata is available for images without EXIF. */ }
  const width = image.naturalWidth, height = image.naturalHeight
  const text = new TextDecoder('latin1').decode(await file.arrayBuffer())
  const special = readPanorama(text, file.name, width, height)
  return {
    name: `upload-${newContentId()}`, width, height,
    kind: special?.kind ?? 'photo', detectedKind: special?.kind ?? 'photo', ...(special?.panorama ? { panorama: special.panorama } : {}),
    shotAt: typeof tags.DateTimeOriginal === 'string' ? tags.DateTimeOriginal : null,
    ...photoDetailsFromExif(tags),
  }
}
async function encode(image, edge, mime, quality) {
  const width = image.naturalWidth || image.videoWidth, height = image.naturalHeight || image.videoHeight
  const scale = edge ? Math.min(1, edge / Math.max(width, height)) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image processing is unavailable in this browser.')
  if (mime === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality))
  canvas.width = 1; canvas.height = 1
  if (!blob || blob.type !== mime) throw new Error(`This browser cannot encode ${mime}.`)
  return blob
}
export async function prepareGalleryPhoto(file, entry, compression) {
  if (entry.kind === 'video') return prepareGalleryVideo(file, entry)
  const image = await loadPhoto(file)
  const special = entry.kind !== 'photo' || entry.detectedKind && entry.detectedKind !== 'photo'
  const mode = special ? 'original' : compression
  const preset = COMPRESSION[mode]
  if (!preset) throw new Error('Choose a compression level.')
  const id = newContentId()
  const prefix = `gallery-${id}`
  const jobs = []
  const add = (key, blob) => { jobs.push({ key, blob }); return key }
  const assets = { thumb: add(`${prefix}-thumb.webp`, await encode(image, 640, 'image/webp', 0.75)) }
  const originalExtension = file.name.match(/\.([^.]+)$/)[1].toLowerCase()
  const full = mode === 'original' ? file : await encode(image, preset.edge, 'image/webp', preset.quality)
  assets.full = add(`${prefix}-full.${mode === 'original' ? originalExtension : 'webp'}`, full)
  assets.legacyThumb = add(`${prefix}-legacy-thumb.jpg`, await encode(image, 640, 'image/jpeg', 0.82))
  if (mode === 'original' && /^(jpg|jpeg|png)$/.test(originalExtension)) assets.legacyFull = assets.full
  else assets.legacyFull = add(`${prefix}-legacy-full.jpg`, await encode(image, preset.edge, 'image/jpeg', mode === 'original' ? 0.92 : preset.quality))
  return { entry: { ...entry, assets, compression: mode,
    ...(special ? { original: `${entry.name}.${originalExtension}` } : {}) }, jobs, fullBytes: full.size,
    totalBytes: jobs.reduce((total, job) => total + job.blob.size, 0) }
}
export function parseShutter(value) {
  if (value === '' || value == null) return null
  const fraction = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value)
}

// Decode a real frame before uploading so an unsupported codec fails locally.
async function withVideo(file, callback) {
  if (!file.size || file.size > 95 * 1024 * 1024) throw new Error('Videos must be smaller than 95 MB. Trim longer clips before uploading.')
  const video = document.createElement('video')
  const url = URL.createObjectURL(file)
  video.muted = true; video.playsInline = true; video.preload = 'auto'
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(new Error('Video preview timed out. Try an MP4 encoded with H.264.')), 20000)
      const done = error => { clearTimeout(timeout); video.onloadeddata = null; video.onerror = null; error ? reject(error) : resolve() }
      video.onloadeddata = () => done()
      video.onerror = () => done(new Error('This browser cannot play this video. Use an MP4 encoded with H.264, or a supported WebM.'))
      video.src = url
    })
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Video dimensions or duration could not be read.')
    if (video.duration > 0.1) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(new Error('Could not prepare a video poster.')), 10000)
      const done = error => { clearTimeout(timeout); video.onseeked = null; video.onerror = null; error ? reject(error) : resolve() }
      video.onseeked = () => done(); video.onerror = () => done(new Error('Could not decode a video frame.'))
      video.currentTime = Math.min(1, video.duration / 10)
    })
    return await callback(video)
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
}
async function inspectGalleryVideo(file) {
  return withVideo(file, video => ({ name: `upload-${newContentId()}`, kind: 'video', detectedKind: 'video', width: video.videoWidth, height: video.videoHeight, duration: video.duration, shotAt: null, caption: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }))
}
async function prepareGalleryVideo(file, entry) {
  return withVideo(file, async video => {
    const prefix = `gallery-${newContentId()}`, jobs = []
    const add = (key, blob) => { jobs.push({ key, blob }); return key }
    const extension = file.name.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4'
    const type = extension === 'webm' ? 'video/webm' : 'video/mp4'
    const assets = {
      full: add(`${prefix}-full.${extension}`, file.slice(0, file.size, type)),
      thumb: add(`${prefix}-thumb.webp`, await encode(video, 640, 'image/webp', 0.75)),
      legacyThumb: add(`${prefix}-legacy-thumb.jpg`, await encode(video, 640, 'image/jpeg', 0.82)),
      poster: add(`${prefix}-poster.jpg`, await encode(video, 1280, 'image/jpeg', 0.85)),
    }
    assets.legacyFull = assets.full
    return { entry: { ...entry, assets, compression: 'original' }, jobs, fullBytes: file.size, totalBytes: jobs.reduce((total, job) => total + job.blob.size, 0) }
  })
}
