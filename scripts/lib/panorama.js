// GPano describes the captured rectangle within a complete equirectangular sphere.
// Keep this metadata separate from EXIF so originals can be uploaded byte for byte.
export function readPanorama(buffer, filename, width, height, preserve = false) {
  const xmp = typeof buffer === 'string' ? buffer : buffer.toString('latin1')
  const fields = Object.fromEntries([...xmp.matchAll(/GPano:(\w+)(?:="([^"]*)"|>([^<]*)<)/g)]
    .map(m => [m[1], m[2] ?? m[3]]))
  const sphere = /\.PHOTOSPHERE\./i.test(filename) || fields.IsPhotosphere === 'True'
  const special = sphere || /\.PANO\./i.test(filename) || fields.ProjectionType === 'equirectangular' || preserve
  if (!special) return null
  if (fields.ProjectionType !== 'equirectangular') {
    if (sphere) throw new Error(`Missing spherical projection metadata: ${filename}`)
    return { kind: 'panorama' } // A conventional wide panorama gets a flat pan view.
  }
  const number = (key, fallback) => Number(fields[key] ?? fallback)
  const panorama = {
    fullWidth: number('FullPanoWidthPixels', width),
    fullHeight: number('FullPanoHeightPixels', height),
    width: number('CroppedAreaImageWidthPixels', width),
    height: number('CroppedAreaImageHeightPixels', height),
    left: number('CroppedAreaLeftPixels', 0),
    top: number('CroppedAreaTopPixels', 0),
  }
  if (!Object.values(panorama).every(Number.isFinite) || panorama.fullWidth <= 0 || panorama.fullHeight <= 0 ||
      panorama.width !== width || panorama.height !== height || panorama.left < 0 || panorama.top < 0 ||
      panorama.left + width > panorama.fullWidth || panorama.top + height > panorama.fullHeight) {
    throw new Error(`Invalid spherical crop metadata: ${filename}`)
  }
  const complete = panorama.width === panorama.fullWidth && panorama.height === panorama.fullHeight
  return { kind: complete ? 'photosphere' : 'panorama', panorama }
}
