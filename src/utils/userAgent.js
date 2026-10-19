// Best-effort display only: browser headers can be reduced or customized.
export function compactUserAgent(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const browsers = [
    ['Edge', /(?:Edg|EdgA|EdgiOS)\/(\d+)/],
    ['Opera', /(?:OPR|OPiOS)\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari\//],
  ]
  let browser = null
  for (const [name, pattern] of browsers) {
    const match = value.match(pattern)
    if (match) { browser = `${name} ${match[1]}`; break }
  }
  const os = /iPhone|iPad|iPod/.test(value) ? 'iOS'
    : /Android/.test(value) ? 'Android'
    : /CrOS/.test(value) ? 'ChromeOS'
    : /Windows/.test(value) ? 'Windows'
    : /Macintosh|Mac OS X/.test(value) ? 'macOS'
    : /Linux/.test(value) ? 'Linux' : null
  return [browser, os].filter(Boolean).join(' · ') || null
}
