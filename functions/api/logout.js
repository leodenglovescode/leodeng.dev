import { SESSION_COOKIE, clearCookie, json } from '../../lib/auth.js'

export async function onRequestPost({ request }) {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(request, SESSION_COOKIE) })
}
