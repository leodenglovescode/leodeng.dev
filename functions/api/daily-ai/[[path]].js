import { readBoundedJson } from '../../../lib/nowPlaying.js'
import { DAILY_AI_IDS } from '../../../lib/daily-ai-questions.js'
import { banIp, clientIp, dailyDay, dailyDb, dailyJson, dailyUnavailable, exactKeys, foreignBrowser } from '../../../lib/daily-ai.js'

export async function onRequest({ request, env }) {
  try {
    // Refuse cross-site browser requests before creating bans: another site
    // must not be able to ban a visitor by embedding a link, image or form.
    if (foreignBrowser(request)) return dailyJson({ error: 'Use Daily AI on this website.' }, 403)
    const db = dailyDb(env)
    if (!db) return dailyJson({ error: 'Daily AI storage is not configured.' }, 503)
    const ip = clientIp(request)
    if (!ip) return dailyJson({ error: 'Client address is unavailable.' }, 503)
    if (await db.prepare('SELECT ip FROM daily_ai_bans WHERE ip = ?').bind(ip).first()) {
      return dailyJson({ error: 'This IP is permanently banned from Daily AI.', banned: true }, 403)
    }
    if (/(?:curl|python|httpx|aiohttp)/i.test(request.headers.get('user-agent') || '')) {
      return await banIp(db, ip, 'Blocked curl/Python user agent')
    }
    const url = new URL(request.url)
    if (!['/api/daily-ai', '/api/daily-ai/'].includes(url.pathname) || url.search
        || !['GET', 'POST'].includes(request.method)) return await banIp(db, ip, 'Malformed route, query, or method')

    let id = null
    if (request.method === 'POST') {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')
          || request.headers.get('x-daily-ai') !== '1') return await banIp(db, ip, 'Malformed request headers')
      const parsed = await readBoundedJson(request, 128)
      if (parsed.error || !exactKeys(parsed.value, ['id']) || !DAILY_AI_IDS.includes(parsed.value.id)) {
        return await banIp(db, ip, 'Malformed question selection')
      }
      id = parsed.value.id
    }

    const control = await db.prepare('SELECT enabled FROM daily_ai_control WHERE singleton = 1').first()
    if (!control?.enabled) return dailyJson({ enabled: false }, 503)
    const day = dailyDay()
    const batch = await db.prepare('SELECT day, model, answers, received_at FROM daily_ai_batch WHERE singleton = 1 AND day = ?').bind(day).first()
    if (!batch) return dailyJson({ enabled: true, ready: false, day })

    if (id) {
      // The primary key makes concurrent claims atomic. A visitor's IP and
      // question selection never become model input or reach the homelab.
      const result = await db.prepare(`INSERT OR IGNORE INTO daily_ai_reads (day, ip, question_id, created_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM daily_ai_control WHERE singleton = 1 AND enabled = 1)
        AND NOT EXISTS (SELECT 1 FROM daily_ai_bans WHERE ip = ?)
        AND EXISTS (SELECT 1 FROM daily_ai_batch WHERE singleton = 1 AND day = ?)`)
        .bind(day, ip, id, Date.now(), ip, day).run()
      if (!result.meta.changes) return dailyJson({ error: 'One question per IP per day. Refresh to reopen your selected answer.' }, 429)
    }

    // Recheck controls after a claim so a concurrent kill switch or ban wins.
    const allowed = await db.prepare(`SELECT enabled FROM daily_ai_control WHERE singleton = 1 AND enabled = 1
      AND NOT EXISTS (SELECT 1 FROM daily_ai_bans WHERE ip = ?)`).bind(ip).first()
    if (!allowed) return dailyJson({ error: 'Daily AI is unavailable.' }, 503)
    const selected = await db.prepare('SELECT question_id FROM daily_ai_reads WHERE day = ? AND ip = ?').bind(day, ip).first()
    const answers = JSON.parse(batch.answers)
    return dailyJson({ enabled: true, ready: true, day, model: batch.model, generatedAt: batch.received_at,
      selected: selected?.question_id || null,
      answer: selected ? answers.find(answer => answer.id === selected.question_id) : null })
  } catch (error) { return dailyUnavailable(error) }
}
