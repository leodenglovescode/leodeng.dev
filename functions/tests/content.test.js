import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { CONTENT_SCHEMA, readContent, writeContent, exportContent, listContent, validateContent } from '../../lib/content.js'
import { onRequest } from '../api/content/[[path]].js'
import { blogHtml, publishedPosts, contentRss, classicShelf } from '../../lib/content-pages.js'
import { safeEqual, readBoundedJson } from '../../lib/content-security.js'
import { migrationSql } from '../../scripts/migrate-content.js'

function database() {
  const sqlite=new DatabaseSync(':memory:')
  for(const sql of CONTENT_SCHEMA) sqlite.exec(sql)
  sqlite.exec("INSERT INTO site_content_meta VALUES('ready','1')")
  const wrap=(sql,args=[])=>({
    bind(...values){return wrap(sql,values)},
    async first(){return sqlite.prepare(sql).get(...args)||null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}}},
    sql,args
  })
  return {prepare:wrap,async batch(statements){
    sqlite.exec('BEGIN')
    try {
      const result=statements.map(statement=>/^SELECT/i.test(statement.sql)?{results:sqlite.prepare(statement.sql).all(...statement.args)}:{meta:{changes:sqlite.prepare(statement.sql).run(...statement.args).changes}})
      sqlite.exec('COMMIT');return result
    } catch(error){sqlite.exec('ROLLBACK');throw error}
  },sqlite}
}
const markdown=(title='Hello')=>`---\ntitle: "${title}"\ndate: "2026-10-23T10:00:00+08:00"\ndescription: "中文 & test"\n---\n\nText with **formatting**.\n`
const post='src/posts/hello.md',draft='src/drafts/secret.md',shelf='src/content/shelf.json'
async function seed(db){await writeContent(db,{path:shelf,raw:'{"items":[]}'})}
async function request(db,route,{method='GET',body,headers={}}={}) {
  return onRequest({request:new Request('https://leodeng.dev/api/content/'+route,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}),env:{HOMELAB_DB:db,CONTENT_BACKUP_TOKEN:'backup-secret'}})
}

test('D1 saves, stale-tab conflicts, atomic publication/rename, destination collisions, deletion and revision retention',async()=>{
  const db=database()
  const created=await writeContent(db,{path:draft,raw:markdown('Private')})
  await assert.rejects(writeContent(db,{path:draft,raw:markdown('Duplicate')}),{status:409})
  const moved=await writeContent(db,{path:post,originalPath:draft,sha:created.content.sha,raw:markdown()})
  assert.equal(await readContent(db,draft),null)
  assert.match((await readContent(db,post)).raw,/Hello/)
  await assert.rejects(writeContent(db,{path:post,sha:created.content.sha,raw:markdown('stale')}),{status:409})
  await writeContent(db,{path:draft,raw:markdown('new draft')})
  await assert.rejects(writeContent(db,{path:draft,originalPath:post,sha:moved.content.sha,raw:markdown()}),{status:409})
  assert.equal((await readContent(db,post)).revision,moved.content.sha)
  await writeContent(db,{path:post,sha:moved.content.sha,remove:true})
  assert.equal(await readContent(db,post),null)
  assert.equal((await listContent(db,'src/posts')).length,0)
  const exported=await exportContent(db)
  assert.equal(exported.revisions.length,4)
  assert(exported.revisions.some(row=>row.path===draft&&row.raw.includes('Private')))
  await writeContent(db,{path:post,raw:markdown('Restored')})
  assert.equal((await exportContent(db)).revisions.length,5)
})

test('public API excludes drafts and tombstones; export token cannot edit or list drafts',async()=>{
  const db=database();await seed(db)
  const created=await writeContent(db,{path:post,raw:markdown()})
  await writeContent(db,{path:draft,raw:markdown('Secret')})
  let response=await request(db,'public/posts')
  assert.equal(response.status,200)
  assert(!JSON.stringify(await response.json()).includes('Secret'))
  assert.equal((await request(db,'export')).status,401)
  assert.equal((await request(db,'export',{headers:{Authorization:'Bearer wrong'}})).status,401)
  response=await request(db,'export',{headers:{Authorization:'Bearer backup-secret'}})
  assert.equal(response.status,200);assert(JSON.stringify(await response.json()).includes('Secret'))
  assert.equal((await request(db,'list?dir=src/drafts',{headers:{Authorization:'Bearer backup-secret'}})).status,401)
  assert.equal((await request(db,'file?path='+post,{method:'PUT',body:{text:markdown('Bad')},headers:{Authorization:'Bearer backup-secret','X-Admin':'1'}})).status,401)
  await writeContent(db,{path:post,sha:created.content.sha,remove:true})
  assert.deepEqual((await (await request(db,'public/posts')).json()).posts,{})
})

