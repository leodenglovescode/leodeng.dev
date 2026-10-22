import { dailyDay, dailyJson, exactKeys } from './daily-ai.js'
import { getCookie, isSecure } from './auth.js'
import { chatContext, CHAT_ENDPOINT, CHAT_MODEL, ChatError, cloudStats, providerBody, readProviderStream } from './deepseek-chat.js'

export const CHAT_COOKIE = 'daily_ai_chat'
export function chatRelay(env, action, body) {
  return env.DAILY_AI_TRAFFIC.fetch(`https://chat.internal/${action}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
  })
}
function sessionCookie(request) {
  let session
  try { session = getCookie(request, CHAT_COOKIE) } catch { /* Invalid cookies start a new private conversation. */ }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(session || '')) session = crypto.randomUUID()
  return { session, cookie: `${CHAT_COOKIE}=${session}; Path=/api/daily-ai; Max-Age=86400; HttpOnly; SameSite=Strict${isSecure(request) ? '; Secure' : ''}` }
}
export function validChatInput(body) {
  return exactKeys(body, ['message', 'thinking']) && typeof body.message === 'string'
    && body.message.trim().length > 0 && body.message.length <= 2000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.message) && typeof body.thinking === 'boolean'
}
export async function cloudChat(context, db, ip, body, control, whitelisted) {
  const { request, env } = context, day = dailyDay(), { session, cookie } = sessionCookie(request)
  const reply = (value, status = 200) => { const response = dailyJson(value, status); response.headers.set('set-cookie', cookie); return response }
  const used = (await db.prepare('SELECT COUNT(*) AS n FROM daily_ai_chat_usage WHERE day = ? AND ip = ?').bind(day, ip).first()).n
  if (!body) {
    const [stateResponse, historyResponse] = await Promise.all([chatRelay(env, 'status'), chatRelay(env, 'history', { session, day })])
    if (!stateResponse.ok || !historyResponse.ok) return reply({ error: 'Chat is unavailable.' }, 503)
    const state = await stateResponse.json(), history = await historyResponse.json()
    return reply({ enabled: true, ready: Boolean(env.DEEPSEEK_API_KEY) && (whitelisted || state.globalRemaining > 0),
      configured: Boolean(env.DEEPSEEK_API_KEY), day, model: CHAT_MODEL, remaining: whitelisted ? null : Math.max(0, 5 - used),
      whitelisted, dailyLimit: 5, ...state, turns: history.turns })
  }
  if (!env.DEEPSEEK_API_KEY) return reply({ error: 'Chat is not configured.' }, 503)
  if (!whitelisted && used >= 5) return reply({ error: 'Five messages per IP per day.', code: 'personal_daily_limit' }, 429)
  // Load public context before reserving a paid request.
  const publicContext = await chatContext(env, request, body.message)
  const job = crypto.randomUUID()
  if (!whitelisted) {
    const claimed = await db.prepare(`INSERT OR IGNORE INTO daily_ai_chat_usage (day, ip, slot, job, created_at)
      SELECT ?, ?, slots.n, ?, ? FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) slots
      WHERE NOT EXISTS (SELECT 1 FROM daily_ai_chat_usage WHERE day = ? AND ip = ? AND slot = slots.n)
      AND EXISTS (SELECT 1 FROM daily_ai_control WHERE singleton = 1 AND enabled = 1 AND revision = ?)
      AND NOT EXISTS (SELECT 1 FROM daily_ai_bans WHERE ip = ?) LIMIT 1`).bind(day, ip, job, Date.now(), day, ip, control.revision, ip).run()
    if (!claimed.meta.changes) return reply({ error: 'Daily allowance exhausted or controls changed.', code: 'personal_daily_limit' }, 429)
  }
  // Expired quota records do not need to delay or invalidate an active stream.
  context.waitUntil(db.prepare('DELETE FROM daily_ai_chat_usage WHERE day < ?').bind(dailyDay(Date.now() - 7 * 86400000)).run().catch(() => {}))
  let prepared
  try { prepared = await chatRelay(env, 'prepare', { session, day, job, message: body.message.trim(), revision: control.revision, whitelisted }) }
  catch (error) {
    await db.prepare('DELETE FROM daily_ai_chat_usage WHERE job = ?').bind(job).run()
    throw error
  }
  if (!prepared.ok) {
    await db.prepare('DELETE FROM daily_ai_chat_usage WHERE job = ?').bind(job).run()
    const rejected = await prepared.json().catch(() => ({}))
    return reply({ error: 'Chat is busy or its daily limit has been reached.', code: rejected.code || 'chat_busy' }, prepared.status)
  }
  const { history } = await prepared.json()
  const providerRequest = providerBody(body.message.trim(), body.thinking, history, publicContext.text)
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(new ChatError('generation_timeout')), 115000)
  let sink, closed = false, answer = '', thinking = '', firstToken = null, stats = null, finishing = false
  const encoder = new TextEncoder(), started = Date.now()
  const emit = value => { if (!closed) sink.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)) }
  let checking = false
  const check = async () => {
    if (checking || abort.signal.aborted || finishing) return
    checking = true
    try {
      const latest = await db.prepare('SELECT enabled, revision FROM daily_ai_control WHERE singleton = 1').first()
      if (!latest?.enabled || latest.revision !== control.revision) abort.abort(new ChatError('generation_cancelled'))
    } catch { abort.abort(new ChatError('generation_cancelled')) }
    finally { checking = false }
  }
  const heartbeat = setInterval(() => { void check() }, 2000)
  const stream = new ReadableStream({
    start(controller) { sink = controller },
    cancel() { closed = true; abort.abort(new ChatError('generation_cancelled')) },
  })
  const pump = async () => {
    let status = 'error', code = null
    try {
      await check()
      if (abort.signal.aborted) throw abort.signal.reason
      emit({ type: 'start', id: job, message: body.message.trim(), model: CHAT_MODEL })
      const upstream = await fetch(CHAT_ENDPOINT, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify(providerRequest), signal: abort.signal })
      if (!upstream.ok) { await upstream.body?.cancel(); throw new ChatError([401, 403].includes(upstream.status) ? 'provider_auth' : upstream.status === 429 ? 'provider_busy' : 'provider_error') }
      const terminal = await readProviderStream(upstream, (channel, text) => {
        firstToken ??= Date.now()
        if (channel === 'thinking') {
          if (thinking.length + text.length > 24000) throw new ChatError('output_limit')
          thinking += text
        } else {
          if (answer.length + text.length > 16000) throw new ChatError('output_limit')
          if (!answer) emit({ type: 'phase', phase: 'answering' })
          answer += text
        }
        emit({ type: 'delta', channel, text })
      }, abort.signal)
      if (!answer.trim()) throw new ChatError(terminal.finishReason === 'length' ? 'output_limit' : 'empty_answer')
      stats = cloudStats(terminal.usage, started, firstToken, Date.now(), terminal.finishReason)
      status = 'done'
    } catch (error) {
      code = abort.signal.aborted ? abort.signal.reason?.code || 'generation_cancelled' : error instanceof ChatError ? error.code : 'provider_error'
    } finally {
      finishing = true; clearTimeout(timeout); clearInterval(heartbeat)
      try {
        const saved = await chatRelay(env, 'finish', { session, day, job, status, answer, thinking, stats, code })
        if (!saved.ok) { status = 'error'; code = 'generation_cancelled' }
        if (status === 'done') { emit({ type: 'sources', sources: publicContext.sources }); emit({ type: 'stats', stats }) }
        emit({ type: 'status', status, ...(code ? { code } : {}) })
      } catch { try { emit({ type: 'status', status: 'error', code: 'stream_incomplete' }) } catch { /* Reader disconnected. */ } }
      finally { if (!closed) { closed = true; try { sink.close() } catch { /* Reader already closed. */ } } }
    }
  }
  context.waitUntil(pump())
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'set-cookie': cookie, vary: 'Cookie' } })
}
