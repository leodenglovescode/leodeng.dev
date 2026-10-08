import projectData from '../../content/projects.json'
import nowData from '../../content/now.json'
import { getAllPosts } from '../posts.js'
import { calcAge } from '../age.js'
import { HOME } from './guest.js'
import { recordings } from './recordings.js'

export function terminalFiles({ t, aboutText, localized }) {
  const files = Object.create(null)
  const directory = path => { files[path] = { type: 'directory' } }
  const file = (name, content, route) => { files[`${HOME}/${name}`] = { type: 'text', content, route } }
  for (const path of [HOME, `${HOME}/projects`, `${HOME}/blog`, `${HOME}/voice`]) directory(path)
  file('voice/README.txt', t('voiceReadme'))
  file('voice/welcome.url', recordings.en)
  file('voice/welcome-chinese.url', recordings.zh)
  file('README.txt', t('readme'))
  file('about.txt', [aboutText('iMLeoYearsOldFromBeijing', { p0: calcAge() }), aboutText('iMostlyUseVueAndReactFor')].join('\n\n'), '/about')
  file('contact.txt', 'leodeng@leodeng.dev\nhttps://github.com/leodenglovescode', '/contact')
  file('now.txt', nowData.events.map(event => `${localized(event.title)} [${event.status}]\n${localized(event.details)}`).join('\n\n'), '/now')
  file('gallery.txt', t('galleryFile'), '/gallery')
  file('time.txt', t('timeFile'), '/time')
  const projects = projectData.projects || []
  file('projects/README.txt', projects.map(project => `${localized(project.title)}\n${localized(project.description)}`).join('\n\n'), '/projects')
  for (const project of projects) file(`projects/${project.id}.txt`, `${localized(project.title)}\n\n${localized(project.description)}\n\n${project.url || ''}\n${(project.tags || []).join(', ')}`, '/projects')
  const posts = getAllPosts()
  file('blog/README.txt', posts.map(post => `${post.displayDate}  ${post.title}\n${post.slug}.txt`).join('\n\n'), '/blog')
  for (const post of posts) file(`blog/${post.slug}.txt`, `${post.title}\n${post.displayDate}\n\n${post.description || ''}`, `/blog/${post.slug}`)
  return files
}
