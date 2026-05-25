import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [vue(), tailwindcss()],
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
