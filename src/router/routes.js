import Home from '../pages/Home.vue'
import Projects from '../pages/Projects.vue'
import Gallery from '../pages/Gallery.vue'
import About from '../pages/About.vue'
import Now from '../pages/Now.vue'
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
  { path: '/now',       component: Now,      meta: { title: 'Now' } },
  { path: '/feed',      component: Feed,     meta: { title: 'RSS Feed' } },
  { path: '/blog',      component: Blog,     meta: { title: 'Blog' } },
  { path: '/blog/:slug',component: BlogPost, meta: { title: 'Blog' } },
  { path: '/contact',   component: Contact,  meta: { title: 'Contact' } },
  { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '404' } },
]
