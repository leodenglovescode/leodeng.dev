import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { parseFragment } from 'parse5'
import { classicDiagramSvg, renderLegacyDiagrams } from '../../scripts/legacy-diagrams.js'
import { readableContent } from '../../scripts/build-legacy.js'

function collect(node, tag) {
  return [...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap(child => collect(child, tag))]
}

test('the published network diagram renders at build time with its topology, labels and colors', async () => {
  const post = await fs.readFile(new URL('../../src/posts/explaining-my-weird-home-network-services-setup.md', import.meta.url), 'utf8')
  const source = post.match(/```mermaid\n([\s\S]*?)```/)[1]
  const svg = classicDiagramSvg(source, 'network')
  const tree = parseFragment(svg)
  assert.equal(collect(tree, 'polyline').length, 15)
  for (const label of ['Main Router', 'Main Server BMC', '100 Mbps', 'IP Camera', 'Optical Network Terminal']) assert.ok(svg.includes(label), label)
  assert.match(svg, /fill="#0984e3"/)
  assert.match(svg, /fill="#fff"/)
  assert.doesNotMatch(svg, /var\(|color-mix\(|<style|foreignObject|<script|@import|auto-start-reverse|https:\/\//)
  assert.match(svg, /font-family="Verdana, Arial, sans-serif"/)
})

test('classic posts get static diagrams with independent marker IDs and readable source', () => {
  const block = '<div class="mermaid-block"><pre class="mermaid-source"><code>flowchart LR\nA[First] --&gt; B[Second]</code></pre></div>'
  const readable = readableContent(`<main><h1>Post</h1>${block}${block}</main>`, '/blog/example')
  const html = renderLegacyDiagrams(readable)
  const tree = parseFragment(html)
  assert.equal(collect(tree, 'svg').length, 2)
  assert.equal(collect(tree, 'pre').length, 2)
  const ids = collect(tree, 'marker').map(node => node.attrs.find(a => a.name === 'id').value)
  assert.equal(new Set(ids).size, ids.length)
  for (const node of collect(tree, 'polyline')) {
    const ref = node.attrs.find(a => a.name === 'marker-end').value.match(/url\(#(.+)\)/)[1]
    assert.ok(ids.includes(ref))
  }
  assert.match(html, /Scroll sideways/)
  assert.match(html, /<pre class="mermaid-source"><code>flowchart LR/)
  assert.doesNotMatch(html, /<script/)
})

test('unsupported diagrams keep their source, and diagrams cannot embed active or external content', () => {
  const fallback = renderLegacyDiagrams('<div class="mermaid-block"><pre class="mermaid-source">pie\n"A": 1</pre></div>')
  assert.doesNotMatch(fallback, /<svg/)
  assert.match(fallback, /source text below/)
  assert.match(fallback, /<pre[^>]*><code>pie/)
  const svg = classicDiagramSvg('flowchart TD\n A["&lt;img src=x onerror=alert(1)&gt;"] --> B[Safe]\nclassDef evil fill:url(https://example.test/image)\nclass A evil', 'safe')
  const tree = parseFragment(svg)
  for (const tag of ['script', 'style', 'image', 'foreignObject', 'a']) assert.equal(collect(tree, tag).length, 0)
  assert.doesNotMatch(svg, /(?:fill|stroke)="url\(https?:/)
})
