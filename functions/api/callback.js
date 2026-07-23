// Step 2 of the Decap CMS GitHub OAuth flow.
// Exchanges GitHub's temporary authorization code for a real access token
// (needs GITHUB_CLIENT_SECRET, which is why this can't happen in the browser),
// then hands the token back to the Decap CMS popup via the postMessage
// handshake it expects: https://decapcms.org/docs/backends-overview/

function renderBody(status, content) {
  return `<script>
    (function() {
      function receiveMessage(message) {
        window.opener.postMessage(
          'authorization:github:${status}:${JSON.stringify(content)}',
          message.origin
        )
        window.removeEventListener('message', receiveMessage, false)
      }
      window.addEventListener('message', receiveMessage, false)
      window.opener.postMessage('authorizing:github', '*')
    })()
  </script>`
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : null
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expectedState = getCookie(request, 'oauth_state')

  if (!state || !expectedState || state !== expectedState) {
    return new Response('Invalid OAuth state — please try logging in again.', { status: 401 })
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'leodeng-dev-decap-cms-oauth',
        accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    })
    const result = await response.json()

    if (result.error) {
      return new Response(renderBody('error', result), {
        status: 401,
        headers: { 'content-type': 'text/html;charset=UTF-8' },
      })
    }

    const body = renderBody('success', { token: result.access_token, provider: 'github' })
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html;charset=UTF-8',
        // one-time use — clear it now that the exchange is done
        'Set-Cookie': 'oauth_state=; Path=/; Max-Age=0',
      },
    })
  } catch (err) {
    return new Response(err.message, { status: 500 })
  }
}
