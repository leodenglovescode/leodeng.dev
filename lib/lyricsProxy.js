// Fixed, public LRCLIB lookup for browsers that cannot connect to its HTTPS
// endpoint themselves. No cookies, credentials, arbitrary URLs, or writes.
function json(body, status = 200, ttl = 0) {
  return Response.json(body, { status, headers: {
    'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}

export async function lookupLyrics(request, fetchUpstream = fetch) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
  const params = new URL(request.url).searchParams
  const names = new Set(['track_name', 'artist_name', 'album_name', 'duration'])
  for (const key of params.keys()) if (!names.has(key) || params.getAll(key).length !== 1) return json({ error: 'Invalid query' }, 400)
  const url = new URL('https://lrclib.net/api/get')
  for (const key of ['track_name', 'artist_name', 'album_name']) {
    const value = (params.get(key) || '').trim()
    if (value.length > 300 || /[\u0000-\u001f]/.test(value) || (key !== 'album_name' && !value)) return json({ error: 'Invalid track' }, 400)
    if (value) url.searchParams.set(key, value)
  }
  const duration = Number(params.get('duration'))
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) return json({ error: 'Invalid duration' }, 400)
  url.searchParams.set('duration', String(duration))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  let reader
  try {
    const response = await fetchUpstream(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'leodeng.dev classic player (https://leodeng.dev)' } })
    if (response.status === 404) return json({ syncedLyrics: null }, 200, 600)
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Unavailable')
    reader = response.body.getReader()
    const chunks = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 256000) throw new Error('Oversized response')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const data = JSON.parse(new TextDecoder().decode(bytes))
    const lyrics = typeof data.syncedLyrics === 'string' && data.syncedLyrics.length <= 100000 && !data.instrumental
      && typeof data.duration === 'number' && Math.abs(data.duration - duration) <= 2 ? data.syncedLyrics : null
    return json({ syncedLyrics: lyrics, duration: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : null, instrumental: data.instrumental === true }, 200, lyrics ? 86400 : 600)
  } catch { return json({ error: 'Lyrics unavailable' }, 503) }
  finally {
    clearTimeout(timeout)
    controller.abort()
    if (reader) await reader.cancel().catch(() => {})
  }
}
