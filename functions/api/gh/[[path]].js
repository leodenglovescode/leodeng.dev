// Authenticated proxy to the GitHub REST API for the /admin editor.
//
// The admin page never holds the access token; it calls /api/gh/<github-path>
// and this function attaches the token from the HttpOnly session cookie.
//
// Two guardrails on top of the session check:
//   1. Only paths inside this repo are reachable, and only under the content
//      directories the editor actually manages — so even a compromised admin
//      page can't rewrite build config or workflows.
//   2. Writes require an `X-Admin` header. A cross-site form can't set custom
//      headers without a CORS preflight, which this endpoint never approves.
import { json, repoSlug, requireSession, USER_AGENT } from '../../../lib/auth.js'

// Everything the editor touches lives under one of these.
const WRITABLE_PREFIXES = ['src/posts/', 'public/blog-media/']
const READABLE_PREFIXES = ['src/posts', 'public/blog-media']

function decodePath(params) {
  const parts = Array.isArray(params.path) ? params.path : [params.path]
  const segments = parts.filter(Boolean).map(decodeURIComponent)
  // Without this, `src/posts/../../functions/x.js` passes the prefix check
  // below and escapes the content directories entirely.
  if (segments.some((s) => s === '.' || s === '..' || s.includes('/'))) return null
  return segments.join('/')
}

function contentPath(ghPath, slug) {
  const prefix = `repos/${slug}/contents/`
  return ghPath.startsWith(prefix) ? ghPath.slice(prefix.length) : null
}

export async function onRequest(context) {
  const { request, env, params } = context

  const session = await requireSession(request, env)
  if (!session) return json({ error: 'Not signed in.' }, 401)

  const method = request.method.toUpperCase()
  const isWrite = method !== 'GET' && method !== 'HEAD'

  if (isWrite && request.headers.get('X-Admin') !== '1') {
    return json({ error: 'Missing X-Admin header.' }, 403)
  }

  const slug = repoSlug(env)
  const ghPath = decodePath(params)

  if (!ghPath) return json({ error: 'Malformed path.' }, 400)

  if (!ghPath.startsWith(`repos/${slug}/contents/`) && ghPath !== `repos/${slug}/contents`) {
    return json({ error: `Path not allowed: ${ghPath}` }, 403)
  }

  const target = contentPath(ghPath, slug) ?? ''
  const allowed = isWrite
    ? WRITABLE_PREFIXES.some((p) => target.startsWith(p))
    : READABLE_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`))

  if (!allowed) {
    return json({ error: `Content path not allowed: ${target || '(root)'}` }, 403)
  }

  const incoming = new URL(request.url)
  const url = new URL(`https://api.github.com/${ghPath}`)
  url.search = incoming.search

  const upstream = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      authorization: `Bearer ${session.token}`,
      ...(isWrite ? { 'content-type': 'application/json' } : {}),
    },
    body: isWrite ? await request.text() : undefined,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  })
}
