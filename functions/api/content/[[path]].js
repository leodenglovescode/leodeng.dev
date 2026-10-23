import { requireSession, json } from '../../../lib/auth.js'
import { contentPath, SHELF_PATH, requireContentReady, readContent, listContent, writeContent, exportContent, contentError } from '../../../lib/content.js'
import { readBoundedJson, safeEqual } from '../../../lib/content-security.js'
const reply = (data,status=200) => json(data,status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
export async function onRequest({request,env}) {
  try {
    const url = new URL(request.url), route = url.pathname.replace(/^\/api\/content\/?/,'')
    if (route === 'public/posts' || route === 'public/shelf') {
      if (!['GET','HEAD'].includes(request.method)) return reply({error:'Method not allowed.'},405)
      const db = await requireContentReady(env)
      if (route === 'public/shelf') {
        const file = await readContent(db,SHELF_PATH)
        return reply(JSON.parse(file.raw))
      }
      const rows = await listContent(db,'src/posts')
      return reply({posts:Object.fromEntries(rows.map(row => ['../posts/'+row.path.split('/').pop(),row.raw]))})
    }
    if (route === 'export' && request.method === 'GET') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /,'') || ''
      if (!(await safeEqual(token,env.CONTENT_BACKUP_TOKEN || '')) && !(await requireSession(request,env))) return reply({error:'Not signed in.'},401)
      return reply(await exportContent(await requireContentReady(env)))
    }
    const session = await requireSession(request,env)
    if (!session) return reply({error:'Not signed in.'},401)
    if (!['GET','PUT','DELETE'].includes(request.method)) return reply({error:'Method not allowed.'},405)
    if (request.method !== 'GET' && (request.headers.get('X-Admin') !== '1' || (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin))) return reply({error:'Same-origin editor request required.'},403)
    const db = await requireContentReady(env)
    if (route === 'list' && request.method === 'GET') {
      const directory = url.searchParams.get('dir')
      if (!['src/posts','src/drafts'].includes(directory)) throw contentError(400,'Invalid directory.')
      return reply((await listContent(db,directory)).map(row => ({name:row.path.split('/').pop(),type:'file',sha:row.revision,text:row.raw})))
    }
    if (route !== 'file') throw contentError(404,'Not found.')
    const path = url.searchParams.get('path')
    if (!contentPath(path)) throw contentError(400,'Invalid content path.')
    if (request.method === 'GET') {
      const row = await readContent(db,path)
      return row ? reply({text:row.raw,sha:row.revision}) : reply({error:'Not found.'},404)
    }
    const body = await readBoundedJson(request,1100000)
    return reply(await writeContent(db,{path,raw:body.text,sha:body.sha,originalPath:body.originalPath||path,remove:request.method==='DELETE'}))
  } catch (error) {
    if (error.status) return reply({error:error.message},error.status)
    console.error('content_api_failed',error.message)
    return reply({error:'Content storage unavailable. Your changes have not been confirmed.'},503)
  }
}
