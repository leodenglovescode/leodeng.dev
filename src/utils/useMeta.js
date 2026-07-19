const DEFAULT_TITLE = 'leodeng.dev'
const DEFAULT_DESC  = "Leo's corner of the internet. Projects, blog posts, and whatever I'm building lately."

function setMeta(selector, attr, value) {
  const el = document.querySelector(selector)
  if (el) el.setAttribute(attr, value)
}

export function applyMeta({ title, description } = {}) {
  if (typeof document === 'undefined') return

  const fullTitle = title ? `${title} — leodeng.dev` : DEFAULT_TITLE
  const desc = description || DEFAULT_DESC

  document.title = fullTitle
  setMeta('meta[name="description"]',          'content', desc)
  setMeta('meta[property="og:title"]',         'content', fullTitle)
  setMeta('meta[property="og:description"]',   'content', desc)
  setMeta('meta[name="twitter:title"]',        'content', fullTitle)
  setMeta('meta[name="twitter:description"]',  'content', desc)
}

export function resetMeta() {
  applyMeta({})
}
