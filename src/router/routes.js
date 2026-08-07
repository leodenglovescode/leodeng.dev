import Home from '../pages/Home.vue'
import Projects from '../pages/Projects.vue'
import Gallery from '../pages/Gallery.vue'
import GalleryCollection from '../pages/GalleryCollection.vue'
import About from '../pages/About.vue'
import Now from '../pages/Now.vue'
import Spotting from '../pages/Spotting.vue'
import Changelog from '../pages/Changelog.vue'
import Stack from '../pages/Stack.vue'
import Feed from '../pages/Feed.vue'
import Contact from '../pages/Contact.vue'
import Blog from '../pages/Blog.vue'
import BlogPost from '../pages/BlogPost.vue'
import NotFound from '../pages/NotFound.vue'

export default [
  { path: '/',          component: Home,     meta: { title: null } },
  { path: '/about',     component: About,    meta: { title: 'About' } },
  { path: '/projects',  component: Projects, meta: { title: 'Projects' } },
  { path: '/gallery',   component: Gallery,  meta: { title: 'Gallery' } },
  { path: '/gallery/:slug', component: GalleryCollection, meta: { title: 'Gallery' } },
  { path: '/now',       component: Now,      meta: { title: 'Now' } },
  { path: '/spotting',  component: Spotting, meta: { title: 'Spotting Stats' } },
  { path: '/changelog', component: Changelog, meta: { title: 'Changelog' } },
  { path: '/stack',     component: Stack,    meta: { title: 'Stack' } },
  { path: '/feed',      component: Feed,     meta: { title: 'RSS Feed' } },
  { path: '/blog',      component: Blog,     meta: { title: 'Blog' } },
  { path: '/blog/:slug',component: BlogPost, meta: { title: 'Blog' } },
  { path: '/contact',   component: Contact,  meta: { title: 'Contact' } },
  // Lazy so the editor (and its markdown/preview weight) never lands in the
  // bundle a normal reader downloads. `chrome: false` drops the site navbar and
  // footer — the editor wants the full viewport.
  { path: '/admin',     component: () => import('../pages/Admin.vue'), meta: { title: 'Admin', chrome: false } },
  { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '404' } },
]
