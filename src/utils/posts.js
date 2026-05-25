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
    if (key.trim()) meta[key.trim()] = val.join(':').trim()
  })
  return { meta, content: match[2] }
}

function readingTime(text) {
  const words = text.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

export function getAllPosts() {
  return Object.entries(modules)
    .map(([path, raw]) => {
      const slug = path.replace('../posts/', '').replace('.md', '')
      const { meta } = parseFrontmatter(raw)
      return { slug, ...meta }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

export function getPost(slug) {
  const raw = modules[`../posts/${slug}.md`]
  if (!raw) return null
  const { meta, content } = parseFrontmatter(raw)
  return { ...meta, html: marked(content), readingTime: readingTime(content) }
}
