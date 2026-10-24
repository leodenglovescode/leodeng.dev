// Client for the /admin editor.
//
// Every call goes through this site's own /api/* endpoints, which hold the
// GitHub token in an HttpOnly cookie. Nothing here ever sees a credential —
// if these requests come back 401, the session is gone and the UI shows the
// login screen again.

import { ref } from 'vue'

export const localAdmin = ref(false)
let repo = null

// randomUUID requires a secure context; getRandomValues also works over LAN HTTP.
export function newContentId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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

const databaseContent = path => path === 'src/content/shelf.json' || /^src\/(posts|drafts)(?:\/|$)/.test(path)
const databaseUrl = path => '/api/content/file?' + new URLSearchParams({path})

function contentsUrl(path) {
  if (!repo) throw new ApiError('Not signed in.', 401)
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `/api/gh/repos/${repo}/contents/${encoded}`
}

export async function getSession() {
  repo = null
  localAdmin.value = false
  const res = await fetch('/api/me', { headers: { 'X-Admin': '1' } })
  if (!res.ok) return null

  const session = await res.json().catch(() => null)
  if (!session?.authenticated) return null

  localAdmin.value = import.meta.env.DEV && session.local === true
  repo = session.repo
  return session
}

export async function logout() {
  await fetch('/api/logout', { method: 'POST', headers: { 'X-Admin': '1' } })
  repo = null
  localAdmin.value = false
}

/** Directory listing. A directory that doesn't exist yet reads as empty. */
export async function listDir(path) {
  try {
    const entries = await request(!localAdmin.value && databaseContent(path) ? '/api/content/list?' + new URLSearchParams({dir:path}) : `${contentsUrl(path)}?ref=main`)
    return Array.isArray(entries) ? entries : []
  } catch (err) {
    if (err.status === 404) return []
    throw err
  }
}

/** Returns `{ text, sha }`, or null if the file isn't there. */
export async function getFile(path) {
  try {
    if (!localAdmin.value && databaseContent(path)) return await request(databaseUrl(path))
    const file = await request(`${contentsUrl(path)}?ref=main`)
    return { text: decodeBase64(file.content || ''), sha: file.sha }
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/** Create or update a file. Pass `sha` when replacing an existing one. */
export function putFile({ path, base64, message, sha, originalPath }) {
  if (!localAdmin.value && databaseContent(path)) return request(databaseUrl(path), {method:'PUT',body:{text:decodeBase64(base64),sha,originalPath}})
  return request(contentsUrl(path), {
    method: 'PUT',
    body: { message, content: base64, branch: 'main', ...(sha ? { sha } : {}) },
  })
}

export function deleteFile({ path, sha, message }) {
  if (!localAdmin.value && databaseContent(path)) return request(databaseUrl(path), {method:'DELETE',body:{sha}})
  return request(contentsUrl(path), {
    method: 'DELETE',
    body: { message, sha, branch: 'main' },
  })
}

// --- R2 media ---------------------------------------------------------------
//
// Separate from the GitHub helpers above on purpose: these hit /api/media,
// which writes to the R2 bucket instead of committing to the repo. Images and
// video both go here; see functions/api/media/[[path]].js for why.

/** Returns `{ base, files }`. `base` is the public origin the bucket serves from. */
export function listMedia() {
  return request('/api/media')
}

/**
 * Uploads one File. Sent as a raw stream rather than base64 — R2 takes the
 * bytes as-is, so there's no reason to inflate them by a third first.
 */
export function putMedia(name, file, { onProgress = () => {} } = {}) {
  // Fetch does not expose upload byte progress. XHR keeps the same authenticated
  // endpoint and raw File body while reporting the actual bytes sent.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/media/${encodeURIComponent(name)}`)
    xhr.responseType = 'json'
    xhr.setRequestHeader('X-Admin', '1')
    xhr.setRequestHeader('X-Original-Filename', encodeURIComponent(file.name))
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = event => onProgress({ phase: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : file.size })
    // Sending all bytes to our server isn't completion: R2 must confirm storage.
    xhr.upload.onload = () => onProgress({ phase: 'saving', loaded: file.size, total: file.size })
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
      else reject(new ApiError(xhr.response?.error || `Upload failed (${xhr.status})`, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection and try again.', 0))
    xhr.onabort = () => reject(new ApiError('Upload canceled.', 0))
    onProgress({ phase: 'uploading', loaded: 0, total: file.size })
    xhr.send(file)
  })
}

export async function deleteMedia(name) {
  const res = await fetch(`/api/media/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'X-Admin': '1' },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(payload?.error || `Delete failed (${res.status})`, res.status)
  }
  return payload
}

export { ApiError }

export function searchShelf({ type, query, artist = '' }) {
  return request(`/api/shelf-search?${new URLSearchParams({ type, q: query, artist })}`)
}
