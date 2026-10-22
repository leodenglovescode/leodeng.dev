import { clientIp } from '../../lib/daily-ai.js'

// Private service binding only: no routes, workers.dev or preview URL.
export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname
      const state = env.CHAT_STATE.getByName('deepseek-public-chat')
      if (path === '/') {
        const ip = clientIp(request)
        if (request.method !== 'GET' || !ip) return new Response(null, { status: 400 })
        return await state.fetch('https://chat.internal/limit', { headers: { 'cf-connecting-ip': ip } })
      }
      if (!['/status', '/prepare', '/history', '/finish', '/control'].includes(path)) return new Response(null, { status: 404 })
      return await state.fetch(request)
    } catch { return new Response(null, { status: 503 }) }
  },
}
