const unavailable = () => Response.json({ error: 'Lyrics temporarily unavailable' }, {
  status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
})

export function canonicalLyricsIp(value) {
  if (!value || value.length > 64) return null
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split('.').every(n => Number(n) <= 255) ? value.split('.').map(Number).join('.') : null
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(':')) return null
  try { return new URL(`http://[${value}]/`).hostname.toLowerCase() } catch { return null }
}

export async function lyricsLimiter(request, env) {
  const ip = canonicalLyricsIp(request.headers.get('CF-Connecting-IP'))
  const secret = env?.LYRICS_IP_HASH_KEY
  if (!ip || typeof secret !== 'string' || secret.length < 32 || !env?.LYRICS_TRAFFIC) return { check: async () => unavailable() }
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(ip))
    const identity = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    const stub = env.LYRICS_TRAFFIC.get(env.LYRICS_TRAFFIC.idFromName('public-lyrics-v1'))
    return { async check(phase) {
      try {
        const response = await stub.fetch('https://lyrics-limit.internal/check', {
          method: 'POST', body: JSON.stringify({ phase, identity }), signal: AbortSignal.timeout(2000),
        })
        if (response.status === 204) return null
        if (response.status === 429) {
          const retry = Math.min(60, Math.max(1, Number(response.headers.get('Retry-After')) || 30))
          return Response.json({ error: 'Too many lyrics requests' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retry) } })
        }
      } catch { /* Fail closed so outages cannot bypass either upstream budget. */ }
      return unavailable()
    } }
  } catch { return { check: async () => unavailable() } }
}
