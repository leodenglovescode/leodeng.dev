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
import { STACK_PATH, validateStack } from '../../../lib/stack-validation.js'
import { GALLERY_PATH, validateGalleryManifest } from '../../../lib/gallery-validation.js'
import { json, repoSlug, requireSession, USER_AGENT } from '../../../lib/auth.js'

// Everything the editor touches lives under one of these. `src/drafts/` holds
// unpublished posts — nothing globs it, so it never reaches the build.
const WRITABLE_PREFIXES = ['src/posts/', 'src/drafts/']
const READABLE_PREFIXES = ['src/posts', 'src/drafts']
// Structured site content is build-time JSON, so grant exact files rather
// than the whole directory.
const CONTENT_FILES = new Set([GALLERY_PATH, 'src/content/now.json', 'src/content/projects.json', 'src/content/shelf.json', STACK_PATH])

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
    ? CONTENT_FILES.has(target) || WRITABLE_PREFIXES.some((p) => target.startsWith(p))
    : CONTENT_FILES.has(target)
      || READABLE_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`))

  if (!allowed) {
    return json({ error: `Content path not allowed: ${target || '(root)'}` }, 403)
  }

  const incoming = new URL(request.url)
  const url = new URL(`https://api.github.com/${ghPath}`)
  url.search = incoming.search

  let body = isWrite ? await request.text() : undefined
  if (target === GALLERY_PATH && isWrite) {
    if (method !== 'PUT') return json({ error: 'The gallery manifest cannot be deleted.' }, 405)
    try {
      const incoming = JSON.parse(body)
      if (typeof incoming.content !== 'string' || incoming.content.length > 4 * 1024 * 1024) throw new Error('Invalid gallery content.')
      const bytes = Uint8Array.from(atob(incoming.content), c => c.charCodeAt(0))
      validateGalleryManifest(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (error) { return json({ error: error.message || 'Invalid gallery content.' }, 400) }
  }
  if (target === STACK_PATH && isWrite) {
    if (method !== 'PUT') return json({ error: 'The stack file cannot be deleted.' }, 405)
    try {
      const incoming = JSON.parse(body)
      if (typeof incoming.content !== 'string' || incoming.content.length > 4 * 1024 * 1024) throw new Error('Invalid stack content.')
      const bytes = Uint8Array.from(atob(incoming.content), c => c.charCodeAt(0))
      validateStack(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (error) { return json({ error: error.message || 'Invalid stack content.' }, 400) }
  }
  const upstream = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      authorization: `Bearer ${session.token}`,
      ...(isWrite ? { 'content-type': 'application/json' } : {}),
    },
    body,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  })
}
