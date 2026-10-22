import { json } from './auth.js'
import { DAILY_AI_IDS } from './daily-ai-questions.js'

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

export async function writerAuthorized(request, env) {
  if (!env.DAILY_AI_TOKEN) return false
  const token = request.headers.get('authorization') || ''
  const encoder = new TextEncoder()
  const hashes = await Promise.all([token, `Bearer ${env.DAILY_AI_TOKEN}`].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const left = new Uint8Array(hashes[0]), right = new Uint8Array(hashes[1])
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(left, right)
  let different = 0
  for (let index = 0; index < left.length; index++) different |= left[index] ^ right[index]
  return different === 0
}

export function validBatch(body, day) {
  if (!exactKeys(body, ['day', 'revision', 'model', 'answers']) || body.day !== day
      || !Number.isSafeInteger(body.revision) || body.revision < 0
      || typeof body.model !== 'string' || !/^[\w./:-]{1,120}$/.test(body.model)
      || !Array.isArray(body.answers) || body.answers.length !== DAILY_AI_IDS.length) return false
  const ids = new Set()
  for (const answer of body.answers) {
    if (!exactKeys(answer, ['id', 'text', 'sources']) || !DAILY_AI_IDS.includes(answer.id) || ids.has(answer.id)
        || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 5000
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answer.text)
        || !Array.isArray(answer.sources) || answer.sources.length < 1 || answer.sources.length > 6) return false
    ids.add(answer.id)
    for (const source of answer.sources) {
      if (typeof source !== 'string' || source.length > 240
          || !/^\/(?:homelab|tokens|now|projects|gallery(?:\/[a-z0-9-]+)?|spotting|stack|ai|blog(?:\/[a-z0-9-]+)?)$/.test(source)) return false
    }
  }
  return true
}

export function dailyUnavailable(error) {
  // Do not leak SQL, request bodies, IPs, or credentials into public responses.
  console.error(JSON.stringify({ event: 'daily_ai_unavailable', type: error?.name || 'Error' }))
  return dailyJson({ error: 'Daily AI is unavailable. Refresh to check your selection.' }, 503)
}
