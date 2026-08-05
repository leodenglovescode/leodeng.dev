// Step 2 of the /admin GitHub OAuth flow.
// Exchanges GitHub's temporary authorization code for an access token (needs
// GITHUB_CLIENT_SECRET, which is why this can't happen in the browser), checks
// the resulting account against the allowlist, and stores the token in an
// HttpOnly cookie. The token is never sent to the page — /api/gh/* attaches it
// server-side instead.
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  USER_AGENT,
  allowedUsers,
  clearCookie,
  getCookie,
  githubFetch,
  setCookie,
} from '../../lib/auth.js'

function errorPage(request, title, detail, status) {
  const escape = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <meta name="robots" content="noindex">
     <title>Sign-in failed — leodeng.dev</title>
     <style>
       body{background:#111;color:#ccc;font:15px/1.7 ui-sans-serif,system-ui,sans-serif;
            display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
       div{max-width:26rem}
       h1{color:#fff;font-size:1.05rem;margin:0 0 .5rem}
       p{color:#888;margin:0 0 1.25rem}
       a{color:#818cf8}
     </style>
     <div><h1>${escape(title)}</h1><p>${escape(detail)}</p><a href="/admin">Back to /admin</a></div>`,
    {
      status,
      headers: {
        'content-type': 'text/html;charset=UTF-8',
        'Set-Cookie': clearCookie(request, STATE_COOKIE),
      },
    },
  )
}

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expectedState = getCookie(request, STATE_COOKIE)

  if (!state || !expectedState || state !== expectedState) {
    return errorPage(request, 'Invalid sign-in state', 'Please start the login again from /admin.', 401)
  }
  if (!code) {
    return errorPage(request, 'Missing authorization code', 'GitHub did not send a code back.', 400)
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    })
    const result = await response.json()

    if (result.error || !result.access_token) {
      return errorPage(request, 'GitHub rejected the sign-in', result.error_description || result.error || 'No access token returned.', 401)
    }

    const token = result.access_token

    // The allowlist is the actual access control. Anyone can complete a GitHub
    // OAuth flow; only these accounts get a session.
    const userRes = await githubFetch('https://api.github.com/user', token)
    if (!userRes.ok) {
      return errorPage(request, 'Could not read your GitHub account', `GitHub returned ${userRes.status}.`, 401)
    }
    const user = await userRes.json()

    if (!allowedUsers(env).includes(String(user.login).toLowerCase())) {
      return errorPage(
        request,
        'Not authorized',
        `Signed in as @${user.login}, which is not allowed to edit this site.`,
        403,
      )
    }

    const headers = new Headers({ Location: '/admin' })
    headers.append('Set-Cookie', setCookie(request, SESSION_COOKIE, token))
    // one-time use — clear it now that the exchange is done
    headers.append('Set-Cookie', clearCookie(request, STATE_COOKIE))

    return new Response(null, { status: 302, headers })
  } catch (err) {
    return errorPage(request, 'Sign-in failed', err.message, 500)
  }
}
