import { readBoundedJson } from '../../../lib/nowPlaying.js'
import { dailyDay, dailyDb, dailyJson, dailyUnavailable, validBatch, writerAuthorized } from '../../../lib/daily-ai.js'

export async function onRequest({ request, env }) {
  try {
    if (!env.DAILY_AI_TOKEN) return dailyJson({ error: 'Daily AI publishing is not configured.' }, 503)
    if (!(await writerAuthorized(request, env))) return dailyJson({ error: 'Unauthorized.' }, 401)
    const db = dailyDb(env)
    if (!db) return dailyJson({ error: 'Daily AI storage is not configured.' }, 503)
    if (request.method === 'GET') {
      const control = await db.prepare('SELECT enabled, revision FROM daily_ai_control WHERE singleton = 1').first()
      const latest = await db.prepare('SELECT day FROM daily_ai_batch WHERE singleton = 1').first()
      return dailyJson({ enabled: Boolean(control?.enabled), revision: control?.revision, day: dailyDay(), publishedDay: latest?.day || null })
    }
    if (request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) return dailyJson({ error: 'Expected a JSON POST.' }, 405)
    const parsed = await readBoundedJson(request, 48 * 1024)
    if (parsed.error || !validBatch(parsed.value, dailyDay())) return dailyJson({ error: 'Expected a complete batch of five answers for today.' }, 400)
    const body = parsed.value
    const result = await db.prepare(`INSERT INTO daily_ai_batch (singleton, day, model, answers, received_at)
      SELECT 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM daily_ai_control WHERE singleton = 1 AND enabled = 1 AND revision = ?)
      ON CONFLICT(singleton) DO UPDATE SET day = excluded.day, model = excluded.model, answers = excluded.answers, received_at = excluded.received_at
      WHERE daily_ai_batch.day < excluded.day`)
      .bind(body.day, body.model, JSON.stringify(body.answers), Date.now(), body.revision).run()
    if (!result.meta.changes) return dailyJson({ error: 'Publishing is disabled, the generation lease changed, or today is already published.' }, 409)
    // Quotas have no historical value; permanent bans are never pruned.
    await db.prepare('DELETE FROM daily_ai_reads WHERE day < ?').bind(dailyDay(Date.now() - 7 * 86400000)).run()
    return dailyJson({ ok: true, day: body.day })
  } catch (error) { return dailyUnavailable(error) }
}
