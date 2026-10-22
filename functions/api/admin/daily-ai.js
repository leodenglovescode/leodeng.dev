import { requireSession } from '../../../lib/auth.js'
import { readBoundedJson } from '../../../lib/nowPlaying.js'
import { clientIp, dailyDb, dailyJson, dailyUnavailable, exactKeys, foreignBrowser } from '../../../lib/daily-ai.js'

export async function onRequest({ request, env }) {
  try {
    if (foreignBrowser(request) || request.headers.get('x-admin') !== '1') return dailyJson({ error: 'Forbidden.' }, 403)
    if (!(await requireSession(request, env))) return dailyJson({ error: 'Sign in to manage Daily AI.' }, 401)
    const db = dailyDb(env)
    if (!db) return dailyJson({ error: 'Daily AI storage is not configured.' }, 503)
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const offset = Number(url.searchParams.get('offset') || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return dailyJson({ error: 'Invalid page.' }, 400)
      const [control, batch, bans, count] = await Promise.all([
        db.prepare('SELECT enabled, revision, updated_at FROM daily_ai_control WHERE singleton = 1').first(),
        db.prepare('SELECT day, model, received_at FROM daily_ai_batch WHERE singleton = 1').first(),
        db.prepare('SELECT ip, reason, created_at FROM daily_ai_bans ORDER BY created_at DESC, ip LIMIT 50 OFFSET ?').bind(offset).all(),
        db.prepare('SELECT COUNT(*) AS total FROM daily_ai_bans').first(),
      ])
      return dailyJson({ enabled: Boolean(control?.enabled), revision: control?.revision, batch, bans: bans.results, total: count.total, offset })
    }
    if (request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) return dailyJson({ error: 'Expected a JSON POST.' }, 405)
    const parsed = await readBoundedJson(request, 512)
    if (parsed.error) return dailyJson({ error: 'Invalid request.' }, 400)
    const body = parsed.value
    if (exactKeys(body, ['enabled']) && typeof body.enabled === 'boolean') {
      await db.prepare('UPDATE daily_ai_control SET enabled = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1')
        .bind(body.enabled ? 1 : 0, Date.now()).run()
      return dailyJson({ ok: true, enabled: body.enabled })
    }
    if (exactKeys(body, ['unban']) && typeof body.unban === 'string'
        && clientIp(new Request(request.url, { headers: { 'cf-connecting-ip': body.unban } })) === body.unban) {
      await db.prepare('DELETE FROM daily_ai_bans WHERE ip = ?').bind(body.unban).run()
      return dailyJson({ ok: true })
    }
    return dailyJson({ error: 'Choose an enable/disable action or an IP to unban.' }, 400)
  } catch (error) { return dailyUnavailable(error) }
}
