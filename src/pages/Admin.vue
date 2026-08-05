<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownEditor from '../components/admin/MarkdownEditor.vue'
import MediaManager from '../components/admin/MediaManager.vue'
import { deleteFile, getFile, getSession, listDir, logout, putFile, encodeBase64 } from '../utils/adminApi.js'
import { parseFrontmatter } from '../utils/posts.js'

const POSTS_DIR = 'src/posts'

const session = ref(null)
const booting = ref(true)
const view = ref('list')
const posts = ref([])
const loadingPosts = ref(false)
const error = ref('')
const notice = ref('')
const saving = ref(false)
const mediaOpen = ref(false)
const editor = ref(null)

const draft = ref(null)
const pristine = ref('')

/* ---------- frontmatter <-> form ---------- */

const pad = (n) => String(n).padStart(2, '0')

/** Local wall-clock time, to the minute, in the format `<input datetime-local>` wants. */
function nowLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * `2026-08-05T23:57` -> `2026-08-05T23:57:00+08:00`.
 * The offset is stamped from the browser, and the site renders the date
 * straight out of the string, so a post keeps the time it was written at.
 */
function toIsoWithOffset(local) {
  const minutes = -new Date(local).getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return `${local}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Any ISO string -> the `YYYY-MM-DDTHH:mm` the picker needs, offset untouched. */
function toLocalInput(iso) {
  if (!iso) return nowLocal()
  const match = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? `${match[1]}T${match[2]}` : nowLocal()
}

function yaml(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Always writes single-line quoted strings. Editors that soft-wrap long values
// into YAML folded scalars are what broke descriptions on the blog index.
function buildMarkdown(d) {
  return [
    '---',
    `title: ${yaml(d.title.trim())}`,
    `date: ${toIsoWithOffset(d.date)}`,
    `description: ${yaml(d.description.trim())}`,
    '---',
    '',
    `${d.body.trim()}`,
    '',
  ].join('\n')
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/* ---------- session ---------- */

onMounted(async () => {
  try {
    session.value = await getSession()
    if (session.value) await loadPosts()
  } catch (err) {
    error.value = err.message
  } finally {
    booting.value = false
  }
  window.addEventListener('beforeunload', warnIfDirty)
})

onBeforeUnmount(() => window.removeEventListener('beforeunload', warnIfDirty))

function warnIfDirty(event) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function signIn() {
  window.location.href = '/api/auth'
}

async function signOut() {
  if (isDirty.value && !confirm('You have unsaved changes. Sign out anyway?')) return
  await logout()
  session.value = null
  posts.value = []
  draft.value = null
  view.value = 'list'
}

function handleAuthError(err) {
  if (err.status === 401) {
    session.value = null
    error.value = 'Your session expired — sign in again.'
  } else {
    error.value = err.message
  }
}

/* ---------- posts ---------- */

async function loadPosts() {
  loadingPosts.value = true
  error.value = ''
  try {
    const entries = await listDir(POSTS_DIR)
    const markdown = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'))

    const loaded = await Promise.all(
      markdown.map(async (entry) => {
        const file = await getFile(`${POSTS_DIR}/${entry.name}`)
        const { meta, content } = parseFrontmatter(file?.text || '')
        return {
          slug: entry.name.replace(/\.md$/, ''),
          sha: file?.sha || entry.sha,
          title: meta.title || entry.name,
          date: meta.date || '',
          description: meta.description || '',
          body: content,
        }
      }),
    )

    posts.value = loaded.sort((a, b) => new Date(b.date) - new Date(a.date))
  } catch (err) {
    handleAuthError(err)
  } finally {
    loadingPosts.value = false
  }
}

function snapshot(d) {
  return JSON.stringify([d.slug, d.title, d.description, d.date, d.body])
}

const isDirty = computed(() => !!draft.value && snapshot(draft.value) !== pristine.value)

function newPost() {
  draft.value = {
    slug: '',
    originalSlug: null,
    sha: null,
    title: '',
    description: '',
    date: nowLocal(),
    body: '',
    slugTouched: false,
  }
  pristine.value = snapshot(draft.value)
  view.value = 'edit'
  notice.value = ''
}

function editPost(post) {
  draft.value = {
    slug: post.slug,
    originalSlug: post.slug,
    sha: post.sha,
    title: post.title,
    description: post.description,
    date: toLocalInput(post.date),
    body: post.body,
    slugTouched: true,
  }
  pristine.value = snapshot(draft.value)
  view.value = 'edit'
  notice.value = ''
}

function backToList() {
  if (isDirty.value && !confirm('Discard unsaved changes?')) return
  draft.value = null
  view.value = 'list'
  notice.value = ''
}

function onTitleInput() {
  // Auto-slug until the field is edited by hand, then leave it alone —
  // renaming a published post changes its URL.
  if (!draft.value.slugTouched) draft.value.slug = slugify(draft.value.title)
}

const validation = computed(() => {
  const d = draft.value
  if (!d) return null
  if (!d.title.trim()) return 'A title is required.'
  if (!d.slug.trim()) return 'A slug is required.'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.slug)) return 'The slug can only use lowercase letters, numbers and dashes.'
  if (!d.date) return 'A publish date is required.'
  if (!d.body.trim()) return 'The post body is empty.'
  const clash = posts.value.some((p) => p.slug === d.slug && p.slug !== d.originalSlug)
  if (clash) return `A post with the slug "${d.slug}" already exists.`
  return null
})

async function save() {
  if (saving.value) return
  if (validation.value) {
    error.value = validation.value
    return
  }

  saving.value = true
  error.value = ''
  notice.value = ''

  const d = draft.value
  const renamed = d.originalSlug && d.originalSlug !== d.slug

  try {
    const result = await putFile({
      path: `${POSTS_DIR}/${d.slug}.md`,
      base64: encodeBase64(buildMarkdown(d)),
      message: `${d.originalSlug ? 'content: update' : 'content: add'} post "${d.title.trim()}"`,
      sha: renamed ? undefined : d.sha || undefined,
    })

    if (renamed) {
      const old = posts.value.find((p) => p.slug === d.originalSlug)
      if (old) {
        await deleteFile({
          path: `${POSTS_DIR}/${d.originalSlug}.md`,
          sha: old.sha,
          message: `content: rename post to "${d.slug}"`,
        })
      }
    }

    d.sha = result.content.sha
    d.originalSlug = d.slug
    pristine.value = snapshot(d)
    notice.value = 'Saved — Cloudflare Pages will rebuild in a minute or two.'
    await loadPosts()
  } catch (err) {
    // 409 means the file moved under us: someone (or a git push) changed it
    // after this editor loaded its sha.
    if (err.status === 409) {
      error.value = 'This post changed in the repo since you opened it. Reload the list and reapply your edit.'
    } else {
      handleAuthError(err)
    }
  } finally {
    saving.value = false
  }
}

async function removePost(post) {
  if (!post) return false
  if (!confirm(`Delete "${post.title}"? This commits the deletion to main.`)) return false
  error.value = ''
  try {
    await deleteFile({
      path: `${POSTS_DIR}/${post.slug}.md`,
      sha: post.sha,
      message: `content: delete post "${post.title}"`,
    })
    posts.value = posts.value.filter((p) => p.slug !== post.slug)
    notice.value = `Deleted "${post.title}".`
    return true
  } catch (err) {
    handleAuthError(err)
    return false
  }
}

async function deleteCurrent() {
  const post = posts.value.find((p) => p.slug === draft.value.originalSlug)
  if (await removePost(post)) {
    draft.value = null
    view.value = 'list'
  }
}

function onMediaInsert(payload) {
  editor.value?.insertMedia(payload)
  mediaOpen.value = false
}

function displayDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  const time = iso.slice(11, 16)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m) - 1]} ${Number(d)}, ${y} · ${time}`
}
</script>

