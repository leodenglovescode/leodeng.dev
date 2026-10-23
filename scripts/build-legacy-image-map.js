// Plain JavaScript keeps the classic image map compatible with both Node and
// the older esbuild bundled with Cloudflare's Git-integrated Pages builder.
import fs from 'node:fs/promises'
const source=new URL('../src/generated/legacy-media.json',import.meta.url)
const destination=new URL('../src/generated/legacy-images.js',import.meta.url)
const {images}=JSON.parse(await fs.readFile(source,'utf8'))
const hashes=Object.fromEntries(Object.entries(images).flatMap(([source,url])=>{
  const match=url.match(/^https:\/\/media\.leodeng\.dev\/legacy\/images\/([a-f0-9]{64}\.jpg)$/)
  return match?[[source,match[1]]]:[]
}))
await fs.writeFile(destination,'// Generated from legacy-media.json by scripts/build-legacy-image-map.js.\nexport default '+JSON.stringify(hashes,null,2)+'\n')
