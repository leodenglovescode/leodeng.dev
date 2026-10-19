import { EnvHttpProxyAgent, fetch as upstreamFetch } from 'undici'
import { createLegacyPreview } from './legacy-server.js'

export function legacyPreviewPlugin() {
  return {
    name: 'legacy-preview',
    apply: 'serve',
    configureServer(server) {
      const dispatcher = new EnvHttpProxyAgent()
      const respond = createLegacyPreview({ directory: `${server.config.root}/dist/_legacy`, fetchUpstream: (url, options) => upstreamFetch(url, { ...options, dispatcher }) })
      server.httpServer?.once('close', () => { void dispatcher.close() })
      server.middlewares.use(async (request, response, next) => {
        if (!/^\/_legacy(?:\/|$)/.test(new URL(request.url, 'http://localhost').pathname)) return next()
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
