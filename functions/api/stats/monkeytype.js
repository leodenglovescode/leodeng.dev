import { loadMonkeyStats } from '../../../lib/monkeyStats.js'

export async function onRequest(context) {
  const { request, env } = context
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } })
  if (new URL(request.url).search) return Response.json({ error: 'Invalid query' }, { status: 400, headers })
  const cache = globalThis.caches?.default
  const key = new Request(`https://leodeng.dev/api/stats/monkeytype?cache=${env.MONKEYTYPE_API_KEY ? 'connected' : 'public'}`)
  try { const cached = await cache?.match(key); if (cached) return cached } catch { /* Cache is optional. */ }
  const data = await loadMonkeyStats(env)
  const response = Response.json(data, { headers: { ...headers, 'Cache-Control': 'public, max-age=300' } })
  if (cache && context.waitUntil) context.waitUntil(cache.put(key, response.clone()).catch(() => {}))
  return response
}
