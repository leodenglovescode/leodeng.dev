import fs from 'node:fs/promises'
import path from 'node:path'

const origin = 'https://leodeng.dev'
const primaryPages = new Set(['/', '/about', '/projects', '/blog', '/gallery', '/now', '/interests', '/stack', '/contact', '/api-docs', '/ai'])

function inline(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function link(route) {
  const title = inline(route.title || 'leodeng.dev').replace(/[\\[\]]/g, '\\$&')
  const description = inline(route.description)
  return `- [${title}](${origin}${route.path})${description ? `: ${description}` : ''}`
}

export async function buildLlms(root, { pages, posts, collections, getPostMarkdown }) {
  const dist = path.join(root, 'dist')
  // Reuse the published-post glob from SSR. Never read drafts or local files.
  const postLinks = []
  for (const post of posts) {
    const route = `/blog/${post.slug}.md`
    await fs.mkdir(path.join(dist, 'blog'), { recursive: true })
    await fs.writeFile(path.join(dist, route.slice(1)), getPostMarkdown(post.slug))
    postLinks.push(link({ ...post, path: route }))
  }

  const text = [
    '# leodeng.dev',
    '',
    '> Leo Deng\'s personal website: projects, blog posts, photography, self-hosting, and current interests.',
    '',
    'English pages use the root URLs; Simplified Chinese pages use /zh. Blog links below serve the original published Markdown. This index is regenerated on every production build. Live status and usage figures can change between builds; visit the linked pages for current data.',
    '',
    '## Main pages',
    '',
    ...pages.filter(page => primaryPages.has(page.path)).map(link),
    '',
    '## Blog posts',
    '',
    ...postLinks,
    '',
    '## Photo collections',
    '',
    ...collections.map(collection => link({ ...collection, path: `/gallery/${collection.slug}` })),
    '',
    '## Optional',
    '',
    ...pages.filter(page => !primaryPages.has(page.path)).map(link),
    '- [Chinese home page](https://leodeng.dev/zh): Simplified Chinese version of the site.',
    '- [RSS feed](https://leodeng.dev/rss.xml): Published blog posts with full rendered content.',
    '- [Sitemap](https://leodeng.dev/sitemap.xml): Complete public page index with English and Chinese alternatives.',
    '',
  ].join('\n')

  await fs.writeFile(path.join(dist, 'llms.txt'), text)
  console.log('✓ Generated llms.txt and published blog Markdown')
}
