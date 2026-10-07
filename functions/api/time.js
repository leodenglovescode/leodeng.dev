import { validClockSample } from '../../lib/clock.js'

const ORIGIN = 'https://clock-origin.leodeng.dev/time'
const MAX_BYTES = 2048

function json(body, status, extra = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    ...extra,
  } })
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' })
  if (new URL(request.url).search || request.headers.has('transfer-encoding')
      || Number(request.headers.get('content-length') || 0) !== 0) {
    return json({ error: 'Invalid request' }, 400)
  }
  if (!env.CLOCK_ACCESS_CLIENT_ID || !env.CLOCK_ACCESS_CLIENT_SECRET) {
    console.warn(JSON.stringify({ event: 'clock_unavailable', phase: 'configuration' }))
    return json({ error: 'Clock unavailable' }, 503)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  let reader
  let phase = 'origin_fetch'
  let upstreamStatus = null
  try {
    const upstream = await fetch(ORIGIN, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'CF-Access-Client-Id': env.CLOCK_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': env.CLOCK_ACCESS_CLIENT_SECRET,
      },
    })
    upstreamStatus = upstream.status
    phase = 'origin_response'
    if (upstream.status === 429) {
      const retry = Number(upstream.headers.get('retry-after'))
      return json({ error: 'Clock busy' }, 429, {
        'Retry-After': String(Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60),
      })
    }
    if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('application/json')
        || !upstream.body) throw new Error('Invalid origin response')
    reader = upstream.body.getReader()
    phase = 'origin_body'
    const chunks = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BYTES) throw new Error('Oversized origin response')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let position = 0
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length }
    const body = JSON.parse(new TextDecoder().decode(bytes))
    phase = 'clock_health'
    if (!validClockSample(body)) throw new Error('Unhealthy clock')
    // Reconstruct the response; never pass through headers, diagnostics or strings.
    return json({
      receivedAtMs: body.receivedAtMs, sentAtMs: body.sentAtMs,
      synchronized: true, source: 'gps-pps', stratum: 1,
    }, 200)
  } catch {
    // Fixed metadata only: never log upstream bodies, headers or exception text.
    console.warn(JSON.stringify({ event: 'clock_unavailable', phase, upstreamStatus,
      timedOut: controller.signal.aborted }))
    return json({ error: 'Clock unavailable' }, 503)
  } finally {
    clearTimeout(timeout)
    controller.abort()
    if (reader) await reader.cancel().catch(() => {})
  }
}
