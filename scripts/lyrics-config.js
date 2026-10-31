// Server-side dev tooling only. This file must never be imported by client code.
import fs from 'node:fs'
import path from 'node:path'
export function loadLyricsEnvironment(root) {
  const names = ['LYRICS_LOCAL_URL', 'LYRICS_LOCAL_TOKEN', 'LYRICS_ACCESS_CLIENT_ID', 'LYRICS_ACCESS_CLIENT_SECRET']
  let local = {}
  try { local = JSON.parse(fs.readFileSync(path.join(root, '.local-admin/lyrics-config.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Private lyrics configuration could not be read.') }
  return Object.fromEntries(names.map(name => [name, process.env[name] || local?.[name] || '']))
}
