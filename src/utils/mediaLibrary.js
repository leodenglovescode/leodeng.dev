// Match both the displayed original name and older URL-safe upload names.
const normalized = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export function matchesMedia(file, query) {
  const q = normalized(query)
  return !q || [file.originalName, file.name].some(name => normalized(name).includes(q))
}

export function mediaMarkdown(file) {
  if (/\.(mp4|webm|mov)$/i.test(file.name)) {
    return `<video src="${file.url}" controls preload="metadata" playsinline class="w-full rounded-lg"></video>\n`
  }
  const alt = (file.originalName || file.name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    .replace(/[\\\[\]<>`*_]/g, '\\$&').replace(/[\r\n]/g, ' ')
  return `![${alt}](${file.url})\n`
}

export function sortMedia(files, order = 'newest') {
  return [...files].sort((a, b) => order === 'name'
    ? (a.originalName || a.name).localeCompare(b.originalName || b.name)
    : (Date.parse(b.uploaded) || 0) - (Date.parse(a.uploaded) || 0) || a.name.localeCompare(b.name))
}
