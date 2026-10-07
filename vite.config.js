import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { templateCompilerOptions } from '@tresjs/core'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [vue({ ...templateCompilerOptions }), tailwindcss()],
  server: {
    // Plain Vite does not run Pages Functions. Proxy the public, read-only
    // endpoints so the clock and now-playing data can be previewed locally.
    proxy: {
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
}))
