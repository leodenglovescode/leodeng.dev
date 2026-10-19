import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, parseFragment, serialize } from 'parse5'
import { interests } from '../src/content/interests.js'
import { compareShelfTitles, shelfLink, shelfStatus } from '../src/utils/shelf.js'
import { LEGACY_ORIGIN, MODERN_ORIGIN } from '../lib/legacy.js'
import { renderLegacyDiagrams } from './legacy-diagrams.js'
import { legacyJournalIndex, legacyJournalPost, legacyDaybook } from './legacy-editorial.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist/_legacy')
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const readJson = name => fs.readFile(path.join(root, name), 'utf8').then(JSON.parse)
const routeDirectory = route => route === '/' ? '/' : `${route.replace(/\/+$/, '')}/`

export function relativeLink(from, to) {
  if (to.startsWith(`${MODERN_ORIGIN}/`)) to = to.slice(MODERN_ORIGIN.length)
  if (!to.startsWith('/') || to.startsWith('//')) return to
  const url = new URL(to, MODERN_ORIGIN)
  if (/^\/(?:api|rss\.xml|pgp|projects_screenshots|linux|favicon|apple-touch)/.test(url.pathname)
      && /\.[a-z0-9]+$/i.test(url.pathname)) return `${MODERN_ORIGIN}${url.pathname}${url.search}${url.hash}`
  const destination = /\.[a-z0-9]+$/i.test(url.pathname) ? url.pathname : routeDirectory(url.pathname)
  const relative = path.posix.relative(routeDirectory(from), destination) || '.'
  return `${relative}${destination.endsWith('/') ? '/' : ''}${url.search}${url.hash}`
}

