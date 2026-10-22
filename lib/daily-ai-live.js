import { dailyJson } from './daily-ai.js'

export function relay(env, action, body) {
  return env.DAILY_AI_TRAFFIC.fetch(`https://daily-ai-traffic.internal/${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    // Streaming responses live until completion; only setup calls need a deadline.
    ...(action !== 'stream' ? { signal: AbortSignal.timeout(5000) } : {}),
  })
}

export async function liveVisitor(request, env, db, ip, id, day, revision) {
  const wantsStream = request.headers.get('accept') === 'text/event-stream'
  let selected = await db.prepare('SELECT question_id, job_id, created_at FROM daily_ai_live_reads WHERE day = ? AND ip = ?').bind(day, ip).first()
  if (selected) {
    const response = await relay(env, 'job', { job: selected.job_id })
    if (!response.ok) return dailyJson({ error: 'The live relay is unavailable.' }, 503)
    const job = await response.json()
    // An interrupted/failed inference can be tried again without charging a
    // second allowance. Never refund another concurrent job's selection.
    if ((!job && Date.now() - selected.created_at > 30000) || job && ['error', 'cancelled'].includes(job.status)) {
      await db.prepare('DELETE FROM daily_ai_live_reads WHERE day = ? AND ip = ? AND job_id = ?').bind(day, ip, selected.job_id).run()
      selected = null
    }
  }
  if (id && selected) return dailyJson({ error: 'One question per IP per day. Reopen your selected answer.' }, 429)
  if (id) {
    const status = await relay(env, 'status')
    const available = status.ok ? await status.json() : null
    if (!available?.online || available.pending >= 3) return dailyJson({ error: 'The homelab is offline or busy. Try again later.' }, 503)
    const job = crypto.randomUUID()
    const result = await db.prepare(`INSERT OR IGNORE INTO daily_ai_live_reads (day, ip, question_id, job_id, created_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM daily_ai_control WHERE singleton = 1 AND enabled = 1 AND revision = ?)
      AND NOT EXISTS (SELECT 1 FROM daily_ai_bans WHERE ip = ?)`)
      .bind(day, ip, id, job, Date.now(), revision, ip).run()
    if (!result.meta.changes) return dailyJson({ error: 'A question was already selected or Daily AI was disabled.' }, 429)
    // Recheck the kill switch before any model work is enqueued.
    const enabled = await db.prepare('SELECT enabled FROM daily_ai_control WHERE singleton = 1 AND enabled = 1 AND revision = ?').bind(revision).first()
    const started = enabled ? await relay(env, 'start', { job, id, day, revision }) : null
    if (!started?.ok) {
      await db.prepare('DELETE FROM daily_ai_live_reads WHERE day = ? AND ip = ? AND job_id = ?').bind(day, ip, job).run()
      return dailyJson({ error: 'The homelab is offline or busy. Try again later.' }, 503)
    }
    await db.prepare('DELETE FROM daily_ai_live_reads WHERE day < ?').bind(new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10)).run()
    selected = { question_id: id, job_id: job }
    // A disable/reset concurrent with enqueuing must also invalidate this work.
    const stillAllowed = await db.prepare(`SELECT r.job_id FROM daily_ai_live_reads r, daily_ai_control c
      WHERE r.day = ? AND r.ip = ? AND r.job_id = ? AND c.singleton = 1 AND c.enabled = 1 AND c.revision = ? AND NOT EXISTS (SELECT 1 FROM daily_ai_bans WHERE ip = ?)`).bind(day, ip, job, revision, ip).first()
    if (!stillAllowed) { await relay(env, 'cancel', { job }); return dailyJson({ error: 'Daily AI controls changed.' }, 503) }
  }
  if (wantsStream && selected) {
    const response = await relay(env, 'stream', { job: selected.job_id })
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('vary', 'Accept, Cookie')
    return new Response(response.body, { status: response.status, headers })
  }
  const response = await relay(env, 'status')
  const status = response.ok ? await response.json() : null
  return dailyJson({ enabled: true, ready: Boolean(status?.online), day, live: true,
    model: 'qwen3.8:27b', selected: selected?.question_id || null, answer: null })
}
