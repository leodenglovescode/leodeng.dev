// Who am I? The admin UI calls this on load to decide between the login screen
// and the editor. Also the only place the browser learns anything about the
// session — never the token itself.
import { json, repoSlug, requireSession } from '../../lib/auth.js'

export async function onRequestGet(context) {
  const session = await requireSession(context.request, context.env)
  if (!session) return json({ authenticated: false }, 401)

  return json({
    authenticated: true,
    login: session.user.login,
    name: session.user.name,
    avatar: session.user.avatar_url,
    repo: repoSlug(context.env),
  })
}
