import { clientIp } from '../../lib/daily-ai.js'

// No routes or public Worker URLs. Only the Pages service binding can call it.
export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname
      const hub = env.LIVE_HUB.getByName('superserver-qwen')
      if (path === '/') {
        const ip = clientIp(request)
        if (request.method !== 'GET' || !ip) return new Response(null, { status: 400 })
        return await hub.fetch('https://hub.internal/limit', { headers: { 'cf-connecting-ip': ip } })
      }
      const actions = ['/status', '/start', '/job', '/stream', '/reset', '/cancel', '/agent']
      if (!actions.includes(path)) return new Response(null, { status: 404 })
      return await hub.fetch(request)
    } catch {
      return new Response(null, { status: 503 })
    }
  },
}
