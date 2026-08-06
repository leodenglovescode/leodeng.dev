// Client-side mermaid rendering with GitHub-style pan/zoom controls.
//
// `utils/posts.js` turns a ```mermaid fence into
//   <div class="mermaid-block"><pre class="mermaid-source"><code>…</code></pre></div>
// and nothing more, so the markup stays valid during SSR/pre-render and in the
// RSS feed (where it degrades to a plain code block). Only this module — loaded
// lazily, in the browser, and only on pages that actually contain a diagram —
// turns those placeholders into SVG.

const MAX_SCALE = 8
const ZOOM_STEP = 1.3

let mermaidPromise = null
let appliedTheme = null
let seq = 0

// Same source + same theme renders to the same SVG, so the admin preview can
// re-mount an unchanged diagram on every keystroke without re-parsing it.
const cache = new Map()
const CACHE_LIMIT = 40

// Every mounted diagram, so a theme flip can re-render what's on screen.
const mounted = new Set()

function isDark() {
  return document.documentElement.classList.contains('dark')
}

function themeConfig(dark) {
  const shared = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    theme: 'base',
    flowchart: { htmlLabels: true, curve: 'basis' },
  }
  return dark
    ? {
        ...shared,
        darkMode: true,
        themeVariables: {
          background: 'transparent',
          primaryColor: '#1e1b4b',
          primaryTextColor: '#e5e7eb',
          primaryBorderColor: '#6366f1',
          secondaryColor: '#232323',
          tertiaryColor: '#1b1b1b',
          mainBkg: '#1e1b4b',
          nodeBorder: '#6366f1',
          lineColor: '#8b8b8b',
          textColor: '#cccccc',
          noteBkgColor: '#232323',
          noteTextColor: '#cccccc',
          noteBorderColor: '#3f3f3f',
          clusterBkg: '#181818',
          clusterBorder: '#3a3a3a',
        },
      }
    : {
        ...shared,
        darkMode: false,
        themeVariables: {
          background: 'transparent',
          primaryColor: '#eef2ff',
          primaryTextColor: '#111111',
          primaryBorderColor: '#6366f1',
          secondaryColor: '#f3f4f6',
          tertiaryColor: '#fafafa',
          mainBkg: '#eef2ff',
          nodeBorder: '#6366f1',
          lineColor: '#767676',
          textColor: '#333333',
          noteBkgColor: '#f8fafc',
          noteTextColor: '#333333',
          noteBorderColor: '#d4d4d8',
          clusterBkg: '#f5f5f5',
          clusterBorder: '#e0e0e0',
        },
      }
}

async function getMermaid(dark) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default)
  }
  const mermaid = await mermaidPromise
  if (appliedTheme !== dark) {
    appliedTheme = dark
    mermaid.initialize(themeConfig(dark))
  }
  return mermaid
}

/* ---------- pan / zoom ---------- */

const ICONS = {
  in: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M7.25 3.5h1.5v3h3v1.5h-3v3h-1.5v-3h-3V6.5h3z"/></svg>',
  out: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M4.25 6.5h7.5V8h-7.5z"/></svg>',
  reset:
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 2.5A5.5 5.5 0 1 0 13.5 8H12A4 4 0 1 1 8 4V6L11 3.25 8 .5z"/></svg>',
  full: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M2 2h5v1.5H3.5V7H2zm12 0v5h-1.5V3.5H9V2zM2 9h1.5v3.5H7V14H2zm10.5 0H14v5H9v-1.5h3.5z"/></svg>',
  code: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5.4 3.6 1 8l4.4 4.4 1.06-1.06L3.12 8l3.34-3.34zm5.2 0L9.54 4.66 12.88 8l-3.34 3.34L10.6 12.4 15 8z"/></svg>',
}

function button(html, title, onClick) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'mermaid-btn'
  el.title = title
  el.setAttribute('aria-label', title)
  el.innerHTML = html
  el.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return el
}