<template>
  <div class="min-h-screen bg-bg">
    <div class="max-w-5xl mx-auto px-6 py-10">
      <!-- header -->
      <header class="flex items-center gap-4 mb-8">
        <RouterLink to="/" class="text-sm font-mono text-muted hover:text-fg transition-colors no-underline">
          leodeng.dev
        </RouterLink>
        <span class="text-muted/30">/</span>
        <h1 class="text-sm font-mono text-fg">admin</h1>

        <div v-if="session" class="ml-auto flex items-center gap-3">
          <img v-if="session.avatar" :src="session.avatar" alt="" class="w-6 h-6 rounded-full" />
          <span class="text-xs font-mono text-muted hidden sm:inline">@{{ session.login }}</span>
          <button
            type="button"
            class="text-xs text-muted hover:text-fg transition-colors"
            @click="signOut"
          >Sign out</button>
        </div>
      </header>

      <p v-if="error" class="mb-5 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
        {{ error }}
      </p>
      <p v-if="notice" class="mb-5 text-sm text-accent bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">
        {{ notice }}
      </p>

      <!-- booting -->
      <p v-if="booting" class="text-sm text-muted font-mono">Checking session…</p>

      <!-- signed out -->
      <section v-else-if="!session" class="max-w-md mx-auto text-center py-20">
        <h2 class="text-lg font-semibold text-fg mb-2">Sign in to edit</h2>
        <p class="text-sm text-muted mb-8">
          GitHub is the only way in — there's no password to guess, and only allowlisted
          accounts get a session.
        </p>
        <button
          type="button"
          class="inline-flex items-center gap-2.5 h-11 px-5 rounded-lg bg-fg text-bg text-sm font-medium
                 hover:opacity-90 transition-opacity"
          @click="signIn"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          Continue with GitHub
        </button>
      </section>

      <!-- post list -->
      <section v-else-if="view === 'list'">
        <div class="flex items-center gap-3 mb-6">
          <h2 class="text-xs font-mono text-muted uppercase tracking-widest">Posts</h2>
          <span v-if="posts.length" class="text-xs font-mono text-muted/40">{{ posts.length }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="h-9 px-3 rounded-md border border-fg/10 text-sm text-muted hover:text-fg hover:border-fg/20 transition-colors"
              @click="mediaOpen = true"
            >Media</button>
            <button
              type="button"
              class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-soft transition-colors"
              @click="newPost"
            >New post</button>
          </div>
        </div>

        <p v-if="loadingPosts" class="text-sm text-muted font-mono">Loading posts…</p>
        <p v-else-if="!posts.length" class="text-sm text-muted/60 italic py-10">No posts yet.</p>

        <ul v-else class="flex flex-col">
          <li
            v-for="post in posts"
            :key="post.slug"
            class="group flex items-start gap-4 py-4 border-b border-fg/5"
          >
            <button type="button" class="flex-1 min-w-0 text-left" @click="editPost(post)">
              <h3 class="text-fg font-semibold text-sm group-hover:text-accent transition-colors truncate">
                {{ post.title }}
              </h3>
              <p v-if="post.description" class="text-xs text-muted mt-1 line-clamp-2">{{ post.description }}</p>
              <p class="text-[11px] font-mono text-muted/40 mt-1.5">
                {{ displayDate(post.date) }} · /blog/{{ post.slug }}
              </p>
            </button>
            <div class="flex items-center gap-3 shrink-0 pt-0.5">
              <a
                :href="`/blog/${post.slug}`"
                target="_blank"
                rel="noopener"
                class="text-xs text-muted/50 hover:text-fg transition-colors no-underline"
              >View</a>
              <button type="button" class="text-xs text-muted/50 hover:text-red-400 transition-colors" @click="removePost(post)">
                Delete
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- editor -->
      <section v-else-if="draft">
        <div class="flex items-center gap-3 mb-6">
          <button
            type="button"
            class="text-xs font-mono text-muted hover:text-fg transition-colors"
            @click="backToList"
          >← Posts</button>
          <span v-if="isDirty" class="text-[11px] font-mono text-accent">unsaved</span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              :disabled="saving || !!validation"
              :title="validation || 'Commit to main (ctrl+S)'"
              class="h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-soft
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="save"
            >{{ saving ? 'Publishing…' : 'Publish' }}</button>
          </div>
        </div>

        <div class="grid gap-4 mb-5">
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] font-mono text-muted uppercase tracking-wider">Title</span>
            <input
              v-model="draft.title"
              type="text"
              placeholder="How I broke my homelab again"
              class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-base text-fg
                     outline-none focus:border-accent/50 placeholder:text-muted/40"
              @input="onTitleInput"
            />
          </label>

          <div class="grid sm:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] font-mono text-muted uppercase tracking-wider">Slug</span>
              <input
                v-model="draft.slug"
                type="text"
                class="h-10 px-3 rounded-md bg-surface border border-fg/10 font-mono text-sm text-fg
                       outline-none focus:border-accent/50"
                @input="draft.slugTouched = true"
              />
              <span class="text-[11px] font-mono text-muted/40">/blog/{{ draft.slug || '…' }}</span>
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] font-mono text-muted uppercase tracking-wider">Publish date &amp; time</span>
              <input
                v-model="draft.date"
                type="datetime-local"
                class="h-10 px-3 rounded-md bg-surface border border-fg/10 font-mono text-sm text-fg
                       outline-none focus:border-accent/50"
              />
              <span class="text-[11px] font-mono text-muted/40">saved as {{ toIsoWithOffset(draft.date || nowLocal()) }}</span>
            </label>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] font-mono text-muted uppercase tracking-wider">Description</span>
            <textarea
              v-model="draft.description"
              rows="2"
              placeholder="The one-line summary that shows on the blog index and in link previews."
              class="px-3 py-2.5 rounded-md bg-surface border border-fg/10 text-sm text-text resize-y
                     outline-none focus:border-accent/50 placeholder:text-muted/40"
            />
          </label>
        </div>

        <MarkdownEditor
          ref="editor"
          v-model="draft.body"
          @request-media="mediaOpen = true"
          @save="save"
        />

        <div class="flex items-center gap-4 mt-4">
          <p class="text-[11px] text-muted/40">
            Publishing commits <code class="font-mono">{{ POSTS_DIR }}/{{ draft.slug || 'slug' }}.md</code> to
            <code class="font-mono">main</code>.
          </p>
          <button
            v-if="draft.originalSlug"
            type="button"
            class="ml-auto text-xs text-muted/50 hover:text-red-400 transition-colors shrink-0"
            @click="deleteCurrent"
          >Delete post</button>
        </div>
      </section>
    </div>

    <MediaManager
      :open="mediaOpen"
      :insertable="view === 'edit'"
      @close="mediaOpen = false"
      @insert="onMediaInsert"
    />
  </div>
</template>
