import { createSSRApp } from 'vue'
import App from './App.vue'
import { renderToString } from 'vue/server-renderer'

export async function render() {
  const app = createSSRApp(App)
  return await renderToString(app)
}
