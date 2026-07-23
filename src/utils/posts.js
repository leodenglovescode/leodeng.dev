import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      const highlighted = hljs.highlight(text, { language }).value
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
    }
  }
})

const modules = import.meta.glob('../posts/*.md', { query: '?raw', import: 'default', eager: true })

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }
  const meta = {}
  match[1].split('\n').forEach(line => {
    const [key, ...val] = line.split(':')
    if (!key.trim()) return
    let value = val.join(':').trim()
    // Strip surrounding quotes — the CMS admin panel quotes values that
    // contain a colon or other YAML-ambiguous characters.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[key.trim()] = value
  })
  return { meta, content: match[2] }
}

function readingTime(text) {
  const words = text.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Reads the calendar date straight out of the ISO string (e.g. "2026-07-12"
// from "2026-07-12T18:36:24+08:00") instead of via `new Date()`, so the
// displayed date is always the author's date, not shifted by the reader's
// browser timezone.
function formatDate(dateStr) {
  const [year, month, day] = dateStr.slice(0, 10).split('-')
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`
}

export function getAllPosts() {
  return Object.entries(modules)
    .map(([path, raw]) => {
      const slug = path.replace('../posts/', '').replace('.md', '')
      const { meta } = parseFrontmatter(raw)
      return { slug, ...meta, displayDate: formatDate(meta.date) }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

export function getPost(slug) {
  const raw = modules[`../posts/${slug}.md`]
  if (!raw) return null
  const { meta, content } = parseFrontmatter(raw)
  return { ...meta, displayDate: formatDate(meta.date), html: marked(content), readingTime: readingTime(content) }
}
