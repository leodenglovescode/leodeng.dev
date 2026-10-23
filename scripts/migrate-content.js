// Generate a private, repeatable seed. Applying it never overwrites a D1 edit.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CONTENT_SCHEMA, SHELF_PATH, validateContent } from '../lib/content.js'
export async function migrationSql(root) {
  const files=[]
  for (const directory of ['src/posts','src/drafts']) {
    const entries=await fs.readdir(path.join(root,directory)).catch(error=>{if(error.code==='ENOENT')return [];throw error})
    for(const name of entries.filter(name=>name.endsWith('.md')).sort()) files.push({path:directory+'/'+name,raw:await fs.readFile(path.join(root,directory,name),'utf8')})
  }
  files.push({path:SHELF_PATH,raw:await fs.readFile(path.join(root,SHELF_PATH),'utf8')})
  const quote=text=>"'"+text.replaceAll("'","''")+"'"
  const now=new Date().toISOString(),sql=[...CONTENT_SCHEMA]
  for(const file of files) {
    validateContent(file.path,file.raw)
    sql.push(`INSERT OR IGNORE INTO site_content(path,raw,revision,updated_at) VALUES(${[file.path,file.raw,randomUUID(),now].map(quote).join(',')})`)
  }
  sql.push('INSERT OR IGNORE INTO site_content_revisions SELECT revision,path,raw,updated_at,deleted FROM site_content')
  sql.push("INSERT OR IGNORE INTO site_content_meta(key,value) VALUES('ready','1')")
  return {sql:sql.join(';\n')+';\n',files}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  const destination=path.resolve(process.argv[2]||path.join(root,'.local-admin/content-migration.sql'))
  const {sql,files}=await migrationSql(root)
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700})
  await fs.writeFile(destination,sql,{mode:0o600})
  console.log(`Prepared ${files.length} content files at ${destination}. Existing D1 entries will be preserved.`)
}