function attr(node, name) { return node.attrs?.find(attribute => attribute.name === name)?.value || '' }
function setAttr(node, name, value) {
  node.attrs ||= []
  const existing = node.attrs.find(attribute => attribute.name === name)
  if (existing) existing.value = value
  else node.attrs.push({ name, value })
}
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result }
}
function localized(item, locale) { return typeof item === 'string' ? item : item?.[locale] || item?.en || '' }
function compatibleImage(source, media, route = '/') {
  if (media.images[source]) {
    const url = media.images[source]
    const match = url.match(/^https:\/\/media\.leodeng\.dev\/legacy\/images\/([a-f0-9]{64}\.jpg)$/)
    return match ? relativeLink(route, `/_assets/media/${match[1]}`) : url
  }
  if (/\.webp(?:[?#]|$)/i.test(source)) return ''
  return source.startsWith('/') ? `${MODERN_ORIGIN}${source}` : source
}
function picture(source, alt, media, className = '', route = '/') {
  const src = compatibleImage(source, media, route)
  return src ? `<img class="${className}" src="${escape(src)}" alt="${escape(alt)}">` : `<span class="image-placeholder">${escape(alt)}</span>`
}

// Reuse the rendered page, including blog HTML, translations and metadata.
// Navigation and presentation are rebuilt, and controls needing Vue are removed.
export function readableContent(html, route, media = { images: {} }) {
  const document = parse(html)
  const main = find(document, node => node.tagName === 'main')
  if (!main) throw new Error(`Missing rendered content for ${route}`)
  function walk(parent) {
    parent.childNodes = (parent.childNodes || []).flatMap(node => {
      if (node.nodeName === '#comment') return []
      if (!node.tagName) return [node]
      const classes = attr(node, 'class').split(/\s+/)
      const originalStyle = attr(node, 'style')
      const classicColumn = attr(node, 'data-classic-column') === 'true'
      if (['script', 'style', 'svg', 'canvas', 'dialog', 'button', 'input', 'select', 'textarea', 'iframe'].includes(node.tagName)
          || attr(node, 'aria-hidden') === 'true' || attr(node, 'data-legacy-hide') === 'true' || classes.includes('sr-only')) return []
      const keep = node.attrs.filter(a => ['href', 'src', 'alt', 'title', 'id', 'lang', 'colspan', 'rowspan', 'datetime', 'controls', 'type', 'download'].includes(a.name))
      node.attrs = keep
      const useful = classes.filter(c => /^(?:prose|callout(?:-\w+)?|mermaid-block|mermaid-source)$/.test(c))
      if (/^\/(?:zh\/)?blog\//.test(route) && ['code', 'span'].includes(node.tagName)) {
        useful.push(...classes.filter(c => /^(?:hljs(?:-[\w-]+)?|language-[\w-]+)$/.test(c)))
      }
      if (/^\/(?:zh\/)?spotting$/.test(route)) {
        if (classes.includes('grid')) useful.push('spotting-metrics')
        if (classes.includes('bg-bg') && classes.includes('p-4')) useful.push('spotting-stat')
        if (classes.includes('items-end')) {
          useful.push('histogram')
          for (const column of node.childNodes || []) {
            if (column.tagName === 'div') setAttr(column, 'data-classic-column', 'true')
          }
        }
        if (classicColumn) useful.push('histogram-column')
        if (classes.includes('flex') && classes.includes('text-xs') && (classes.includes('gap-1') || classes.includes('gap-[3px]'))) useful.push('histogram-labels')
        if (classes.includes('h-1.5') || classes.includes('h-4')) useful.push('usage-track')
        if (classes.includes('h-full')) useful.push('usage-fill')
        if (classes.includes('items-center') && (classes.includes('gap-3') || classes.includes('gap-4'))) useful.push('distribution-row')
        if (node.tagName === 'section') useful.push('spotting-report')
        // Only numeric chart dimensions from the shared rendered statistics.
        const dimension = originalStyle.match(/^(width|height):\s*(\d+(?:\.\d+)?)%;?$/)
        if (dimension) setAttr(node, 'style', `${dimension[1]}:${Math.min(100, Number(dimension[2]))}%`)
      }
      if (/^\/(?:zh\/)?stack$/.test(route)) {
        if (classes.includes('rounded-lg')) useful.push('equipment-box')
        if (classes.includes('grid')) useful.push('equipment-list')
        if (classes.includes('font-semibold')) useful.push('equipment-name')
      }
      if (classes.includes('rounded-full') && node.tagName === 'span') useful.push('tag')
      if (node.tagName === 'article') useful.push('content-card')
      if (useful.length) setAttr(node, 'class', useful.join(' '))
      const href = attr(node, 'href')
      if (href) {
        if (/^(?:javascript|data|vbscript):/i.test(href.trim())) return []
        setAttr(node, 'href', relativeLink(route, href))
      }
      if (node.tagName === 'img') {
        const src = compatibleImage(attr(node, 'src'), media, route)
        if (!src) {
          return parseFragment(`<p class="image-placeholder">${escape(attr(node, 'alt'))}</p>`).childNodes
        }
        setAttr(node, 'src', src)
        if (attr(node, 'alt') === 'Leo Deng') setAttr(node, 'class', 'avatar')
      }
      if (['video', 'audio'].includes(node.tagName)) {
        setAttr(node, 'controls', '')
        setAttr(node, 'preload', 'none')
      }
      walk(node)
      if (classicColumn) {
        const columns = node.parentNode.childNodes.filter(child => child.tagName === 'div').length
        const height = originalStyle.match(/^height:\s*(\d+(?:\.\d+)?)%;?$/)
        setAttr(node, 'style', `width:${100 / Math.max(1, columns)}%`)
        const percent = height ? Math.min(100, Number(height[1])) : 0
        node.childNodes = parseFragment(`<span class="histogram-bar" style="height:${percent}%;${percent ? '' : 'border:0;'}"></span>`).childNodes
      }
      return [node]
    })
  }
  walk(main)
  return serialize(main)
}

export async function buildLegacySite({ routes, collections }) {
  const [shelf, media, enCommon, zhCommon, enMeta, zhMeta, enInterests, zhInterests, enShelf, zhShelf] = await Promise.all([
    readJson('src/content/shelf.json'), readJson('src/generated/legacy-media.json'),
    readJson('src/locales/en/common.json'), readJson('src/locales/zh-CN/common.json'),
    readJson('src/locales/en/meta.json'), readJson('src/locales/zh-CN/meta.json'),
    readJson('src/locales/en/interests.json'), readJson('src/locales/zh-CN/interests.json'),
    readJson('src/locales/en/shelf.json'), readJson('src/locales/zh-CN/shelf.json'),
  ])
  await fs.rm(output, { recursive: true, force: true })
  await fs.mkdir(path.join(output, '_assets'), { recursive: true })
  for (const name of ['legacy.css', 'legacy.js']) await fs.copyFile(path.join(root, 'legacy', name), path.join(output, '_assets', name))
  const navigation = ['home', 'about', 'projects', 'gallery', 'blog', 'contact', 'now', 'shelf', 'interests', 'stack', 'spotting', 'homelab', 'tokens', 'time', 'ip', 'terminal', 'changelog', 'feed', 'pgp']
  const css = (await fs.readFile(path.join(root, 'legacy/legacy.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
  const localeRoute = (base, locale) => locale === 'zh' ? `/zh${base === '/' ? '' : base}` : base
  function shell(route, content, extra = '') {
    const zh = route.locale === 'zh'
    const common = zh ? zhCommon : enCommon
    const meta = zh ? zhMeta : enMeta
    const base = route.path.replace(/^\/zh(?=\/|$)/, '') || '/'
    const surface = /^\/blog(?:\/|$)/.test(base) ? ' journal-surface' : base === '/now' ? ' daybook-surface' : ''
    const other = localeRoute(base, zh ? 'en' : 'zh')
    const modern = new URL(base === '/' && zh ? '/zh' : route.path, MODERN_ORIGIN)
    modern.searchParams.set('view', 'modern')
    const label = key => common.nav?.[key] || common[key] || meta[key]?.title || key.toUpperCase()
    const link = to => escape(relativeLink(route.path, to))
    const playing = `<section id="now-playing" class="sidebar-card" hidden data-live="now-playing"><h2>${zh ? 'Leo 正在听' : 'Leo is now playing'}</h2><div id="now-playing-content"></div></section>`
    const active = key => (key === 'home' ? base === '/' : base === `/${key}` || base.startsWith(`/${key}/`)) ? ' class="active" aria-current="page"' : ''
    const recent = routes.filter(item => item.locale === route.locale && /^\/(?:zh\/)?blog\/[^/]+$/.test(item.path)).slice(0, 3)
    const homeModules = base === '/' ? `<section class="home-section edition-notice"><h2>${zh ? '经典版网站' : 'You are on the classic site'}</h2><p id="edition-reason">${zh ? '这里是为旧设备设计的轻量版网站。' : 'This edition is designed for older devices and browsers.'}</p><p class="agent-label">${zh ? '你的浏览器 User-Agent：' : 'Your browser user agent:'}</p><code id="browser-agent">${zh ? '启用 JavaScript 后显示。' : 'Available when JavaScript is enabled.'}</code><p><a href="${escape(modern.href)}">${zh ? '切换到完整版网站' : 'Switch to the full site'}</a></p></section><section class="home-section"><h2>${zh ? '随便看看' : 'Around here'}</h2><div class="feature-links">${[
      ['projects', '01'], ['blog', '02'], ['gallery', '03'],
    ].map(([key, number]) => `<a href="${link(localeRoute(`/${key}`, route.locale))}"><span class="feature-number">${number}</span>${escape(label(key))}</a>`).join('')}</div></section><section class="home-section"><h2>${zh ? '最近的文章' : 'Recent writing'}</h2><ul class="recent-posts">${recent.map(post => `<li><a href="${link(post.path)}">${escape(post.title)}</a>${post.description ? `<p>${escape(post.description)}</p>` : ''}</li>`).join('')}</ul></section>` : ''
    return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}" data-legacy-page="true"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=no">
<title>${escape(route.title || 'Leo Deng')} | leodeng.dev</title>
<meta name="description" content="${escape(route.description || '')}">
<link rel="canonical" href="${escape(new URL(route.path, MODERN_ORIGIN).href)}">
<link rel="alternate" type="application/rss+xml" href="${MODERN_ORIGIN}/rss.xml" title="RSS">
<style id="legacy-style">${css}</style>
<script src="${link('/_assets/legacy.js')}" defer></script>
</head><body id="top">
<a class="skip-link" href="#content">${zh ? '跳到正文' : 'Skip to content'}</a>
<header class="masthead"><div class="header-inner"><a class="wordmark" href="${link(localeRoute('/', route.locale))}"><span class="site-mark">ld</span>leodeng.dev</a>
<span class="edition">${zh ? '经典 HTML 版' : 'CLASSIC HTML'}</span>
<div class="top-links"><a href="${link(other)}">${zh ? 'English' : '中文'}</a> &middot; <a href="${escape(modern.href)}">${zh ? '完整版网站' : 'Full site'}</a></div>
<p class="edition-note">${zh ? '欢迎来到我的个人主页。项目、笔记，还有一些我喜欢的东西。' : 'Welcome to my homepage. Projects, notes, and a few things I like.'}</p></div></header>
<nav class="main-nav" aria-label="${zh ? '网站导航' : 'Site navigation'}"><div class="nav-inner">${navigation.slice(0, 6).map(key => `<a${active(key)} href="${link(localeRoute(key === 'home' ? '/' : `/${key}`, route.locale))}">${escape(label(key))}</a>`).join(' ')}</div></nav>
<div class="page"><div class="page-layout"><main id="content" class="content-column"><div class="content-panel${surface}"><div class="panel-bar">&raquo; ${escape(base === '/' ? label('home') : route.title || label('home'))}</div>${content}</div>${homeModules}</main>
<aside class="sidebar" aria-label="${zh ? '关于我和更多页面' : 'About me and more pages'}"><section class="sidebar-card profile-card"><h2 class="sidebar-title">${zh ? '关于站长' : 'About the webmaster'}</h2>${picture('/leo_profilepic.webp', 'Leo Deng', media, 'avatar', route.path)}<p class="profile-name">Leo Deng</p><p class="profile-location">${zh ? '北京，中国' : 'Beijing, China'}</p><a class="profile-link" href="${link(localeRoute('/about', route.locale))}">${zh ? '个人资料' : 'View profile'}</a></section>
${playing}${extra}<section class="sidebar-card"><h2 class="sidebar-title">${zh ? '站内导航' : 'Site directory'}</h2><nav class="side-nav">${navigation.slice(6).map(key => `<a${active(key)} href="${link(localeRoute(`/${key}`, route.locale))}">${escape(label(key))}</a>`).join('')}</nav></section>
<section class="sidebar-card"><h2 class="sidebar-title">${zh ? '保持联系' : 'Keep in touch'}</h2><ul class="contact-links"><li><a href="mailto:leodeng@leodeng.dev">${zh ? '邮箱' : 'Email'}: leodeng@leodeng.dev</a></li><li><a href="https://x.com/Leodeng14">X (Twitter)</a></li><li><a href="https://github.com/leodenglovescode">GitHub</a></li><li><a href="${MODERN_ORIGIN}/rss.xml">RSS</a></li></ul></section></aside></div>
<footer class="site-footer"><div class="web-buttons"><a class="web-button" href="${link(localeRoute('/', route.locale))}"><strong>HTML + CSS</strong>CLASSIC WEB</a><a class="web-button web-button-rss" href="${MODERN_ORIGIN}/rss.xml"><strong>RSS FEED</strong>SUBSCRIBE</a><a class="web-button" href="#top"><strong>BACK TO TOP</strong>^ ^ ^</a></div><p>${new Date().getUTCFullYear()} &copy; Leo Deng &middot; <a href="${LEGACY_ORIGIN}${escape(routeDirectory(route.path))}">old.leodeng.dev</a> &middot; <a href="${link(localeRoute('/contact', route.locale))}">${escape(label('contact'))}</a></p></footer></div>
</body></html>\n`
  }
  async function write(route, content, extra) {
    const destination = path.join(output, route.path.slice(1), 'index.html')
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, shell(route, content, extra))
  }
  const pageSize = 10
  for (const route of routes) {
    const zh = route.locale === 'zh'
    const base = route.path.replace(/^\/zh(?=\/|$)/, '') || '/'
    const source = path.join(root, 'dist', route.path === '/' ? 'index.html' : `${route.path.slice(1)}.html`)
    let content = renderLegacyDiagrams(readableContent(await fs.readFile(source, 'utf8'), route.path, media), zh)
    if (base === '/blog') content = legacyJournalIndex(content, zh)
    else if (base.startsWith('/blog/')) content = legacyJournalPost(content, zh)
    else if (base === '/now') content = legacyDaybook(content, await readJson(`src/locales/${zh ? 'zh-CN' : 'en'}/now.json`), zh)
    let extra = ''
    if (base === '/') {
      // The modern clock is interactive. Its content lives on /time here.
      const homeCopy = await readJson(`src/locales/${zh ? 'zh-CN' : 'en'}/home.json`)
      content = content.replace(/<p title="[^"]*">[^<]*<span>▊<\/span><\/p>/, `<p class="note">${escape(homeCopy.statuses[0])}</p>`)
      const fragment = parseFragment(content)
      const header = find(fragment, node => node.tagName === 'header')
      const intro = header?.childNodes.find(node => node.tagName === 'div')
      if (intro) {
        const actions = find(intro, node => node.tagName === 'div' && node.childNodes?.some(child => child.tagName === 'a'))
        if (actions) setAttr(actions, 'class', 'home-actions')
        content = `<div class="home-intro">${serialize(intro)}</div>`
      }

    }
    if (base === '/shelf') {
      const copy = zh ? zhShelf : enShelf
      const groups = [
        ['inProgress', shelf.items.filter(item => item.type !== 'album' && shelfStatus(item) === 'watching')],
        ['finishedTv', shelf.items.filter(item => item.type === 'tv' && shelfStatus(item) === 'finished')],
        ['finishedMovies', shelf.items.filter(item => item.type === 'movie' && shelfStatus(item) === 'finished')],
        ['album', shelf.items.filter(item => item.type === 'album')],
      ]
      content = `<h1>${escape(copy.title)}</h1><p>${escape(copy.intro)}</p>` + groups.filter(([, items]) => items.length).map(([key, items]) =>
        `<section><h2>${escape(copy[key])}</h2><ul class="shelf-list">${items.sort(compareShelfTitles).map(item => {
          const title = localized(item.title, route.locale)
          const href = shelfLink(item)
          return `<li><strong>${href ? `<a href="${escape(href)}">${escape(title)}</a>` : escape(title)}</strong>${item.artist ? `<span>${escape(item.artist)}</span>` : ''}${item.year ? ` <small>${escape(item.year)}</small>` : ''}</li>`
      }).join('')}</ul></section>`).join('') + `<p class="note">${escape(copy.watchedNote)} ${escape(copy.seriesNote)}</p>`
    }
    if (base === '/interests') {
      const copy = zh ? zhInterests : enInterests
      content = `<h1>${escape(copy.interests)}</h1><p>${escape(copy.whatKeepsPullingMeIn)}</p>` + interests.map(item => {
        const entry = copy.items[item.id]
        return `<article class="content-card"><h2>${escape(entry.label)}</h2><p>${escape(entry.description)}</p>${item.link ? `<p><a href="${escape(relativeLink(route.path, localeRoute(item.link, route.locale)))}">${escape(entry.linkLabel)}</a></p>` : ''}</article>`
      }).join('')
    }
    if (base === '/contact') {
      content = `<h1>${zh ? '联系我' : 'Get in touch'}</h1><p>${escape((zh ? zhMeta : enMeta).contact.description)}</p><div class="address-book"><h2>${zh ? '通讯录' : 'Address book'}</h2><dl>` + [
        [zh ? '邮箱' : 'Email', 'mailto:leodeng@leodeng.dev', 'leodeng@leodeng.dev'],
        ['X (Twitter)', 'https://x.com/Leodeng14', '@Leodeng14'],
        ['GitHub', 'https://github.com/leodenglovescode', 'leodenglovescode'],
        ['YouTube', 'https://www.youtube.com/@leodavicode', '@leodavicode'],
      ].map(([label, url, value]) => `<div><dt>${escape(label)}</dt><dd><a href="${escape(url)}">${escape(value)}</a></dd></div>`).join('') + `</dl></div>`
    }
    if (base === '/changelog') {
      const [data, copy] = await Promise.all([readJson('src/generated/changelog.json'), readJson(`src/locales/${zh ? 'zh-CN' : 'en'}/changelog.json`)])
      const repo = `https://github.com/${data.repo}`
      let month = ''
      content = `<h1>${escape(copy.changelog)}</h1><p>${escape(copy.everyCommitToThisSiteStraightFrom)} <a href="${escape(repo)}">${escape(copy.theRepo)}</a>.</p><p class="note">${data.commits.length} ${zh ? '条更新记录' : 'updates'} &middot; ${escape(copy.indexRebuilt)} ${escape(data.generatedAt)}</p><div class="change-history">`
      for (const commit of data.commits) {
        const key = commit.date.slice(0, 7)
        if (key !== month) { content += `<h2 class="history-month">${escape(key)}</h2>`; month = key }
        const type = ['feat', 'fix', 'content', 'chore'].includes(commit.type) ? commit.type : 'other'
        content += `<article class="history-entry"><div class="history-meta"><span class="change-type change-${type}">${escape(copy.types[type])}</span><time datetime="${escape(commit.date)}">${escape(commit.date)}</time> <a href="${escape(repo)}/commit/${escape(commit.hash)}">${escape(commit.hash.slice(0, 7))}</a></div><p>${commit.scope ? `<strong>${escape(commit.scope)}:</strong> ` : ''}${escape(commit.subject.replace(/\s*[—–]\s*/g, ': '))}</p></article>`
      }
      content += '</div>'
    }
    if (base === '/gallery' || base.startsWith('/gallery/')) {
      const slug = base.split('/')[2]
      if (!slug) content = `<h1>${zh ? '相册' : 'Gallery'}</h1>` + collections.map(collection => `<article class="content-card"><h2><a href="${escape(relativeLink(route.path, localeRoute(`/gallery/${collection.slug}`, route.locale)))}">${escape(collection.title)}</a></h2>${picture(collection.cover, collection.title, media, '', route.path)}<p>${collection.photos.length} ${zh ? '张照片' : 'photos'}</p></article>`).join('')
      else {
        const collection = collections.find(item => item.slug === slug)
        if (!collection) throw new Error(`Unknown gallery ${slug}`)
        const pages = Math.max(1, Math.ceil(collection.photos.length / pageSize))
        for (let page = 1; page <= pages; page++) {
          const pagedRoute = { ...route, path: page === 1 ? route.path : `${route.path}/page/${page}` }
          const pageLink = number => relativeLink(pagedRoute.path, number === 1 ? route.path : `${route.path}/page/${number}`)
          const photos = collection.photos.slice((page - 1) * pageSize, page * pageSize)
          const body = `<h1>${escape(collection.title)}</h1><p>${escape(collection.description)}</p><div class="photo-list">` + photos.map(photo => {
            const full = compatibleImage(photo.fullSrc, media, pagedRoute.path)
            return `<figure>${full ? `<a href="${escape(full)}">` : ''}${picture(photo.thumbSrc, photo.caption, media, '', pagedRoute.path)}${full ? '</a>' : ''}<figcaption>${escape(photo.caption)}</figcaption></figure>`
          }).join('') + `</div><nav class="pagination" aria-label="${zh ? '相册页码' : 'Gallery pages'}">${page > 1 ? `<a href="${escape(pageLink(page - 1))}">${zh ? '上一页' : 'Previous'}</a> ` : ''}<span>${page} / ${pages}</span>${page < pages ? ` <a href="${escape(pageLink(page + 1))}">${zh ? '下一页' : 'Next'}</a>` : ''}</nav>`
          await write(pagedRoute, body)
        }
        continue
      }
    }
    if (['/homelab', '/tokens', '/ip', '/time'].includes(base)) {
      // Keep explanatory copy, replacing the Vue-only loading/chart UI.
      const copy = zh ? zhMeta : enMeta
      const key = base.slice(1)
      content = `<h1>${escape(copy[key]?.title || key)}</h1><p>${escape(copy[key]?.description || '')}</p>
<div class="dashboard"><h2 class="dashboard-heading">${escape(key === 'tokens' ? (zh ? '用量统计' : 'Usage statistics') : key === 'homelab' ? (zh ? '服务器监控' : 'Server monitor') : key === 'ip' ? (zh ? '连接诊断工具' : 'Connection diagnostics') : (zh ? '实时读数' : 'Live readings'))}</h2><div class="live-panel" data-live="${key}"><p>${zh ? '正在连接，等待最新读数...' : 'Connecting, waiting for the latest reading...'}</p></div></div>
<noscript><p>${zh ? '实时数据需要启用 JavaScript。网站其余内容可以直接阅读。' : 'Live readings need JavaScript. The rest of this site can be read without it.'}</p></noscript>`
      if (key === 'time') {
        const time = await readJson(`src/locales/${zh ? 'zh-CN' : 'en'}/time.json`)
        content += `<section class="clock-source"><h2>${escape(time.sourceTitle)}</h2><p>${escape(time.sourceBody)}</p><ol>${time.steps.map(step => `<li>${escape(step.title)}</li>`).join('')}</ol><p class="note">${zh ? '页面可见时每 60 秒同步一次，时钟在两次同步之间继续运行。网络延迟会影响精度。如果同步失败，会使用设备时间并注明。' : 'Synchronizes every 60 seconds while this tab is visible. The clock advances between synchronizations. Network delay limits accuracy. If synchronization fails, the display uses your device clock and labels it as a fallback.'}</p></section>`
      }
    }
    if (base === '/terminal') content = `<h1>${zh ? '终端' : 'Terminal'}</h1><p>${zh ? 'Linux 终端模拟器需要较新的浏览器。这些页面可以在这里阅读：' : 'The Linux terminal emulator needs a newer browser. You can explore these pages here:'}</p><ul>${['about', 'projects', 'stack', 'homelab', 'blog'].map(key => `<li><a href="${escape(relativeLink(route.path, localeRoute(`/${key}`, route.locale)))}">${escape((zh ? zhMeta : enMeta)[key]?.title || key)}</a></li>`).join('')}</ul>`
    await write(route, content, extra)
  }
  const notFound = shell({ path: '/', locale: 'en', title: 'Page not found' }, '<h1>Page not found</h1><p>This address does not have a page. Try a link above.</p>')
    .replace(/href="(?!https?:|#)([^"]*)"/g, 'href="/$1"').replace(/src="(?!https?:)([^"]*)"/g, 'src="/$1"')
  await fs.writeFile(path.join(output, '404.html'), notFound)
  console.log(`✓ Generated simple edition from ${routes.length} shared content routes`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { collections } = await import('../dist-ssr/entry-server.js')
  await buildLegacySite({ routes: await readJson('dist/_site-routes.json'), collections })
}
