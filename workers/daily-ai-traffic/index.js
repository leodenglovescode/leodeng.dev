import { clientIp } from '../../lib/daily-ai.js'

// No routes, workers.dev or preview URL: only a trusted service binding can
// call this Worker. Pages supplies a canonical Cloudflare client address.
export default {
  async fetch(request, env) {
    try {
      const ip = clientIp(request)
      if (request.method !== 'GET' || !ip) return new Response(null, { status: 400 })
      if (!(await env.PER_IP.limit({ key: ip })).success) return new Response(null, { status: 429 })
      if (!(await env.OVERALL.limit({ key: 'daily-ai' })).success) return new Response(null, { status: 429 })
      return new Response(null, { status: 204 })
    } catch {
      return new Response(null, { status: 503 })
    }
  },
}
