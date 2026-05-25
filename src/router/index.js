import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes.js'

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
