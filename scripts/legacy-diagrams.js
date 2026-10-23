// Build-only rendering. The classic browser receives SVG 1.1 geometry and text,
// not a diagram runtime, web fonts, HTML labels, or CSS custom properties.
import { renderMermaidSVG } from 'beautiful-mermaid'
import { parseFragment, serialize } from 'parse5'

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const palette = {
  bg: '#ffffff', fg: '#202c40', line: '#60789b', accent: '#24436f',
  muted: '#59687c', surface: '#eef2f7', border: '#8499b4',
  _text: '#202c40', '_text-sec': '#59687c', '_text-muted': '#59687c',
  '_text-faint': '#a0a6af', _line: '#60789b', _arrow: '#24436f',
  '_node-fill': '#eef2f7', '_node-stroke': '#8499b4', '_group-fill': '#ffffff',
  '_group-hdr': '#eef2f7', '_inner-stroke': '#c1ccdb', '_key-badge': '#e1e7ef',
}
const tags = new Set(['svg', 'g', 'defs', 'marker', 'polygon', 'polyline', 'path', 'rect', 'line', 'circle', 'ellipse', 'text', 'tspan', 'title', 'desc'])
const attributes = new Set(('id viewBox width height x y x1 x2 y1 y2 dx dy cx cy r rx ry d points transform fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity font-size font-weight text-anchor dominant-baseline marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient preserveAspectRatio').split(' '))
const paint = new Set(['fill', 'stroke'])

function text(node) { return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('') }
function hasClass(node, name) { return node.attrs?.some(a => a.name === 'class' && a.value.split(/\s+/).includes(name)) }
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result }
}

export function classicDiagramSvg(source, id, label = 'Diagram') {
  // This renderer supports these Mermaid families. Others keep their source,
  // rather than being mistaken for a flowchart and silently losing content.
  const body = source.replace(/%%\{[\s\S]*?\}%%/g, '').replace(/^\s*%%[^\n]*$/gm, '').trim()
  if (!/^(?:graph|flowchart|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram)\b/.test(body)) throw new Error('Unsupported diagram family')
  const fragment = parseFragment(renderMermaidSVG(source, { ...palette, font: 'Verdana', interactive: false }))
  const svg = find(fragment, node => node.tagName === 'svg')
  if (!svg) throw new Error('Missing diagram')
  function clean(parent) {
    parent.childNodes = (parent.childNodes || []).filter(node => node.nodeName === '#text' || tags.has(node.tagName))
    for (const node of parent.childNodes) {
      if (!node.tagName) continue
      node.attrs = node.attrs.filter(a => attributes.has(a.name)).flatMap(a => {
        let value = a.value.replace(/var\(--([\w-]+)\)/g, (_, name) => {
          if (!Object.hasOwn(palette, name)) throw new Error('Unknown diagram color')
          return palette[name]
        })
        if (/var\(|color-mix\(/i.test(value)) throw new Error('Unresolved modern diagram styling')
        if (paint.has(a.name) && !/^(?:#[0-9a-f]{3,8}|[a-z]+|url\(#[\w-]+\))$/i.test(value)) return []
        if (a.name === 'id') value = `${id}-${value}`
        value = value.replace(/url\(#([\w-]+)\)/g, `url(#${id}-$1)`)
        return [{ ...a, value }]
      })
      // SVG 2's auto-start-reverse is not needed on the old browser. Rotate
      // the marker geometry at build time to give SVG 1.1 the same arrow.
      const orient = node.attrs.find(a => a.name === 'orient' && a.value === 'auto-start-reverse')
      if (orient) {
        orient.value = 'auto'
        const x = Number(node.attrs.find(a => a.name === 'refX')?.value || 0)
        const y = Number(node.attrs.find(a => a.name === 'refY')?.value || 0)
        const group = parseFragment(`<svg><g transform="rotate(180 ${x} ${y})"></g></svg>`).childNodes[0].childNodes[0]
        group.childNodes = node.childNodes
        node.childNodes = [group]
      }
      clean(node)
    }
  }
  clean(fragment)
  svg.attrs.push({ name: 'font-family', value: 'Verdana, Arial, sans-serif' }, { name: 'role', value: 'img' }, { name: 'aria-labelledby', value: `${id}-title` })
  const title = parseFragment(`<svg><title id="${id}-title">${escape(label)}</title></svg>`).childNodes[0].childNodes[0]
  svg.childNodes.unshift(title)
  return serialize(fragment)
}

export function renderLegacyDiagrams(html, zh = false) {
  const fragment = parseFragment(html)
  let index = 0
  function walk(parent) {
    for (const node of parent.childNodes || []) {
      if (!hasClass(node, 'mermaid-block')) { walk(node); continue }
      const source = find(node, candidate => hasClass(candidate, 'mermaid-source'))
      if (!source) continue
      const id = `classic-diagram-${++index}`
      let rendered
      try {
        const svg = classicDiagramSvg(text(source), id, zh ? '图表' : 'Diagram')
        rendered = `<figure class="legacy-diagram"><div class="legacy-diagram-canvas" tabindex="0" role="region" aria-label="${zh ? '图表，可横向滚动' : 'Diagram, scroll sideways to explore'}">${svg}</div><figcaption>${zh ? '横向滚动查看完整图表。' : 'Scroll sideways to explore the full diagram.'}</figcaption></figure>`
      } catch (error) {
        console.warn('legacy_diagram_render_failed', String(error?.message || error))
        rendered = `<p class="note">${zh ? '此图表暂时只能显示源代码。' : 'This diagram is available as source text below.'}</p>`
      }
      node.childNodes = parseFragment(`${rendered}<details class="legacy-diagram-source"><summary>${zh ? '图表源代码' : 'Diagram source'}</summary><pre class="mermaid-source"><code>${escape(text(source))}</code></pre></details>`).childNodes
    }
  }
  walk(fragment)
  return serialize(fragment)
}
