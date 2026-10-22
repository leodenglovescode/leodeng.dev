import { cloudChat, validChatInput } from '../../../lib/cloud-ai-chat.js'
import { readBoundedJson } from '../../../lib/nowPlaying.js'
import { banIp, clientIp, dailyDb, dailyJson, dailyUnavailable, foreignBrowser } from '../../../lib/daily-ai.js'

export async function onRequest(context) {
  const { request, env } = context
  try {
    // Refuse cross-site browser requests before creating bans: another site
    // must not be able to ban a visitor by embedding a link, image or form.
    if (foreignBrowser(request)) return dailyJson({ error: 'Use Daily AI on this website.' }, 403)
    const ip = clientIp(request)
    if (!ip) return dailyJson({ error: 'Client address is unavailable.' }, 503)
    // All visitor reads and writes, on every Pages hostname, pass the private
    // edge limiter before any D1 query. Never forward visitor headers/body.
    if (!env.DAILY_AI_TRAFFIC) return dailyJson({ error: 'Daily AI traffic protection is unavailable.' }, 503)
    const gate = await env.DAILY_AI_TRAFFIC.fetch('https://daily-ai-traffic.internal/', {
      headers: { 'cf-connecting-ip': ip }, signal: AbortSignal.timeout(3000),
    })
    if (gate.status === 429) {
      const response = dailyJson({ error: 'Too many requests. Try again in a minute.', code: 'traffic_limited' }, 429)
      response.headers.set('retry-after', '60')
      return response
    }
    if (gate.status !== 204) return dailyJson({ error: 'Daily AI traffic protection is unavailable.' }, 503)
    const db = dailyDb(env)
    if (!db) return dailyJson({ error: 'Daily AI storage is not configured.' }, 503)
    if (await db.prepare('SELECT ip FROM daily_ai_bans WHERE ip = ?').bind(ip).first()) {
      return dailyJson({ error: 'This IP is permanently banned from Daily AI.', banned: true }, 403)
    }
    if (/(?:curl|python|httpx|aiohttp)/i.test(request.headers.get('user-agent') || '')) {
      return await banIp(db, ip, 'Blocked curl/Python user agent')
    }
    const url = new URL(request.url)
    if (!['/api/daily-ai', '/api/daily-ai/'].includes(url.pathname) || url.search
        || !['GET', 'POST'].includes(request.method)) return await banIp(db, ip, 'Malformed route, query, or method')

    let body = null
    if (request.method === 'POST') {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')
          || request.headers.get('x-daily-ai') !== '1') return await banIp(db, ip, 'Malformed request headers')
      const parsed = await readBoundedJson(request, 8192)
      if (parsed.error || !validChatInput(parsed.value)) {
        return await banIp(db, ip, 'Malformed chat message')
      }
      body = parsed.value
    }

    const control = await db.prepare('SELECT enabled, revision FROM daily_ai_control WHERE singleton = 1').first()
    if (!control?.enabled) return dailyJson({ enabled: false }, 503)
    const whitelisted = Boolean(await db.prepare('SELECT ip FROM daily_ai_whitelist WHERE ip = ?').bind(ip).first())
    return await cloudChat(context, db, ip, body, control, whitelisted)
  } catch (error) { return dailyUnavailable(error) }
}
