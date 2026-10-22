import { json } from './auth.js'

export function dailyJson(body, status = 200) {
  return json(body, status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'vary': 'Cookie' })
}

export function dailyDb(env) {
  // Queries outside the Sessions API always use D1's primary, including every
  // control recheck. A first-primary session could use replicas after query one.
  return env.HOMELAB_DB
}

export function dailyDay(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

export function clientIp(request) {
  // Never trust X-Forwarded-For, query parameters, or a browser-provided identity.
  const value = request.headers.get('cf-connecting-ip') || ''
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split('.').map(Number)
    return parts.every(part => part <= 255) ? parts.join('.') : null
  }
  if (/^[a-f\d:]+$/i.test(value) && value.includes(':')) {
    try { return new URL(`http://[${value}]/`).hostname.slice(1, -1) } catch { /* Invalid IPv6. */ }
  }
  return null
}

export function foreignBrowser(request) {
  const origin = request.headers.get('origin')
  return request.headers.get('sec-fetch-site') === 'cross-site'
    || (origin !== null && origin !== new URL(request.url).origin)
}

export async function banIp(db, ip, reason) {
  await db.prepare('INSERT OR IGNORE INTO daily_ai_bans (ip, reason, created_at) VALUES (?, ?, ?)')
    .bind(ip, reason, Date.now()).run()
  return dailyJson({ error: 'This IP is permanently banned from Daily AI.', banned: true }, 403)
}

export function dailyUnavailable(error) {
  // Do not leak SQL, request bodies, IPs, or credentials into public responses.
  console.error(JSON.stringify({ event: 'daily_ai_unavailable', type: error?.name || 'Error' }))
  return dailyJson({ error: 'Daily AI is unavailable. Please try again later.' }, 503)
}
