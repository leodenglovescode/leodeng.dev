export const MODERN_ORIGIN = 'https://leodeng.dev'
export const LEGACY_ORIGIN = 'https://old.leodeng.dev'
export const LEGACY_PREFIX = '/_legacy'

// UA detection is deliberately limited to known unsupported browser versions.
// Crawlers keep the canonical site. A manual modern-site preference wins.
export function isLegacyBrowser(userAgent = '') {
  if (/bot\b|crawler|spider|slurp/i.test(userAgent)) return false
  const ios = userAgent.match(/(?:CPU(?: iPhone)? OS|iPhone OS) (\d+)[_.](\d+)/i)
  if (ios) return Number(ios[1]) < 16 || (Number(ios[1]) === 16 && Number(ios[2]) < 4)
  if (/MSIE\s|Trident\//i.test(userAgent)) return true
  const chrome = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/i)
  if (chrome) return Number(chrome[1]) < 111
  const firefox = userAgent.match(/Firefox\/(\d+)/i)
  if (firefox) return Number(firefox[1]) < 128
  const safari = userAgent.match(/Version\/(\d+)(?:\.(\d+))?.*Safari\//i)
  if (safari) return Number(safari[1]) < 16 || (Number(safari[1]) === 16 && Number(safari[2] || 0) < 4)
  return false
}

export function isDocumentRequest(request) {
  return ['GET', 'HEAD'].includes(request.method)
    && (request.headers.get('accept') || '').includes('text/html')
    && !/^\/(?:api|admin|assets|_legacy)(?:\/|$)/.test(new URL(request.url).pathname)
}

export function prefersModern(request) {
  return new URL(request.url).searchParams.get('view') === 'modern'
    || /(?:^|;\s*)site_view=modern(?:;|$)/.test(request.headers.get('cookie') || '')
}

export function cleanLegacyPath(pathname) {
  try {
    const decoded = decodeURIComponent(pathname)
    if (!decoded.startsWith('/') || /[\\\u0000-\u001f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return null
    return decoded.replace(/\/{2,}/g, '/')
  } catch { return null }
}

export function modernLink(pathname, search = '') {
  const url = new URL(MODERN_ORIGIN)
  url.pathname = pathname
  url.search = search
  url.searchParams.set('view', 'modern')
  return url.href
}