function controller(block, viewport, canvas, svg) {
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const natural = {
    w: box.length === 4 && box[2] > 0 ? box[2] : svg.getBoundingClientRect().width || 800,
    h: box.length === 4 && box[3] > 0 ? box[3] : svg.getBoundingClientRect().height || 400,
  }

  // Mermaid ships the SVG at width:100% with a max-width; pin it to its
  // natural size instead so the transform below is the only thing scaling it.
  svg.removeAttribute('height')
  svg.style.maxWidth = 'none'
  svg.style.width = `${natural.w}px`
  svg.style.height = `${natural.h}px`

  const state = { scale: 1, fit: 1, tx: 0, ty: 0, touched: false }
  const label = document.createElement('span')
  label.className = 'mermaid-zoom'

  function apply() {
    canvas.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
    label.textContent = `${Math.round((state.scale / state.fit) * 100)}%`
  }

  function clampPan() {
    // Always keep a slice of the diagram in view — panning it fully off-screen
    // is the fastest way to make a diagram look broken.
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    const w = natural.w * state.scale
    const h = natural.h * state.scale
    const slackX = Math.max(vw - w, 0)
    const slackY = Math.max(vh - h, 0)
    state.tx = slackX ? slackX / 2 : Math.min(0, Math.max(vw - w, state.tx))
    state.ty = slackY ? slackY / 2 : Math.min(0, Math.max(vh - h, state.ty))
  }

  function fit() {
    const vw = viewport.clientWidth || natural.w
    state.fit = Math.min(1, vw / natural.w)
    state.scale = state.fit
    // The viewport is as tall as the fitted diagram, capped so a tall sequence
    // diagram doesn't push the rest of the post off the screen.
    const cap = Math.max(220, Math.min(640, Math.round(window.innerHeight * 0.7)))
    viewport.style.height = `${Math.min(Math.round(natural.h * state.fit), cap)}px`
    state.tx = 0
    state.ty = 0
    clampPan()
    state.touched = false
    apply()
  }

  function zoomTo(next, focusX, focusY) {
    const scale = Math.min(MAX_SCALE, Math.max(state.fit * 0.5, next))
    if (scale === state.scale) return
    const px = focusX ?? viewport.clientWidth / 2
    const py = focusY ?? viewport.clientHeight / 2
    state.tx = px - (px - state.tx) * (scale / state.scale)
    state.ty = py - (py - state.ty) * (scale / state.scale)
    state.scale = scale
    state.touched = true
    clampPan()
    apply()
  }

  /* pointer drag + pinch */
  const pointers = new Map()
  let pinch = null

  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    viewport.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: state.scale }
    }
    viewport.classList.add('is-grabbing')
  })

  viewport.addEventListener('pointermove', (event) => {
    const prev = pointers.get(event.pointerId)
    if (!prev) return
    const next = { x: event.clientX, y: event.clientY }
    pointers.set(event.pointerId, next)

    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.dist > 0) {
        const rect = viewport.getBoundingClientRect()
        zoomTo(
          pinch.scale * (dist / pinch.dist),
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
        )
      }
      event.preventDefault()
      return
    }

    state.tx += next.x - prev.x
    state.ty += next.y - prev.y
    state.touched = true
    clampPan()
    apply()
    event.preventDefault()
  })

  function release(event) {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = null
    if (!pointers.size) viewport.classList.remove('is-grabbing')
  }
  viewport.addEventListener('pointerup', release)
  viewport.addEventListener('pointercancel', release)

  // Plain wheel keeps scrolling the page — hijacking it makes a post that
  // opens with a diagram impossible to scroll past. Ctrl/⌘ + wheel zooms,
  // which is also what a trackpad pinch sends.
  viewport.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      zoomTo(
        state.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    },
    { passive: false },
  )

  viewport.addEventListener('dblclick', () => fit())

  /* toolbar */
  const toolbar = document.createElement('div')
  toolbar.className = 'mermaid-toolbar'
  toolbar.append(
    button(ICONS.out, 'Zoom out', () => zoomTo(state.scale / ZOOM_STEP)),
    label,
    button(ICONS.in, 'Zoom in', () => zoomTo(state.scale * ZOOM_STEP)),
    button(ICONS.reset, 'Reset zoom', () => fit()),
    button(ICONS.full, 'Fullscreen', () => {
      if (document.fullscreenElement === block) document.exitFullscreen()
      else block.requestFullscreen?.()
    }),
    button(ICONS.code, 'Show source', () => {
      block.classList.toggle('show-source')
    }),
  )
  block.appendChild(toolbar)

  block.addEventListener('fullscreenchange', () => requestAnimationFrame(fit))

  // Re-fit on layout changes (window resize, editor pane toggle) unless the
  // reader has zoomed or panned — then their view is left alone.
  const observer = new ResizeObserver(() => {
    if (!state.touched) fit()
  })
  observer.observe(viewport)

  fit()
  return { fit, destroy: () => observer.disconnect() }
}

