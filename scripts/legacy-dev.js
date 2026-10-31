import { Agent, EnvHttpProxyAgent, fetch as upstreamFetch } from 'undici'
import { loadLyricsEnvironment } from './lyrics-config.js'
import { createLegacyPreview } from './legacy-server.js'

export function legacyPreviewPlugin({ fetchUpstream, lyricsEnv } = {}) {
  return {
    name: 'legacy-preview',
    apply: 'serve',
    configureServer(server) {
      const dispatcher = fetchUpstream ? null : new EnvHttpProxyAgent()
      const direct = fetchUpstream ? null : new Agent()
      const respond = createLegacyPreview({ directory: `${server.config.root}/dist/_legacy`, lyricsEnv: lyricsEnv || (fetchUpstream ? {} : loadLyricsEnvironment(server.config.root)), fetchUpstream: fetchUpstream || ((url, options) => upstreamFetch(url, { ...options, dispatcher: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ? direct : dispatcher })) })
      if (dispatcher) server.httpServer?.once('close', () => { void Promise.allSettled([dispatcher.close(), direct.close()]) })
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname
        // The classic script uses same-origin API URLs even under /_legacy/.
        // Handle lyrics here too, before Vite's SPA HTML fallback.
        if (!/^\/_legacy(?:\/|$)/.test(pathname) && pathname !== '/api/lyrics' && pathname !== '/api/stats/monkeytype' && pathname !== '/api/stats/music' && pathname !== '/api/stats/music-artwork') return next()
        try {
          const result = await respond(new Request(new URL(request.url, 'http://localhost'), { method: request.method }))
          response.statusCode = result.status
          for (const [name, value] of result.headers) response.setHeader(name, value)
          response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()))
        } catch {
          response.statusCode = 503
          response.end('Run npm run build to prepare the classic edition.')
        }
      })
    },
  }
}
