// Only publish the camera and location fields used by the gallery.
export function photoDetailsFromExif(tags = {}) {
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null
  const latitude = numeric(tags.latitude)
  const longitude = numeric(tags.longitude)
  return {
    make: tags.Make ?? null,
    camera: tags.Model ?? null,
    lens: tags.LensModel ?? null,
    focalLength: numeric(tags.FocalLength),
    aperture: numeric(tags.FNumber),
    iso: numeric(tags.ISO),
    shutter: numeric(tags.ExposureTime),
    location: latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? { latitude, longitude } : null,
  }
}
