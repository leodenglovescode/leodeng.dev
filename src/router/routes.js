import Home from '../pages/Home.vue'
import Projects from '../pages/Projects.vue'
import Gallery from '../pages/Gallery.vue'
import GalleryCollection from '../pages/GalleryCollection.vue'
import About from '../pages/About.vue'
import Now from '../pages/Now.vue'
import Spotting from '../pages/Spotting.vue'
import Homelab from '../pages/Homelab.vue'
import Tokens from '../pages/Tokens.vue'
import Time from '../pages/Time.vue'
import Changelog from '../pages/Changelog.vue'
import Stack from '../pages/Stack.vue'
import Feed from '../pages/Feed.vue'
import Contact from '../pages/Contact.vue'
import Pgp from '../pages/Pgp.vue'
import Blog from '../pages/Blog.vue'
import BlogPost from '../pages/BlogPost.vue'
import NotFound from '../pages/NotFound.vue'
import enMeta from '../locales/en/meta.json'
import zhMeta from '../locales/zh-CN/meta.json'

function routeMeta(key) {
  return {
    key,
    title: enMeta[key]?.title ?? null,
    titleZh: zhMeta[key]?.title ?? enMeta[key]?.title ?? null,
    description: enMeta[key]?.description,
    descriptionZh: zhMeta[key]?.description,
  }
}

const publicRoutes = [
  { path: '/', component: Home, meta: routeMeta('home') },
  { path: '/about', component: About, meta: routeMeta('about') },
  { path: '/projects', component: Projects, meta: routeMeta('projects') },
  { path: '/gallery', component: Gallery, meta: routeMeta('gallery') },
  { path: '/gallery/:slug', component: GalleryCollection, meta: routeMeta('gallery') },
  { path: '/now', component: Now, meta: routeMeta('now') },
  { path: '/spotting', component: Spotting, meta: routeMeta('spotting') },
  { path: '/homelab', component: Homelab, meta: routeMeta('homelab') },
  { path: '/tokens', component: Tokens, meta: routeMeta('tokens') },
  { path: '/ip', component: () => import('../pages/Ip.vue'), meta: routeMeta('ip') },
  { path: '/time', component: Time, meta: routeMeta('time') },
  { path: '/terminal', component: () => import('../pages/Terminal.vue'), meta: routeMeta('terminal') },
  { path: '/changelog', component: Changelog, meta: routeMeta('changelog') },
  { path: '/stack', component: Stack, meta: routeMeta('stack') },
  { path: '/feed', component: Feed, meta: routeMeta('feed') },
  { path: '/blog', component: Blog, meta: routeMeta('blog') },
  { path: '/blog/:slug', component: BlogPost, meta: routeMeta('blog') },
  { path: '/contact', component: Contact, meta: routeMeta('contact') },
  { path: '/pgp', component: Pgp, meta: routeMeta('pgp') },
  // The Three.js renderer is only useful here, so keep its bundle off every
  // other route just like the admin editor and its markdown dependencies.
  { path: '/interests', component: () => import('../pages/Interests.vue'), meta: routeMeta('interests') },
]

function localizedRoute(route, locale) {
  return {
    ...route,
    path: locale === 'zh'
      ? (route.path === '/' ? '/zh' : `/zh${route.path}`)
      : route.path,
    meta: { ...route.meta, locale },
  }
}

export default [
  ...publicRoutes.map((route) => localizedRoute(route, 'en')),
  ...publicRoutes.map((route) => localizedRoute(route, 'zh')),
  { path: '/personality', redirect: '/interests' },
  { path: '/zh/personality', redirect: '/zh/interests' },
  // Lazy so the editor (and its markdown/preview weight) never lands in the
  // bundle a normal reader downloads. `chrome: false` drops the site navbar and
  // footer because the editor wants the full viewport.
  { path: '/admin', component: () => import('../pages/Admin.vue'), meta: { title: 'Admin', chrome: false, locale: 'en' } },
  { path: '/zh/:pathMatch(.*)*', component: NotFound, meta: { title: '404', locale: 'zh' } },
  { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '404', locale: 'en' } },
]
