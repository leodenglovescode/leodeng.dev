const STATUSES = new Set(['active', 'recurring', 'paused', 'finished'])
export const NOW_API_URL = 'https://leodeng.dev/api/now'

export function nowPayload(data, language = 'en') {
  const localized = value => typeof value === 'string' ? value : value?.[language] || value?.en || ''
  return {
    schemaVersion: 1,
    url: `https://leodeng.dev${language === 'zh' ? '/zh' : ''}/now`,
    language,
    updatedAt: data.updatedAt || null,
    detailsFormat: 'markdown',
    events: (data.events || []).map(event => ({
      id: event.id,
      title: localized(event.title),
      status: STATUSES.has(event.status) ? event.status : 'active',
      startedAt: event.startedAt || null,
      updatedAt: event.updatedAt || null,
      finishedAt: event.finishedAt || null,
      details: localized(event.details),
    })),
  }
}

export function nowResponse(request, data) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const respond = (body, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status, headers: { ...headers, ...(status !== 200 ? { 'Cache-Control': 'no-store' } : {}), ...extra },
  })
  if (!['GET', 'HEAD'].includes(request.method)) return respond({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, OPTIONS' })
  const query = new URL(request.url).searchParams
  const language = query.get('lang') ?? 'en'
  if (!['en', 'zh'].includes(language) || query.getAll('lang').length > 1 || [...query.keys()].some(key => key !== 'lang')) {
    return respond({ error: 'Use ?lang=en or ?lang=zh. No other query parameters are supported.' }, 400)
  }
  return respond(nowPayload(data, language))
}
