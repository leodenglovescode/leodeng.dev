import { createApp, createSSRApp, watch } from 'vue'
import router from './router/index.js'
import './style.css'
import App from './App.vue'
import { initLocale, locale, setLocale } from './utils/i18n.js'
import { localePath, stripLocalePath } from './utils/localePath.js'
import enMeta from './locales/en/meta.json'
import zhMeta from './locales/zh-CN/meta.json'

const { preferredLocale } = initLocale(window.location.pathname)

function setMeta(selector, attribute, value) {
  document.querySelector(selector)?.setAttribute(attribute, value)
}

function setLink(rel, hreflang, href) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`
  let link = document.querySelector(selector)
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    if (hreflang) link.hreflang = hreflang
    document.head.appendChild(link)
  }
  link.href = href
}

function updateMeta(to) {
  const isChinese = locale.value === 'zh'
  const title = isChinese ? (to.meta?.titleZh ?? to.meta?.title) : to.meta?.title
  const description = (isChinese ? to.meta?.descriptionZh : to.meta?.description)
    || (isChinese ? zhMeta.defaultDescription : enMeta.defaultDescription)
  const fullTitle = title ? `${title} | leodeng.dev` : 'leodeng.dev'
  const basePath = stripLocalePath(to.path)
  const enUrl = `https://leodeng.dev${localePath(basePath, 'en')}`
  const zhUrl = `https://leodeng.dev${localePath(basePath, 'zh')}`
  const currentUrl = isChinese ? zhUrl : enUrl

  document.title = fullTitle
  document.documentElement.lang = isChinese ? 'zh-CN' : 'en'
  setMeta('meta[name="description"]', 'content', description)
  setMeta('meta[property="og:title"]', 'content', fullTitle)
  setMeta('meta[property="og:description"]', 'content', description)
  setMeta('meta[property="og:url"]', 'content', currentUrl)
  setMeta('meta[property="og:locale"]', 'content', isChinese ? 'zh_CN' : 'en_US')
  setMeta('meta[name="twitter:title"]', 'content', fullTitle)
  setMeta('meta[name="twitter:description"]', 'content', description)
  setLink('canonical', null, currentUrl)
  setLink('alternate', 'en', enUrl)
  setLink('alternate', 'zh-CN', zhUrl)
  setLink('alternate', 'x-default', enUrl)
}

router.afterEach((to) => {
  setLocale(to.meta?.locale === 'zh' ? 'zh' : 'en', { remember: false })
  updateMeta(to)
})

watch(locale, () => updateMeta(router.currentRoute.value))

async function mount() {
  const container = document.querySelector('#app')
  const factory = container?.hasChildNodes() ? createSSRApp : createApp
  const app = factory(App).use(router)
  await router.isReady()
  app.mount(container)

  // A saved choice wins, otherwise browsers normally inherit this preference
  // from the operating system. Only the neutral landing URL auto-selects so a
  // deliberately opened deep link remains stable and shareable.
  if (router.currentRoute.value.path === '/' && preferredLocale === 'zh') {
    await router.replace(localePath(router.currentRoute.value.fullPath, 'zh'))
  }
}

mount()