/* ---------- mounting ---------- */

function mount(block, svgMarkup, bindFunctions) {
  block.querySelector('.mermaid-render')?.remove()
  block.querySelector('.mermaid-error')?.remove()
  block.querySelector('.mermaid-toolbar')?.remove()

  const wrap = document.createElement('div')
  wrap.className = 'mermaid-render'
  const viewport = document.createElement('div')
  viewport.className = 'mermaid-viewport'
  const canvas = document.createElement('div')
  canvas.className = 'mermaid-canvas'
  canvas.innerHTML = svgMarkup
  viewport.appendChild(canvas)
  wrap.appendChild(viewport)
  block.appendChild(wrap)

  const svg = canvas.querySelector('svg')
  if (!svg) return
  svg.setAttribute('role', 'img')
  bindFunctions?.(canvas)

  block.dataset.state = 'ready'
  controller(block, viewport, canvas, svg)
  mounted.add(block)
}

function fail(block, error) {
  block.querySelector('.mermaid-render')?.remove()
  block.querySelector('.mermaid-toolbar')?.remove()
  block.dataset.state = 'error'
  let box = block.querySelector('.mermaid-error')
  if (!box) {
    box = document.createElement('p')
    box.className = 'mermaid-error'
    block.prepend(box)
  }
  box.textContent = `Mermaid: ${String(error?.message || error).split('\n')[0]}`
}

function cacheGet(key) {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet(key, value) {
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

/**
 * Renders every `.mermaid-block` inside `root` (default: the whole document).
 * Safe to call repeatedly — blocks already rendered from the same source and
 * theme are skipped.
 */
export async function renderMermaid(root = document) {
  if (typeof window === 'undefined' || !root) return

  const blocks = [...root.querySelectorAll('.mermaid-block')]
  if (!blocks.length) return

  const dark = isDark()
  const pending = blocks.filter((block) => {
    const source = block.querySelector('.mermaid-source')?.textContent?.trim()
    if (!source) return false
    const key = `${dark ? 'dark' : 'light'} ${source}`
    if (block.dataset.key === key && block.dataset.state === 'ready') return false
    block.dataset.key = key
    return true
  })
  if (!pending.length) return

  const mermaid = await getMermaid(dark)

  for (const block of pending) {
    const source = block.querySelector('.mermaid-source').textContent.trim()
    const key = block.dataset.key
    try {
      const hit = cacheGet(key)
      if (hit) {
        mount(block, hit)
        continue
      }
      seq += 1
      const { svg, bindFunctions } = await mermaid.render(`mermaid-svg-${seq}`, source)
      cacheSet(key, svg)
      mount(block, svg, bindFunctions)
    } catch (error) {
      delete block.dataset.key
      fail(block, error)
    }
  }
}

// A theme flip changes the diagram colours, so re-render whatever is mounted.
if (typeof window !== 'undefined') {
  let wasDark = isDark()
  new MutationObserver(() => {
    const dark = isDark()
    if (dark === wasDark) return
    wasDark = dark
    for (const block of mounted) {
      if (!block.isConnected) mounted.delete(block)
    }
    if (mounted.size) renderMermaid(document)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
