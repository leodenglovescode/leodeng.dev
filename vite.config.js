import { defineConfig } from 'vite'
import { localAdminPlugin } from './scripts/local-admin.js'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { templateCompilerOptions } from '@tresjs/core'

const audioProxy = {
  target: 'https://media.leodeng.dev',
  changeOrigin: true,
  rewrite: path => path.replace(/^\/api\/terminal-audio\//, '/voice/'),
}

export default defineConfig(async ({ isSsrBuild, command }) => {
  // Load preview tooling only at dev-server startup. A static import would
  // make Vite's config bundler resolve the CLI's not-yet-built SSR artifact.
  const previewPlugins = command === 'serve'
    ? [(await import(new URL('./scripts/legacy-dev.js', import.meta.url).href)).legacyPreviewPlugin()]
    : []
  return {
    plugins: [...previewPlugins, localAdminPlugin(), vue({ ...templateCompilerOptions }), tailwindcss()],
    server: {
      // Plain Vite does not run Pages Functions. Proxy the public, read-only
      // endpoints so the clock and now-playing data can be previewed locally.
      proxy: {
        '/api/terminal-audio': audioProxy,
        '/api/time': {
          target: 'https://leodeng.dev',
          changeOrigin: true,
        },
        '/api/now-playing': {
          target: 'https://leodeng.dev',
          changeOrigin: true,
        },
      },
    },
    preview: { proxy: { '/api/terminal-audio': audioProxy } },
    build: {
      rollupOptions: {
        output: isSsrBuild ? {} : {
          manualChunks: {
            'highlight': ['highlight.js/lib/common'],
            'marked': ['marked'],
          }
        }
      }
    }
  }
})
