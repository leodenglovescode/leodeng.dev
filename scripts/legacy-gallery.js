const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function legacyPhotoDetails(photo, zh = false) {
  const rows = []
  const add = (en, cn, value) => { if (value != null && value !== '') rows.push(`<dt>${zh ? cn : en}</dt><dd>${escape(value)}</dd>`) }
  const camera = photo.make && photo.camera && !photo.camera.toLowerCase().includes(photo.make.toLowerCase()) ? `${photo.make} ${photo.camera}` : photo.camera ?? photo.make
  if (photo.shotAt) add('Captured', '拍摄时间', photo.shotAt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'))
  add('Camera', '相机', camera)
  add('Lens', '镜头', photo.lens)
  if (photo.focalLength > 0) add('Focal length', '焦距', `${photo.focalLength} mm`)
  if (photo.aperture > 0) add('Aperture', '光圈', `f/${photo.aperture}`)
  if (photo.shutter > 0) add('Shutter speed', '快门速度', photo.shutter >= 1 ? `${Number(photo.shutter.toFixed(2))} s` : `1/${Math.round(1 / photo.shutter)} s`)
  if (photo.iso > 0) add('ISO', 'ISO', photo.iso)
  if (photo.width && photo.height) add('Original size', '原始尺寸', `${photo.width} × ${photo.height} px`)
  const { latitude, longitude } = photo.location ?? {}
  const gps = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  if (gps) {
    add('Latitude, longitude', '纬度、经度', `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
    const url = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`
    rows.push(`<dt>${zh ? '地图' : 'Map'}</dt><dd><a href="${escape(url)}">${zh ? '在地图上查看' : 'View on map'} &raquo;</a></dd>`)
  }
  return `<details class="legacy-photo-details"><summary>${zh ? '照片信息 / EXIF' : 'Photo details / EXIF'}</summary><dl>${rows.join('')}</dl>${gps ? '' : `<p>${zh ? '这张照片没有记录 GPS 坐标。' : 'No GPS coordinates recorded in this photo.'}</p>`}</details>`
}
