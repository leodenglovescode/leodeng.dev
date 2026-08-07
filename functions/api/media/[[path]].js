// R2-backed media endpoint for the /admin editor.
//
// Images stay in the repo (see functions/api/gh/[[path]].js) — they're small,
// and versioning them alongside the post that references them is worth the
// space. Video is the opposite trade: git keeps every byte of every revision
// forever, a single phone export blows past the 25 MiB Pages asset cap, and
// nobody benefits from a diffable mp4. So video lives in R2 instead.
//
// Same guardrails as the GitHub proxy: a real session is required, and writes
// need the X-Admin header, which a cross-site form can't set without a CORS
// preflight this endpoint never approves.
import { json, requireSession } from '../../../lib/auth.js'

// Bound in the Pages project settings (Settings > Bindings > R2 bucket).
// Named MEDIA there; if it's missing every call fails loudly rather than
// silently pretending the bucket is empty.
const BINDING = 'MEDIA'

// Where the bucket is served from. Set R2_PUBLIC_BASE if the custom domain
// ever changes — the client reads this back rather than hardcoding it, so the
// markdown the editor writes always points at whatever is configured here.
function publicBase(env) {
  return (env.R2_PUBLIC_BASE || 'https://media.leodeng.dev').replace(/\/+$/, '')
}

// Object keys land verbatim in a public URL, so keep them boring. This mirrors
// safeName() in MediaManager.vue; the client sanitises for good UX and the
// server sanitises because the client can't be trusted.
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*$/

function keyFrom(params) {
  const parts = Array.isArray(params.path) ? params.path : [params.path]
  const segments = parts.filter(Boolean).map(decodeURIComponent)
  // No nesting: a single flat namespace keeps the public URLs short and makes
  // traversal impossible rather than merely unlikely.
  if (segments.length !== 1) return null
  const key = segments[0]
  return SAFE_KEY.test(key) && key.length <= 128 ? key : null
}

export async function onRequest(context) {
  const { request, env, params } = context

  const session = await requireSession(request, env)
  if (!session) return json({ error: 'Not signed in.' }, 401)

  const bucket = env[BINDING]
  if (!bucket) {
    return json(
      { error: `No R2 bucket bound as ${BINDING}. Add it under Pages > Settings > Bindings.` },
      503,
    )
  }

  const method = request.method.toUpperCase()
  const isWrite = method !== 'GET' && method !== 'HEAD'

  if (isWrite && request.headers.get('X-Admin') !== '1') {
    return json({ error: 'Missing X-Admin header.' }, 403)
  }

  const base = publicBase(env)

  if (method === 'GET') {
    const listed = await bucket.list({ limit: 500 })
    const files = listed.objects
      .map((o) => ({
        name: o.key,
        size: o.size,
        uploaded: o.uploaded,
        url: `${base}/${o.key}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return json({ base, files })
  }

  const key = keyFrom(params)
  if (!key) return json({ error: 'Malformed object name.' }, 400)

  if (method === 'PUT') {
    // Streamed straight through rather than base64'd like the GitHub path —
    // no 33% inflation, and the Worker never holds the whole file in memory.
    await bucket.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get('content-type') || 'application/octet-stream',
        // Immutable because uploads never reuse a name: safeName() suffixes a
        // counter instead of overwriting.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
    return json({ name: key, url: `${base}/${key}` }, 201)
  }

  if (method === 'DELETE') {
    // Unlike the repo, this is not a commit and there is nothing to revert.
    await bucket.delete(key)
    return json({ deleted: key })
  }

  return json({ error: `Method not allowed: ${method}` }, 405)
}
