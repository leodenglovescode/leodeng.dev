import { createApp } from 'vue'
import router from './router/index.js'
import './style.css'
import App from './App.vue'

router.afterEach((to) => {
  const t = to.meta?.title
  document.title = t ? `${t} — leodeng.dev` : 'leodeng.dev'
})

createApp(App).use(router).mount('#app')
