import { dailyJson, dailyUnavailable, writerAuthorized } from '../../../lib/daily-ai.js'

export async function onRequest({ request, env }) {
  try {
    if (!env.DAILY_AI_TOKEN || !(await writerAuthorized(request, env))) return dailyJson({ error: 'Unauthorized.' }, 401)
    if (!env.DAILY_AI_TRAFFIC) return dailyJson({ error: 'Relay unavailable.' }, 503)
    if (request.method !== 'GET' || new URL(request.url).search
        || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return dailyJson({ error: 'WebSocket required.' }, 400)
    return await env.DAILY_AI_TRAFFIC.fetch(new Request('https://daily-ai-traffic.internal/agent', { headers: { Upgrade: 'websocket' } }))
  } catch (error) { return dailyUnavailable(error) }
}
