import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function prerender() {
  const { render } = await import('./dist-ssr/entry-server.js')
  const html = await render()

  const templatePath = path.join(__dirname, 'dist/index.html')
  const template = fs.readFileSync(templatePath, 'utf-8')

  const finalHtml = template.replace(
    '<div id="app"></div>',
    `<div id="app">${html}</div>`
  )

  fs.writeFileSync(templatePath, finalHtml)
  console.log('✓ Pre-rendered index.html with static content')
}

prerender().catch(err => {
  console.error('Pre-render failed:', err)
  process.exit(1)
})
