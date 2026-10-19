import { json, requireSession } from '../../lib/auth.js'
import { searchShelfCatalog } from '../../lib/shelf-search.js'

export async function onRequest(context) {
  const session = await requireSession(context.request, context.env)
  if (!session) return json({ error: 'Not signed in.' }, 401)
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
  try {
    return json(await searchShelfCatalog(new URL(context.request.url).searchParams), 200, { 'cache-control': 'no-store' })
  } catch (error) {
    return json({ error: error.status ? error.message : 'Catalog search failed.' }, error.status || 502)
  }
}
