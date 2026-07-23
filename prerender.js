import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const staticRoutes = [
  { path: '/',          title: null },
  { path: '/about',     title: 'About' },
  { path: '/projects',  title: 'Projects' },
  { path: '/gallery',   title: 'Gallery' },
  { path: '/now',       title: 'Now' },
  { path: '/feed',      title: 'RSS Feed' },
  { path: '/blog',      title: 'Blog' },
  { path: '/contact',   title: 'Contact' },
]

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function withMeta(html, { title, description }) {
  const fullTitle = title ? `${title} — leodeng.dev` : 'leodeng.dev'
  let out = html.replace(/<title>.*?<\/title>/, `<title>${fullTitle}</title>`)
  out = out.replace(/(<meta property="og:title"\s+content=").*?(")/, `$1${fullTitle}$2`)
  out = out.replace(/(<meta name="twitter:title"\s+content=").*?(")/, `$1${fullTitle}$2`)
  if (description) {
    out = out.replace(/(<meta name="description" content=").*?(")/, `$1${description}$2`)
    out = out.replace(/(<meta property="og:description" content=").*?(")/, `$1${description}$2`)
    out = out.replace(/(<meta name="twitter:description" content=").*?(")/, `$1${description}$2`)
  }
  return out
}

async function prerender() {
  const { render, getAllPosts, getPost } = await import('./dist-ssr/entry-server.js')

  const templatePath = path.join(__dirname, 'dist/index.html')
  const template = fs.readFileSync(templatePath, 'utf-8')

  const postRoutes = getAllPosts().map(p => ({
    path: `/blog/${p.slug}`,
    title: p.title,
    description: p.description,
  }))

  const routes = [...staticRoutes, ...postRoutes]

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

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...routes.map(r => `  <url><loc>https://leodeng.dev${r.path}</loc></url>`),
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
