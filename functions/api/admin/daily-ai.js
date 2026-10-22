import { chatRelay } from '../../../lib/cloud-ai-chat.js'
import { requireSession } from '../../../lib/auth.js'
import { readBoundedJson } from '../../../lib/nowPlaying.js'
import { clientIp, dailyDb, dailyJson, dailyUnavailable, exactKeys, foreignBrowser } from '../../../lib/daily-ai.js'

export async function onRequest({ request, env }) {
  try {
    if (foreignBrowser(request) || request.headers.get('x-admin') !== '1') return dailyJson({ error: 'Forbidden.' }, 403)
    if (!(await requireSession(request, env))) return dailyJson({ error: 'Sign in to manage AI chat.' }, 401)
    const db = dailyDb(env)
    if (!db) return dailyJson({ error: 'Chat storage is not configured.' }, 503)
    if (request.method === 'GET') {
      const offset = Number(new URL(request.url).searchParams.get('offset') || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return dailyJson({ error: 'Invalid page.' }, 400)
      const [control, bans, count, whitelist, state] = await Promise.all([
        db.prepare('SELECT enabled, revision FROM daily_ai_control WHERE singleton = 1').first(),
        db.prepare('SELECT ip, reason, created_at FROM daily_ai_bans ORDER BY created_at DESC, ip LIMIT 50 OFFSET ?').bind(offset).all(),
        db.prepare('SELECT COUNT(*) AS total FROM daily_ai_bans').first(),
        db.prepare('SELECT ip, created_at FROM daily_ai_whitelist ORDER BY created_at DESC LIMIT 1000').all(),
        chatRelay(env, 'status').then(async response => response.ok ? await response.json() : null).catch(() => null),
      ])
      return dailyJson({ enabled: Boolean(control?.enabled), revision: control?.revision, configured: Boolean(env.DEEPSEEK_API_KEY),
        model: 'deepseek-flash', bans: bans.results, total: count.total, whitelist: whitelist.results, offset, budget: state })
    }
    if (request.method !== 'POST' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return dailyJson({ error: 'Expected a JSON POST.' }, 405)
    const parsed = await readBoundedJson(request, 512)
    if (parsed.error) return dailyJson({ error: 'Invalid request.' }, 400)
    const body = parsed.value
    if ((exactKeys(body, ['resetAll']) && body.resetAll === true) || (exactKeys(body, ['enabled']) && typeof body.enabled === 'boolean')) {
      const reset = body.resetAll === true
      const statements = [reset
        ? db.prepare('UPDATE daily_ai_control SET revision = revision + 1, updated_at = ? WHERE singleton = 1').bind(Date.now())
        : db.prepare('UPDATE daily_ai_control SET enabled = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1').bind(Number(body.enabled), Date.now())]
      if (reset) statements.push(db.prepare('DELETE FROM daily_ai_chat_usage'), db.prepare('DELETE FROM daily_ai_bans'))
      await db.batch(statements)
      const control = await db.prepare('SELECT enabled, revision FROM daily_ai_control WHERE singleton = 1').first()
      const synced = await chatRelay(env, 'control', { enabled: Boolean(control.enabled), revision: control.revision, reset })
      if (!synced.ok) return dailyJson({ error: 'Controls saved. The cloud coordinator could not confirm cancellation; active requests also check D1. Retry this action.' }, 503)
      return dailyJson({ ok: true })
    }
    for (const action of ['unban', 'whitelist', 'removeWhitelist']) {
      if (!exactKeys(body, [action])) continue
      const ip = typeof body[action] === 'string' ? clientIp(new Request(request.url, { headers: { 'cf-connecting-ip': body[action] } })) : null
      if (!ip) return dailyJson({ error: 'Enter a valid IPv4 or IPv6 address.' }, 400)
      if (action === 'unban') await db.prepare('DELETE FROM daily_ai_bans WHERE ip = ?').bind(ip).run()
      if (action === 'whitelist') await db.batch([
        db.prepare('INSERT OR IGNORE INTO daily_ai_whitelist (ip, created_at) VALUES (?, ?)').bind(ip, Date.now()),
        db.prepare('DELETE FROM daily_ai_bans WHERE ip = ?').bind(ip),
      ])
      if (action === 'removeWhitelist') await db.prepare('DELETE FROM daily_ai_whitelist WHERE ip = ?').bind(ip).run()
      return dailyJson({ ok: true })
    }
    return dailyJson({ error: 'Choose a control, whitelist or unban action.' }, 400)
  } catch (error) { return dailyUnavailable(error) }
}
