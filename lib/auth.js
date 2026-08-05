// Shared helpers for the /admin GitHub OAuth flow (Cloudflare Pages Functions).
//
// Lives outside functions/ on purpose: every file under functions/ becomes a
// routable endpoint, and this is library code, not a route.
//
// Design notes:
//   - The access token is kept in an HttpOnly cookie and never handed to the
//     browser. The admin UI talks to GitHub through /api/gh/*, which attaches
//     the token server-side. So a XSS bug on the site can't exfiltrate a
//     repo-scoped token.
//   - There is no password anywhere in this flow. The only way in is a real
//     GitHub login, and then only for the account named by GITHUB_ALLOWED_USER.

export const SESSION_COOKIE = 'gh_session'
export const STATE_COOKIE = 'oauth_state'

// Session lifetime. GitHub OAuth-app tokens don't expire on their own, so this
// cookie's Max-Age is what actually bounds a session.
export const SESSION_MAX_AGE = 60 * 60 * 8

export const USER_AGENT = 'leodeng.dev-admin'

export function repoSlug(env) {
  return env.GITHUB_REPO || 'leodenglovescode/leodeng.dev'
}

export function allowedUsers(env) {
  return (env.GITHUB_ALLOWED_USER || 'leodenglovescode')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

export function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// `Secure` cookies are dropped outright over plain http on anything that isn't
// localhost — which is every LAN address you'd use to test from a phone. So the
// flag tracks the actual scheme. Production is https, so it's always set there.
export function isSecure(request) {
  return new URL(request.url).protocol === 'https:'
}

export function setCookie(request, name, value, { maxAge = SESSION_MAX_AGE, sameSite = 'Lax' } = {}) {
  const secure = isSecure(request) ? ' Secure;' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly;${secure} SameSite=${sameSite}; Max-Age=${maxAge}`
}

export function clearCookie(request, name) {
  const secure = isSecure(request) ? ' Secure;' : ''
  return `${name}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`
}

export function githubFetch(url, token, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
}

// Resolves the signed-in GitHub user, or null if the session is missing,
// expired, revoked, or belongs to an account that isn't on the allowlist.
export async function requireSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return null

  const res = await githubFetch('https://api.github.com/user', token)
  if (!res.ok) return null

  const user = await res.json()
  if (!allowedUsers(env).includes(String(user.login).toLowerCase())) return null

  return { token, user }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json;charset=UTF-8', ...headers },
  })
}
