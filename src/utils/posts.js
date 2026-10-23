import { shallowRef } from 'vue'
import { parseFrontmatter, renderMarkdown, readingTime, formatDate } from '../../lib/markdown.js'
export { parseFrontmatter, renderMarkdown } from '../../lib/markdown.js'
const modules = import.meta.glob('../posts/*.md', { query: '?raw', import: 'default', eager: true })

const runtimePosts = shallowRef(null)
let pending
export async function refreshPosts() {
  if (typeof window === 'undefined' || import.meta.env.DEV) return
  if (!pending) pending = fetch('/api/content/public/posts', {cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r => {if (!r.ok) throw new Error('Posts unavailable'); return r.json()}).then(data => {runtimePosts.value = data.posts}).catch(() => {}).finally(() => {pending=null})
  return pending
}
export function getAllPosts() {
  return Object.entries(runtimePosts.value || modules)
    .map(([path, raw]) => {
      const slug = path.replace('../posts/', '').replace('.md', '')
      const { meta } = parseFrontmatter(raw)
      return { slug, ...meta, displayDate: formatDate(meta.date) }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

// Original published Markdown for text readers such as the Linux guest.
// The glob only includes posts/, so drafts are never exposed here.
export function getPostMarkdown(slug) {
  return (runtimePosts.value || modules)[`../posts/${slug}.md`] ?? null
}

export function getPost(slug) {
  const raw = getPostMarkdown(slug)
  if (!raw) return null
  const { meta, content } = parseFrontmatter(raw)
  return { ...meta, displayDate: formatDate(meta.date), html: renderMarkdown(content), readingTime: readingTime(content) }
}
