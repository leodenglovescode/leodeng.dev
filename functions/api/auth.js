// Step 1 of the Decap CMS GitHub OAuth flow.
// Redirects to GitHub's real login/consent screen. GITHUB_CLIENT_SECRET never
// touches this endpoint — only callback.js needs it, to exchange the code
// GitHub sends back for an access token.
export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const state = crypto.randomUUID()

  const redirectUrl = new URL('https://github.com/login/oauth/authorize')
  redirectUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  redirectUrl.searchParams.set('redirect_uri', `${url.origin}/api/callback`)
  redirectUrl.searchParams.set('scope', 'repo,user')
  redirectUrl.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.href,
      // Read back by callback.js and compared against GitHub's returned `state`
      // to make sure the callback we're completing is one we actually started
      // (CSRF / authorization-code-injection protection).
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  })
}
