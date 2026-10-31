// Both players use this boundary. Upstream destinations come only from server
// configuration; browser headers, credentials and arbitrary URLs never pass through.
function json(body, status = 200, ttl = 0, source) {
  return Response.json(body, { status, headers: {
    'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(source ? { 'X-Lyrics-Source': source } : {}),
  } })
}

export function lyricsQuery(request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
  if (request.url.length > 6000) return json({ error: 'Invalid query' }, 400)
  const params = new URL(request.url).searchParams
  const names = new Set(['track_name', 'artist_name', 'album_name', 'duration'])
  for (const key of params.keys()) if (!names.has(key) || params.getAll(key).length !== 1) return json({ error: 'Invalid query' }, 400)
  const query = new URLSearchParams()
  for (const key of ['track_name', 'artist_name', 'album_name']) {
    const value = (params.get(key) || '').trim()
    if (value.length > 300 || /[\u0000-\u001f\u007f]/.test(value) || (key !== 'album_name' && !value)) return json({ error: 'Invalid track' }, 400)
    if (value) query.set(key, value)
  }
  const duration = Number(params.get('duration'))
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) return json({ error: 'Invalid duration' }, 400)
  query.set('duration', String(duration))
  return { query, duration }
}

export function localLyricsSource(env = {}, { allowLocalHttp = false } = {}) {
  if (!env.LYRICS_LOCAL_URL) return null
  try {
    const url = new URL(env.LYRICS_LOCAL_URL)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    const localHttp = allowLocalHttp && loopback && url.protocol === 'http:'
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/api/get') throw new Error()
    const token = env.LYRICS_LOCAL_TOKEN
    if (typeof token !== 'string' || token.length < 32 || token.length > 1024 || /[^\x21-\x7e]/.test(token)) throw new Error()
    const headers = { Authorization: `Bearer ${token}` }
    if (!localHttp) {
      for (const [key, name] of [['LYRICS_ACCESS_CLIENT_ID', 'CF-Access-Client-Id'], ['LYRICS_ACCESS_CLIENT_SECRET', 'CF-Access-Client-Secret']]) {
        const value = env[key]
        if (typeof value !== 'string' || !value || value.length > 1024 || /[^\x21-\x7e]/.test(value)) throw new Error()
        headers[name] = value
      }
    }
    return { url: url.href, headers }
  } catch {
    // Fail closed on incomplete credentials or unsafe configuration. No URL or secret in logs.
    console.warn(JSON.stringify({ event: 'lyrics_local_configuration_invalid' }))
    return null
  }
}

async function readSource(url, headers, duration, fetchUpstream, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let reader, body
  let retryAfter = 30, status
  try {
    // Manual mode refuses redirects without forwarding credentials elsewhere.
    const response = await fetchUpstream(url, { signal: controller.signal, redirect: 'manual', headers: {
      Accept: 'application/json', 'User-Agent': 'leodeng.dev lyrics (https://leodeng.dev)', ...headers,
    } })
    body = response.body
    status = response.status
    if (response.status === 429 || response.status === 503) {
      const value = response.headers.get('retry-after')
      const seconds = value && (/^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000))
      retryAfter = Math.max(60, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 604800) : 60)
    }
    if (response.status === 404) return { missing: true }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json') || !body) throw new Error()
    reader = body.getReader()
    const chunks = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 256000) throw new Error()
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const data = JSON.parse(new TextDecoder().decode(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    const matches = typeof data.duration === 'number' && Number.isFinite(data.duration) && Math.abs(data.duration - duration) <= 2
    const instrumental = matches && data.instrumental === true
    const lyrics = matches && !instrumental && typeof data.syncedLyrics === 'string' && data.syncedLyrics.length <= 100000 && /\[\d{1,3}:[0-5]\d(?:\.\d{1,3})?\]/.test(data.syncedLyrics)
      ? data.syncedLyrics : null
    return { value: { syncedLyrics: lyrics, duration: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : null, instrumental }, usable: !!lyrics || instrumental }
  } catch {
    return { unavailable: true, retryAfter, rateLimited: status === 429 }
  } finally {
    clearTimeout(timeout)
    controller.abort()
    if (reader) await reader.cancel().catch(() => {})
    else if (body) await body.cancel().catch(() => {})
  }
}

export async function lookupLyrics(request, fetchUpstream = fetch, { local } = {}) {
  const parsed = lyricsQuery(request)
  if (parsed instanceof Response) return parsed
  const { query, duration } = parsed
  if (local) {
    const result = await readSource(`${local.url}?${query}`, local.headers, duration, fetchUpstream, 1500)
    if (result.usable) return json(result.value, 200, 86400, 'local')
    // Respect the gateway's load budget instead of redirecting a request flood to LRCLIB.
    if (result.rateLimited) {
      const response = json({ error: 'Lyrics unavailable' }, 503)
      response.headers.set('Retry-After', String(result.retryAfter))
      return response
    }
  }
  // Construct a fresh header set: gateway and Access credentials must never reach LRCLIB.
  const result = await readSource(`https://lrclib.net/api/get?${query}`, {}, duration, fetchUpstream, 4500)
  if (result.missing) return json({ syncedLyrics: null }, 200, 600, 'lrclib')
  if (result.value) return json(result.value, 200, result.usable ? 86400 : 600, 'lrclib')
  const response = json({ error: 'Lyrics unavailable' }, 503)
  response.headers.set('Retry-After', String(result.retryAfter))
  return response
}
