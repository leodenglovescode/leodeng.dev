// Client for the /admin editor.
//
// Every call goes through this site's own /api/* endpoints, which hold the
// GitHub token in an HttpOnly cookie. Nothing here ever sees a credential —
// if these requests come back 401, the session is gone and the UI shows the
// login screen again.

let repo = null

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// btoa/atob are byte-oriented; posts contain em dashes, arrows and the like,
// so round-trip through UTF-8 explicitly rather than losing characters.
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function bytesToBase64(bytes) {
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Admin': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = res.status === 204 ? null : await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(payload?.message || payload?.error || `Request failed (${res.status})`, res.status)
  }
  return payload
}

function contentsUrl(path) {
  if (!repo) throw new ApiError('Not signed in.', 401)
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `/api/gh/repos/${repo}/contents/${encoded}`
}

export async function getSession() {
  repo = null
  const res = await fetch('/api/me', { headers: { 'X-Admin': '1' } })
  if (!res.ok) return null

  // `npm run dev` has no Functions runtime, so /api/me falls through to the SPA
  // and answers 200 with HTML. Treat anything unparseable as signed out rather
  // than throwing — use `npx wrangler pages dev dist` to exercise the real flow.
  const session = await res.json().catch(() => null)
  if (!session?.authenticated) return null

  repo = session.repo
  return session
}

export async function logout() {
  await fetch('/api/logout', { method: 'POST', headers: { 'X-Admin': '1' } })
  repo = null
}

/** Directory listing. A directory that doesn't exist yet reads as empty. */
export async function listDir(path) {
  try {
    const entries = await request(`${contentsUrl(path)}?ref=main`)
    return Array.isArray(entries) ? entries : []
  } catch (err) {
    if (err.status === 404) return []
    throw err
  }
}

/** Returns `{ text, sha }`, or null if the file isn't there. */
export async function getFile(path) {
  try {
    const file = await request(`${contentsUrl(path)}?ref=main`)
    return { text: decodeBase64(file.content || ''), sha: file.sha }
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/** Create or update a file. Pass `sha` when replacing an existing one. */
export function putFile({ path, base64, message, sha }) {
  return request(contentsUrl(path), {
    method: 'PUT',
    body: { message, content: base64, branch: 'main', ...(sha ? { sha } : {}) },
  })
}

export function deleteFile({ path, sha, message }) {
  return request(contentsUrl(path), {
    method: 'DELETE',
    body: { message, sha, branch: 'main' },
  })
}

export { ApiError }
