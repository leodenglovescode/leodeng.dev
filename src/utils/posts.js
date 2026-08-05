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

// Strips surrounding quotes — the admin panel quotes values that contain a
// colon or other YAML-ambiguous characters.
function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }

  const meta = {}
  const lines = match[1].split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i++]
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    let value = line.slice(sep + 1).trim()

    // A YAML value doesn't have to fit on one line. Block scalars (`>`, `|`,
    // with optional chomping indicators like `>-`) and plain multi-line
    // scalars both continue onto the following *indented* lines — which is
    // exactly what a text editor emits when it wraps a long description.
    // Reading only the first line silently truncated those mid-sentence.
    const block = value.match(/^([>|])[-+]?\d*$/)
    const continuation = []
    while (i < lines.length && (/^\s+\S/.test(lines[i]) || (!lines[i].trim() && block))) {
      continuation.push(lines[i].trim())
      i++
    }

    if (continuation.length) {
      // `|` keeps the line breaks; `>` folds them, as does a plain scalar.
      const literal = block && block[1] === '|'
      const rest = literal
        ? continuation.join('\n').trim()
        : continuation.filter(Boolean).join(' ').trim()
      value = block ? rest : `${value} ${rest}`.trim()
    }

    meta[key] = unquote(value)
  }

  return { meta, content: match[2] }
}

// Shared with the /admin live preview so what you type there renders through
// the same pipeline (and highlight.js theme) as the published post.
export function renderMarkdown(content) {
  return marked(content)
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
  if (!dateStr) return ''
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