test('production writes require real allowlisted GitHub session, same origin and custom header',async()=>{
  const db=database();const original=globalThis.fetch
  globalThis.fetch=async()=>Response.json({login:'leodenglovescode'})
  try {
    const headers={Cookie:'gh_session=test-token','X-Admin':'1',Origin:'https://leodeng.dev'}
    assert.equal((await request(db,'file?path='+post,{method:'PUT',headers,body:{text:markdown()}})).status,200)
    assert.equal((await request(db,'file?path='+post,{method:'PUT',headers:{...headers,Origin:'https://evil.example'},body:{}})).status,403)
    assert.equal((await request(db,'file?path='+post,{method:'DELETE',headers:{Cookie:headers.Cookie},body:{}})).status,403)
    globalThis.fetch=async()=>Response.json({login:'someone-else'})
    assert.equal((await request(db,'list?dir=src/drafts',{headers})).status,401)
  } finally {globalThis.fetch=original}
})

test('content validation and bounded requests reject paths and malformed entries',async()=>{
  for(const path of ['src/posts/../secret.md','src/posts/sub/file.md','src/style.css','src/drafts/.secret.md']) assert.throws(()=>validateContent(path,markdown()))
  assert.throws(()=>validateContent(post,'---\ntitle: Missing date\n---\nBody'))
  assert.throws(()=>validateContent(shelf,'{"items":[{"id":"x"}]}'))
  assert.throws(()=>validateContent(post,'x'.repeat(500001)))
  for(const raw of ['null','[]','bad']) await assert.rejects(readBoundedJson(new Request('https://test',{method:'POST',body:raw}),10),{status:400})
  await assert.rejects(readBoundedJson(new Request('https://test',{method:'POST',body:'{"a":"123456789"}'}),10),{status:413})
  assert.equal(await safeEqual('same','same'),true);assert.equal(await safeEqual('same','different'),false);assert.equal(await safeEqual('',''),false)
})

test('renderers preserve classic styling, escaped metadata, Markdown, diagrams and live XML',()=>{
  const posts=publishedPosts([{path:post,raw:markdown('<Hello>')}])
  assert.match(blogHtml(posts),/&lt;Hello&gt;/)
  assert.match(blogHtml(posts,'hello',{classic:true}),/journal-post-heading/)
  assert.match(blogHtml(posts,'hello',{classic:true}),/<strong>formatting<\/strong>/)
  assert.match(contentRss(posts),/中文 &amp; test/)
  const diagram=publishedPosts([{path:post,raw:markdown()+'\n```mermaid\ngraph TD\nA-->B\n```'}])
  assert.match(blogHtml(diagram,'hello',{classic:true}),/<svg/)
  const image=publishedPosts([{path:post,raw:markdown()+'\n![Existing image](https://media.leodeng.dev/csgo-ct-funny.webp)'}])
  assert.match(blogHtml(image,'hello',{classic:true}),/src="\/_assets\/media\/[a-f0-9]{64}\.jpg"/)
  assert(!classicShelf({items:[]}).includes('<script'))
})

test('repository migration is valid SQLite and idempotent without overwriting later D1 edits',async()=>{
  const db=database(),{sql,files}=await migrationSql(process.cwd())
  db.sqlite.exec(sql)
  assert.equal((await exportContent(db)).files.length,files.length)
  const first=files.find(file=>file.path.startsWith('src/posts/'))
  const row=await readContent(db,first.path)
  await writeContent(db,{path:first.path,raw:markdown('Edited live'),sha:row.revision})
  db.sqlite.exec(sql)
  assert.match((await readContent(db,first.path)).raw,/Edited live/)
})
