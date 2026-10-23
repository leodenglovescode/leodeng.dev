import legacyMedia from '../src/generated/legacy-media.json' with { type: 'json' }
import { parseFragment, serialize } from 'parse5'
import { listContent, readContent, requireContentReady, SHELF_PATH } from './content.js'
import { parseFrontmatter, renderMarkdown, formatDate, readingTime } from './markdown.js'
import { compareShelfTitles, shelfLink, shelfStatus } from '../src/utils/shelf.js'
import { aiAuthorshipLabel } from '../src/utils/aiAuthorship.js'
import { renderLegacyDiagrams } from '../scripts/legacy-diagrams.js'
export const escapeContent = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const e=escapeContent
export function publishedPosts(rows) {
  return rows.map(row=>{const {meta,content}=parseFrontmatter(row.raw);return {...meta,slug:row.path.split('/').pop().slice(0,-3),content}}).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))
}
function disclosure(post) {
  const label=aiAuthorshipLabel(post.aiAuthorship)
  return label?`<aside class="ai-authorship"><p><a href="/ai">${e(label)}</a></p>${post.aiAuthorship==='human'?'<p>No AI was involved, including grammar checks.</p>':post.aiReason?`<p>${e(post.aiReason)}</p>`:''}</aside>`:''
}
function classicProse(html) {
  const tree=parseFragment(html)
  function walk(parent) {
    parent.childNodes=(parent.childNodes||[]).flatMap(node=>{
      if (node.tagName==='iframe') {
        const source=node.attrs?.find(attribute=>attribute.name==='src')?.value||''
        let link=''
        try {const url=new URL(source);if(url.protocol==='https:') link=url.href} catch { /* No unsafe embedded URL. */ }
        return parseFragment(link?`<p><a href="${e(link)}">Open embedded content</a></p>`:'').childNodes
      }
      if(node.tagName==='img') {
        const source=node.attrs?.find(attribute=>attribute.name==='src')
        if(source) {
          const mapped=legacyMedia.images[source.value]
          const match=mapped?.match(/^https:\/\/media\.leodeng\.dev\/legacy\/images\/([a-f0-9]{64}\.jpg)$/)
          if(match) source.value='/_assets/media/'+match[1]
          else if(/\.webp(?:[?#]|$)/i.test(source.value)) {
            return parseFragment(`<p class="image-placeholder">Image available on the <a href="https://leodeng.dev/blog">full site</a>.</p>`).childNodes
          }
        }
      }
      if(['script','style','button','input','select','textarea','form','canvas','dialog'].includes(node.tagName)) return []
      if(node.attrs) node.attrs=node.attrs.filter(attribute=>!/^on/i.test(attribute.name)&&attribute.name!=='style')
      walk(node)
      return [node]
    })
  }
  walk(tree)
  return serialize(tree)
}
export function blogHtml(posts,slug,{classic=false,zh=false}={}) {
  const prefix=zh?'/zh':''
  if (!slug) return `<div class="${classic?'journal-index':'flex flex-col'}"><header class="journal-heading"><h1>${zh?'博客':'Blog'}</h1></header>${posts.map(post=>`<article class="${classic?'journal-entry':'py-5 border-b border-fg/5'}"><p class="journal-date text-muted">${e(formatDate(post.date))}</p><div class="journal-entry-copy"><h3 class="text-fg font-semibold"><a href="${prefix}/blog/${e(post.slug)}${classic?'/':''}">${e(post.title)}</a></h3><p class="text-muted">${e(post.description)}</p></div></article>`).join('')}</div>`
  const post=posts.find(post=>post.slug===slug)
  if (!post) return '<h1>Post not found</h1><p><a href="'+prefix+'/blog/">Back to blog</a></p>'
  let html=renderMarkdown(post.content)
  if(classic) html=renderLegacyDiagrams(classicProse(html),zh)
  return `<article class="${classic?'journal-post':'pt-20 sm:pt-32 pb-20'}"><a class="journal-back text-muted" href="${prefix}/blog${classic?'/':''}">${zh?'返回博客':'Back to blog'}</a><header class="journal-post-heading"><h1 class="text-2xl sm:text-3xl font-bold text-fg mb-3">${e(post.title)}</h1><p class="journal-byline text-muted mb-12">${e(formatDate(post.date))} · ${readingTime(post.content)} ${zh?'分钟':'min read'}</p></header>${disclosure(post)}<div class="prose journal-prose">${html}</div><nav class="journal-post-nav">${posts.filter(p=>p.slug!==slug).slice(0,3).map(p=>`<p><a href="${prefix}/blog/${e(p.slug)}${classic?'/':''}">${e(p.title)}</a></p>`).join('')}</nav></article>`
}
export function classicShelf(data,zh=false) {
  return `<h1>${zh?'我的收藏架':'My shelf'}</h1>`+[
    [zh?'观看中':'In progress',null,'watching'],[zh?'看完的电视剧':'Finished TV shows','tv','finished'],[zh?'看完的电影':'Finished movies','movie','finished'],[zh?'专辑':'Albums','album',null]
  ].map(([label,type,status])=>`<section><h2>${e(label)}</h2><ul class="shelf-list">${data.items.filter(item=>(!type||item.type===type)&&(!status||item.type!=='album'&&shelfStatus(item)===status)).sort(compareShelfTitles).map(item=>{
    const title=item.title[zh?'zh':'en']||item.title.en,link=shelfLink(item)
    return `<li><strong>${link?`<a href="${e(link)}">${e(title)}</a>`:e(title)}</strong>${item.artist?` <span>${e(item.artist)}</span>`:''}${item.year?` (${e(item.year)})`:''}</li>`
  }).join('')}</ul></section>`).join('')+`<p class="note">${zh?'看过大部分 MCU 和迪士尼电影。系列只选部分代表作品，可认为我看过完整系列。':'I have watched most MCU and Disney movies. I only put selected titles from a series on this shelf; assume I have watched the full series.'}</p>`
}
export function contentRss(posts) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>leodeng.dev</title><link>https://leodeng.dev/blog</link><description>Leo Deng's blog</description>${posts.map(post=>`<item><title>${e(post.title)}</title><link>https://leodeng.dev/blog/${e(post.slug)}</link><guid>https://leodeng.dev/blog/${e(post.slug)}</guid><pubDate>${e(new Date(post.date).toUTCString())}</pubDate><description>${e(post.description)}</description><content:encoded>${e(disclosure(post)+renderMarkdown(post.content))}</content:encoded></item>`).join('')}</channel></rss>`
}
// Render with the existing built shell. Classic readers receive all content as
// HTML, with no client framework or API request required.
export async function liveContentPage(context,{classic=false,path}={}) {
  const url=new URL(context.request.url), pathname=path||url.pathname
  const normalized=pathname.replace(/\/$/,'')||'/', zh=/^\/zh(?:\/|$)/.test(normalized), base=normalized.replace(/^\/zh(?=\/|$)/,'')||'/'
  const blog=/^\/blog(?:\/([^/]+))?$/.exec(base)
  if (!blog && base!=='/shelf' && base!=='/rss.xml' && base!=='/sitemap.xml' && base!=='/llms.txt' && !(classic&&base==='/')) return null
  if(!['GET','HEAD'].includes(context.request.method)) return new Response('Method not allowed.',{status:405})
  let db
  try { db=await requireContentReady(context.env) } catch { return null }
  const posts=publishedPosts(await listContent(db,'src/posts'))
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
  if(base==='/rss.xml') return new Response(context.request.method==='HEAD'?null:contentRss(posts),{headers:{...headers,'Content-Type':'application/rss+xml; charset=utf-8'}})
  if(base==='/sitemap.xml') {
    const asset=new URL('/sitemap.xml',url)
    let xml=await (await context.env.ASSETS.fetch(new Request(asset))).text()
    xml=xml.replace(/\s*<url>\s*<loc>https:\/\/leodeng\.dev\/(?:zh\/)?blog\/[^<]+<\/loc>[\s\S]*?<\/url>/g,'')
    xml=xml.replace('</urlset>',posts.flatMap(post=>['','/zh'].map(prefix=>`<url><loc>https://leodeng.dev${prefix}/blog/${e(post.slug)}</loc></url>`)).join('')+'</urlset>')
    return new Response(context.request.method==='HEAD'?null:xml,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}})
  }
  if(base==='/llms.txt') {
    const asset=await context.env.ASSETS.fetch(new Request(new URL('/llms.txt',url)))
    const old=await asset.text()
    const links=posts.map(post=>`- [${post.title.replace(/[\[\]\n]/g,' ')}](https://leodeng.dev/blog/${post.slug}.md): ${String(post.description||'').replace(/\s+/g,' ')}`).join('\n')
    return new Response(context.request.method==='HEAD'?null:old.replace(/## Blog posts[\s\S]*?(?=## Photo collections)/,'## Blog posts\n\n'+links+'\n\n'),{headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}})
  }
  if(blog?.[1]?.endsWith('.md')) {
    const row=await readContent(db,'src/posts/'+blog[1])
    return new Response(context.request.method==='HEAD'?null:row?.raw||'Post not found.',{status:row?200:404,headers:{...headers,'Content-Type':'text/markdown; charset=utf-8'}})
  }
  const slug=blog?.[1], post=slug?posts.find(p=>p.slug===slug):null
  const status=slug&&!post?404:200
  const template=new URL(url)
  // Always use an existing shell, including newly published slugs.
  template.pathname=classic?`/_legacy/${zh?'zh/':''}${blog?'blog/':base==='/shelf'?'shelf/':''}index.html`:`/${zh?'zh/':''}${blog?'blog':'shelf'}`
  template.search=''
  const original=await context.env.ASSETS.fetch(new Request(template))
  if(original.status!==200) throw new Error('Content page template unavailable')
  let rewrite=new HTMLRewriter().on('html',{element(el){el.setAttribute('data-live-content','true')}})
  if(blog) {
    const html=blogHtml(posts,slug,{classic,zh})
    rewrite=rewrite.on(classic?'#content > .content-panel':'[data-content-blog]',{element(el){el.setInnerContent((classic?'<div class="panel-bar">&raquo; Blog</div>':'')+html,{html:true})}})
    rewrite=rewrite.on('title',{element(el){el.setInnerContent(e((post?.title||'Blog')+' | leodeng.dev'),{html:true})}})
      .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]',{element(el){el.setAttribute('content',post?.description||'Leo Deng’s blog')}})
      .on('meta[property="og:title"], meta[name="twitter:title"]',{element(el){el.setAttribute('content',post?.title||'Blog')}})
      .on('link[rel="canonical"]',{element(el){el.setAttribute('href','https://leodeng.dev'+normalized)}})
      .on('meta[property="og:url"]',{element(el){el.setAttribute('content','https://leodeng.dev'+normalized)}})
    // The shell is /blog/, but a new post may be nested one level deeper.
    // Root-relative links also preserve the classic shell on new slugs.
    if(classic) rewrite=rewrite.on('[href], [src]',{element(el){for(const attr of ['href','src']) {const value=el.getAttribute(attr);if(value&&!/^(?:[a-z]+:|\/|#)/i.test(value)) {const target=new URL(value,'https://old.leodeng.dev/'+(zh?'zh/':'')+'blog/');el.setAttribute(attr,target.pathname+target.search+target.hash)}}}})
    rewrite=rewrite.on('link[rel="alternate"][hreflang]',{element(el){const language=el.getAttribute('hreflang');el.setAttribute('href','https://leodeng.dev'+(language==='zh-CN'?'/zh':'')+'/blog'+(slug?'/'+slug:''))}})
    if(classic) rewrite=rewrite.on('.top-links a',{element(el){const value=el.getAttribute('href')||'';el.setAttribute('href',value.startsWith('https://leodeng.dev')?'https://leodeng.dev'+normalized+'?view=modern':(zh?'':'/zh')+'/blog'+(slug?'/'+slug:'')+'/')}})
  } else if(base==='/shelf') {
    const row=await readContent(db,SHELF_PATH)
    rewrite=rewrite.on(classic?'#content > .content-panel':'[data-content-shelf]',{element(el){el.setInnerContent((classic?'<div class="panel-bar">&raquo; Shelf</div>':'')+classicShelf(JSON.parse(row.raw),zh),{html:true})}})
  } else if(classic&&base==='/') {
    rewrite=rewrite.on('.recent-posts',{element(el){el.setInnerContent(posts.slice(0,3).map(post=>`<li><a href="${zh?'/zh':''}/blog/${e(post.slug)}/">${e(post.title)}</a><p>${e(post.description)}</p></li>`).join(''),{html:true})}})
  }
  const transformed=rewrite.transform(new Response(original.body,{status,headers}))
  return context.request.method==='HEAD'?new Response(null,{status,headers:transformed.headers}):transformed
}
