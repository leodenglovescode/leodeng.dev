// Reframe the shared, already-sanitized content as a weblog and status register.
// These layouts are static HTML and CSS; prose and links stay shared.
import { parseFragment, serialize } from 'parse5'

const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value || ''
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes || []).map(text).join('')
const elements = node => (node?.childNodes || []).filter(child => child.tagName)
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result }
}
function all(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))] }
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name)

export function legacyJournalIndex(html, zh = false) {
  const tree = parseFragment(html)
  const section = find(tree, node => node.tagName === 'section')
  const heading = find(section, node => node.tagName === 'h2')
  const intro = elements(section).find(node => node.tagName === 'p')
  const entries = all(section, node => node.tagName === 'a' && !!find(node, child => child.tagName === 'h3'))
  if (!entries.length) return html
  let year = ''
  const archive = entries.map(entry => {
    const title = find(entry, node => node.tagName === 'h3')
    const description = find(entry, node => node.tagName === 'p')
    const date = text(elements(entry).find(node => node.tagName === 'span')).trim()
    const match = date.match(/^(\w+)\s+(\d+),\s+(\d{4})$/)
    const group = match && match[3] !== year ? `<h2 class="archive-year">${escape(match[3])}</h2>` : ''
    if (match) year = match[3]
    return `${group}<article class="journal-entry"><p class="journal-date">${escape(date)}</p><div class="journal-entry-copy"><h3><a href="${escape(attr(entry, 'href'))}">${escape(text(title))}</a></h3>${description ? `<p>${escape(text(description))}</p>` : ''}<p class="journal-entry-footer">${zh ? '作者：Leo Deng' : 'Posted by Leo Deng'} &middot; <a class="journal-read" href="${escape(attr(entry, 'href'))}">${zh ? '阅读全文' : 'Read entry'} &raquo;</a></p></div></article>`
  }).join('')
  return `<section class="journal-index"><header class="journal-heading"><p class="journal-kicker">${zh ? 'Leo 的网络日志' : "Leo's weblog"}</p><h1>${escape(text(heading))}</h1><p>${escape(text(intro))}</p><p class="journal-subscribe"><a href="https://leodeng.dev/rss.xml">RSS</a> &middot; ${entries.length} ${zh ? '篇文章' : 'entries'}</p></header>${archive}</section>`
}

export function legacyJournalPost(html, zh = false) {
  const tree = parseFragment(html)
  const article = find(tree, node => node.tagName === 'article')
  if (!article) return html
  const children = elements(article)
  const back = children.find(node => node.tagName === 'a')
  const title = children.find(node => node.tagName === 'h1')
  const metadata = children.find(node => node.tagName === 'p')
  const prose = children.find(node => hasClass(node, 'prose'))
  if (!prose || !title) return html
  const navigation = children.find(node => node.tagName === 'div' && node !== prose && elements(node).some(child => child.tagName === 'a'))
  const links = elements(navigation).filter(node => node.tagName === 'a').map(link => `<a href="${escape(attr(link, 'href'))}">${elements(link).map((span, index) => `<span class="${index ? 'journal-destination' : 'journal-direction'}">${escape(text(span))}</span>`).join('')}</a>`).join('')
  return `<article class="journal-post"><a class="journal-back" href="${escape(attr(back, 'href'))}">${escape(text(back))}</a><header class="journal-post-heading"><p class="journal-kicker">${zh ? 'Leo 的网络日志' : "Leo's weblog"}</p><h1>${escape(text(title))}</h1><p class="journal-byline">${zh ? '作者：Leo Deng' : 'By Leo Deng'} &middot; ${escape(text(metadata))}</p></header><div class="prose journal-prose">${serialize(prose)}</div>${links ? `<nav class="journal-pagination" aria-label="${zh ? '其他文章' : 'More entries'}">${links}</nav>` : ''}</article>`
}

export function legacyDaybook(html, copy, zh = false) {
  const tree = parseFragment(html)
  const section = find(tree, node => node.tagName === 'section')
  if (!section) return html
  const children = elements(section)
  const heading = children.find(node => node.tagName === 'h2')
  const updated = children.find(node => node.tagName === 'p')
  const intro = children.find(node => node.tagName === 'div')
  const footer = children.filter(node => node.tagName === 'p').pop()
  function dateText(paragraph) {
    let value = text(paragraph).trim()
    for (const template of [copy.started, copy.updated, copy.finished2]) {
      const prefix = template?.split('{p0}')[0].trim()
      if (!prefix) continue
      const position = value.indexOf(prefix)
      if (position > 0) value = `${value.slice(0, position).trim()} · ${value.slice(position)}`
    }
    return escape(value)
  }
  const statuses = [
    ['active', copy.buildingNow], ['recurring', copy.keepingRunning],
    ['paused', copy.onPause], ['finished', copy.recentlyFinished],
  ]
  const groups = all(section, node => node !== section && node.tagName === 'section')
  const content = groups.map((group, index) => {
    const title = find(group, node => node.tagName === 'h3')
    const state = statuses.find(([, label]) => label === text(title).trim()) || statuses[0]
    const entries = all(group, node => node.tagName === 'article')
    return `<tbody class="daybook-section daybook-${state[0]}"><tr class="daybook-group"><th colspan="2" scope="rowgroup">${String(index + 1).padStart(2, '0')}. ${escape(text(title))} (${entries.length})</th></tr>${entries.map(entry => {
      const blocks = elements(entry)
      const status = blocks[0]
      const body = blocks[1]
      const title = find(body, node => node.tagName === 'h4')
      const paragraphs = elements(body).filter(node => node.tagName === 'p')
      return `<tr class="daybook-entry"><td class="daybook-status"><span class="status-lamp" aria-hidden="true"></span>${escape(text(status).trim())}</td><td class="daybook-copy"><h3>${escape(text(title))}</h3>${paragraphs.map((paragraph, n) => `<p${n ? ' class="daybook-dates"' : ''}>${n ? dateText(paragraph) : serialize(paragraph)}</p>`).join('')}</td></tr>`
    }).join('')}</tbody>`
  }).join('')
  return `<section class="daybook"><header class="daybook-heading"><h1>${escape(text(heading))}</h1><p class="daybook-updated">${escape(text(updated))}</p><div class="daybook-intro">${intro ? serialize(intro) : ''}</div></header><table class="daybook-register"><thead><tr><th class="daybook-status-heading" scope="col">${zh ? '状态' : 'Status'}</th><th scope="col">${zh ? '事项与进展' : 'Projects and updates'}</th></tr></thead>${content}</table><p class="daybook-footnote">${footer ? serialize(footer) : ''}</p></section>`
}
