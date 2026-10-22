import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'parse5'
import { DAILY_AI_QUESTIONS } from '../lib/daily-ai-questions.js'

function findMain(node) {
  if (node.tagName === 'main') return node
  for (const child of node.childNodes || []) {
    const found = findMain(child)
    if (found) return found
  }
}

function readable(node) {
  if (!node || ['script', 'style', 'dialog', 'nav', 'button'].includes(node.tagName)
      || node.attrs?.some(attr => attr.name === 'aria-hidden' && attr.value === 'true')) return ''
  if (node.nodeName === '#text') return node.value
  return (node.childNodes || []).map(readable).join(' ')
}

export async function buildDailyAiContext(root, posts, getPost) {
  const paths = [...new Set(DAILY_AI_QUESTIONS.flatMap(question => question.paths))]
  const pages = {}
  for (const route of paths) {
    const html = await fs.readFile(path.join(root, 'dist', `${route.slice(1)}.html`), 'utf8')
    pages[route] = readable(findMain(parse(html))).replace(/\s+/g, ' ').trim().slice(0, 10000)
  }
  const context = {
    version: 1,
    questions: DAILY_AI_QUESTIONS,
    pages,
    // getAllPosts() only globs published posts. Never read drafts or transcripts.
    posts: posts.map(post => ({ path: `/blog/${post.slug}`, title: post.title, date: post.date,
      text: readable(parse(getPost(post.slug).html)).replace(/\s+/g, ' ').trim().slice(0, 12000) })),
  }
  await fs.writeFile(path.join(root, 'dist/daily-ai-context.json'), `${JSON.stringify(context)}\n`)
}
