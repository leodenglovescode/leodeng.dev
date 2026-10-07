export const DEFAULT_LOCALE = 'en'
export const CHINESE_LOCALE = 'zh'
export const CHINESE_PREFIX = '/zh'

export function localeFromPath(path = '/') {
  return path === CHINESE_PREFIX || path.startsWith(`${CHINESE_PREFIX}/`)
    ? CHINESE_LOCALE
    : DEFAULT_LOCALE
}

export function stripLocalePath(path = '/') {
  if (path === CHINESE_PREFIX) return '/'
  if (path.startsWith(`${CHINESE_PREFIX}/`)) return path.slice(CHINESE_PREFIX.length) || '/'
  return path || '/'
}

export function localePath(path = '/', targetLocale = DEFAULT_LOCALE) {
  if (!path || /^(?:[a-z]+:|#)/i.test(path)) return path

  const match = path.match(/^([^?#]*)(.*)$/)
  const pathname = stripLocalePath(match?.[1] || '/')
  const suffix = match?.[2] || ''
  if (targetLocale === CHINESE_LOCALE) {
    return `${pathname === '/' ? CHINESE_PREFIX : `${CHINESE_PREFIX}${pathname}`}${suffix}`
  }
  return `${pathname}${suffix}`
}
