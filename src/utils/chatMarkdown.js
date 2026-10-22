import { Marked } from 'marked'
import createDOMPurify from 'dompurify'

// Separate from the blog's trusted-content renderer and its global extensions.
const markdown = new Marked({ gfm: true, breaks: true })
let purifier
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderChatMarkdown(source) {
  const text = String(source || '')
  // Chats are loaded in the browser. Fail closed during SSR or without a DOM.
  if (typeof window === 'undefined') return escapeHtml(text)
  if (!purifier) {
    purifier = createDOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', node => {
      if (node.nodeName !== 'A' || !node.hasAttribute('href')) return
      try {
        const url = new URL(node.getAttribute('href'), window.location.origin)
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
          node.removeAttribute('href')
        } else if (url.origin !== window.location.origin) {
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
        }
      } catch { node.removeAttribute('href') }
    })
  }
  return purifier.sanitize(markdown.parse(text), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}
