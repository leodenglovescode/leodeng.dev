#!/usr/bin/env node
// Generates src/generated/changelog.json from the repo's own history, so
// /changelog is a real record of how the site got built rather than a
// hand-maintained list that goes stale the moment you stop updating it.
//
// Runs before dev/build (see package.json pre* scripts). The output is
// committed: if git history and the GitHub API are both unavailable at build
// time the previous file is left in place, which keeps the import in
// src/pages/Changelog.vue from failing the build.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(__dirname, '../src/generated/changelog.json')
const REPO = process.env.GITHUB_REPO || 'leodenglovescode/leodeng.dev'

// Field and record separators that can't appear in a commit subject.
const FS = '\x1f'
const RS = '\x1e'

// Conventional-commit prefixes, mapped onto the four buckets the page groups
// by. Anything unrecognised — including the early pre-convention commits and
// the ones Decap CMS used to write — falls through to `other`.
const TYPE_MAP = {
  feat: 'feat', feature: 'feat',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix',
  content: 'content', post: 'content', docs: 'content',
  chore: 'chore', refactor: 'chore', style: 'chore',
  perf: 'chore', build: 'chore', ci: 'chore', test: 'chore',
}

function classify(subject) {
  const m = subject.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/)
  if (m && TYPE_MAP[m[1].toLowerCase()]) {
    return { type: TYPE_MAP[m[1].toLowerCase()], scope: m[2] || null, subject: m[3].trim() }
  }
  // Decap CMS wrote every publish as `Create/Update Blog Posts "slug"`.
  if (/^(create|update|delete)\s+blog\s+posts?\b/i.test(subject)) {
    return { type: 'content', scope: null, subject }
  }
  return { type: 'other', scope: null, subject }
}

function fromGit() {
  const raw = execFileSync('git', [
    'log', '--no-merges', '--date=short',
    `--pretty=format:%H${FS}%ad${FS}%s${RS}`,
  ], { cwd: path.join(__dirname, '..'), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })

  return raw.split(RS)
    .map(r => r.trim())
    .filter(Boolean)
    .map(record => {
      const [hash, date, subject] = record.split(FS)
      return { hash, date, ...classify(subject) }
    })
}

function fromExisting() {
  if (!fs.existsSync(OUT_PATH)) return []

  try {
    const data = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'))
    return Array.isArray(data.commits) ? data.commits : []
  } catch (err) {
    console.warn(`  Existing changelog.json unavailable (${err.message})`)
    return []
  }
}

async function fromGitHub() {
  // Cloudflare Pages clones shallowly on some build images, so `git log` can
  // come back with a single commit. The API has the whole history.
  const commits = []
  for (let page = 1; page <= 4; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=100&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'leodeng.dev-build' } },
    )
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const batch = await res.json()
    if (!batch.length) break
    for (const c of batch) {
      if (c.parents?.length > 1) continue // merge
      const subject = (c.commit?.message || '').split('\n')[0]
      commits.push({
        hash: c.sha,
        date: (c.commit?.author?.date || '').slice(0, 10),
        ...classify(subject),
      })
    }
    if (batch.length < 100) break
  }
  return commits
}

async function main() {
  const existing = fromExisting()
  let commits = []
  let source = 'git'

  try {
    commits = fromGit()
  } catch (err) {
    console.warn(`  git log unavailable (${err.message})`)
  }

  // One commit almost always means a shallow clone rather than a one-commit
  // repo, and a one-entry changelog is worse than no changelog.
  if (commits.length <= 1) {
    try {
      commits = await fromGitHub()
      source = 'github'
    } catch (err) {
      console.warn(`  GitHub API fallback failed (${err.message})`)
    }
  }

  // A failed/rate-limited API request used to leave the one commit from a
  // shallow Pages clone in `commits`, which then overwrote the complete
  // committed index. Never replace a fuller known-good history with that.
  if (commits.length <= 1 && existing.length > commits.length) {
    console.warn(`  Keeping existing changelog.json (${existing.length} commits) instead of incomplete ${source} history (${commits.length})`)
    commits = existing
    source = 'existing index'
  }

  if (!commits.length) {
    if (fs.existsSync(OUT_PATH)) {
      console.warn('✗ No commits found — keeping the existing changelog.json')
      return
    }
    console.warn('✗ No commits found and no existing changelog.json — writing an empty one')
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    repo: REPO,
    generatedAt: new Date().toISOString().slice(0, 10),
    commits,
  }, null, 1) + '\n')

  console.log(`✓ changelog.json — ${commits.length} commits (via ${source})`)
}

main().catch(err => {
  console.error('Changelog generation failed:', err)
  process.exit(1)
})
