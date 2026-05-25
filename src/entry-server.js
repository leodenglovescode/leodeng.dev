import { createSSRApp } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { renderToString } from 'vue/server-renderer'
import routes from './router/routes.js'

export async function render(url = '/') {
  const app = createSSRApp(App)
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  app.use(router)
  await router.push(url)
  await router.isReady()
  return await renderToString(app)
}
