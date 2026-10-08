import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { localePath } from './src/utils/localePath.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const enMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/locales/en/meta.json'), 'utf8'))
const zhMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/locales/zh-CN/meta.json'), 'utf8'))

const staticRoutes = [
  { path: '/', key: 'home' },
  { path: '/about', key: 'about' },
  { path: '/projects', key: 'projects' },
  { path: '/gallery', key: 'gallery' },
  { path: '/now', key: 'now' },
  { path: '/spotting', key: 'spotting' },
  { path: '/changelog', key: 'changelog' },
  { path: '/homelab', key: 'homelab' },
  { path: '/tokens', key: 'tokens' },
  { path: '/time', key: 'time' },
  { path: '/terminal', key: 'terminal' },
  { path: '/stack', key: 'stack' },
  { path: '/feed', key: 'feed' },
  { path: '/blog', key: 'blog' },
  { path: '/contact', key: 'contact' },
  { path: '/pgp', key: 'pgp' },
  { path: '/interests', key: 'interests' },
]

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function withMeta(html, { path: routePath, title, description, locale }) {
  const fullTitle = title ? `${title} | leodeng.dev` : 'leodeng.dev'
  const safeTitle = escapeAttribute(fullTitle)
  const safeDescription = escapeAttribute(description)
  const basePath = locale === 'zh' ? routePath.replace(/^\/zh(?=\/|$)/, '') || '/' : routePath
  const enUrl = `https://leodeng.dev${localePath(basePath, 'en')}`
  const zhUrl = `https://leodeng.dev${localePath(basePath, 'zh')}`
  const currentUrl = locale === 'zh' ? zhUrl : enUrl
  let out = html.replace(/<html lang="[^"]*"/, `<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"`)
  out = out.replace(/<title>.*?<\/title>/, `<title>${safeTitle}</title>`)
  out = out.replace(/(<meta name="description" content=").*?(")/, `$1${safeDescription}$2`)
  out = out.replace(/(<meta property="og:title"\s+content=").*?(")/, `$1${safeTitle}$2`)
  out = out.replace(/(<meta property="og:description" content=").*?(")/, `$1${safeDescription}$2`)
  out = out.replace(/(<meta property="og:url"\s+content=").*?(")/, `$1${currentUrl}$2`)
  out = out.replace(/(<meta property="og:locale"\s+content=").*?(")/, `$1${locale === 'zh' ? 'zh_CN' : 'en_US'}$2`)
  out = out.replace(/(<meta name="twitter:title"\s+content=").*?(")/, `$1${safeTitle}$2`)
  out = out.replace(/(<meta name="twitter:description" content=").*?(")/, `$1${safeDescription}$2`)
  out = out.replace(/(<link rel="canonical" href=").*?(")/, `$1${currentUrl}$2`)
  out = out.replace(/(<link rel="alternate" hreflang="en" href=").*?(")/, `$1${enUrl}$2`)
  out = out.replace(/(<link rel="alternate" hreflang="zh-CN" href=").*?(")/, `$1${zhUrl}$2`)
  out = out.replace(/(<link rel="alternate" hreflang="x-default" href=").*?(")/, `$1${enUrl}$2`)
  return out
}

function localizeRoute(route, locale) {
  const meta = locale === 'zh' ? zhMeta : enMeta
  const entry = route.key ? meta[route.key] : null
  return {
    ...route,
    locale,
    path: localePath(route.path, locale),
    title: entry?.title ?? route.title ?? null,
    description: entry?.description ?? route.description ?? meta.defaultDescription,
  }
}

async function prerender() {
  const { render, getAllPosts, getPost, collections } = await import('./dist-ssr/entry-server.js')

  const templatePath = path.join(__dirname, 'dist/index.html')
  const template = fs.readFileSync(templatePath, 'utf-8')

  const postRoutes = getAllPosts().map(p => ({
    path: `/blog/${p.slug}`,
    title: p.title,
    description: p.description,
  }))

  const collectionRoutes = collections.map(c => ({
    path: `/gallery/${c.slug}`,
    title: c.title,
    description: c.description,
  }))

  const baseRoutes = [...staticRoutes, ...postRoutes, ...collectionRoutes]
  const routes = baseRoutes.flatMap((route) => [
    localizeRoute(route, 'en'),
    localizeRoute(route, 'zh'),
  ])

  for (const route of routes) {
    const appHtml = await render(route.path)
    const page = withMeta(
      template.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`),
      route
    )

    const outPath = route.path === '/'
      ? templatePath
      : path.join(__dirname, 'dist', `${route.path.slice(1)}.html`)

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, page)
    console.log(`✓ Pre-rendered ${route.path}`)
  }

  const sitemapRoutes = baseRoutes.map((route) => ({
    en: `https://leodeng.dev${localePath(route.path, 'en')}`,
    zh: `https://leodeng.dev${localePath(route.path, 'zh')}`,
  }))
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...sitemapRoutes.flatMap(({ en, zh }) => [en, zh].map((url) => [
      '  <url>',
      `    <loc>${url}</loc>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${en}" />`,
      `    <xhtml:link rel="alternate" hreflang="zh-CN" href="${zh}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${en}" />`,
      '  </url>',
    ].join('\n'))),
    '</urlset>',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(__dirname, 'dist/sitemap.xml'), sitemap)
  console.log('✓ Generated sitemap.xml')

  const rssItems = postRoutes.map(r => {
    const post = getPost(r.path.replace('/blog/', ''))
    const link = `https://leodeng.dev${r.path}`
    return [
      '  <item>',
      `    <title>${escapeXml(r.title)}</title>`,
      `    <link>${link}</link>`,
      `    <guid>${link}</guid>`,
      `    <pubDate>${new Date(post.date).toUTCString()}</pubDate>`,
      r.description ? `    <description>${escapeXml(r.description)}</description>` : '',
      `    <content:encoded><![CDATA[${post.html}]]></content:encoded>`,
      '  </item>',
    ].filter(Boolean).join('\n')
  })

  const rss = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    '    <title>leodeng.dev</title>',
    '    <link>https://leodeng.dev/blog</link>',
    '    <description>Leo Deng\'s blog: self-hosting, IoT, and building things.</description>',
    '    <language>en</language>',
    ...rssItems,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(__dirname, 'dist/rss.xml'), rss)
  console.log('✓ Generated rss.xml')
}

prerender().catch(err => {
  console.error('Pre-render failed:', err)
  process.exit(1)
})
