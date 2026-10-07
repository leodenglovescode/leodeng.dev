import { createSSRApp } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { renderToString } from 'vue/server-renderer'
import routes from './router/routes.js'
import { setLocale } from './utils/i18n.js'

export { getAllPosts, getPost } from './utils/posts.js'
export { collections } from './utils/gallery.js'

export async function render(url = '/') {
  const app = createSSRApp(App)
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  app.use(router)
  await router.push(url)
  await router.isReady()
  setLocale(router.currentRoute.value.meta?.locale === 'zh' ? 'zh' : 'en', { remember: false })
  return await renderToString(app)
}
