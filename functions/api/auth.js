// Step 1 of the /admin GitHub OAuth flow.
// Sends the browser to GitHub's real login/consent screen. GITHUB_CLIENT_SECRET
// never touches this endpoint — only callback.js needs it, to exchange the code
// GitHub sends back for an access token.
import { STATE_COOKIE, setCookie } from '../../lib/auth.js'

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  if (!env.GITHUB_CLIENT_ID) {
    return new Response('GITHUB_CLIENT_ID is not configured.', { status: 500 })
  }

  const state = crypto.randomUUID()

  const redirectUrl = new URL('https://github.com/login/oauth/authorize')
  redirectUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  redirectUrl.searchParams.set('redirect_uri', `${url.origin}/api/callback`)
  // `repo` to read and commit posts/media, `read:user` to check the login
  // against the allowlist. Nothing outside the repo is writable with this.
  redirectUrl.searchParams.set('scope', 'repo,read:user')
  redirectUrl.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.href,
      // Read back by callback.js and compared against GitHub's returned `state`
      // to make sure the callback we're completing is one we actually started
      // (CSRF / authorization-code-injection protection).
      'Set-Cookie': setCookie(request, STATE_COOKIE, state, { maxAge: 600 }),
    },
  })
}
