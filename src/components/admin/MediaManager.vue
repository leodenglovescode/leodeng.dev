<script setup>
import { computed, ref, watch } from 'vue'
import {
  bytesToBase64,
  deleteFile,
  deleteMedia,
  listDir,
  listMedia,
  putFile,
  putMedia,
} from '../../utils/adminApi.js'

const MEDIA_DIR = 'public/blog-media'
const PUBLIC_PREFIX = '/blog-media'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

// A Worker request body tops out at 100 MB on the free plan, and the whole
// upload is one PUT. Stop short of the wall so the failure is a readable
// message here rather than an opaque 413 from the edge.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024

const props = defineProps({
  open: { type: Boolean, default: false },
  // False when opened from the post list, where there's no editor to insert into
  // — clicking a thumbnail copies its path instead.
  insertable: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'insert'])

// Images live in the repo, video lives in R2. They're different stores with
// different delete semantics, so they get different tabs rather than one
// merged grid that quietly does two very different things.
const tab = ref('images')
const isVideoTab = computed(() => tab.value === 'videos')

const images = ref([])
const videos = ref([])
const mediaBase = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const progress = ref('')
const dragging = ref(false)
const query = ref('')
const fileInput = ref(null)
const copied = ref('')

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

const files = computed(() => (isVideoTab.value ? videos.value : images.value))

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return files.value.filter((f) => !q || f.name.toLowerCase().includes(q))
})

function urlFor(file) {
  return isVideoTab.value ? file.url : `${PUBLIC_PREFIX}/${file.name}`
}

function markdownFor(file) {
  const url = urlFor(file)
  if (isVideoTab.value) {
    return `<video src="${url}" controls preload="metadata" playsinline class="w-full rounded-lg"></video>\n`
  }
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  return `![${alt}](${url})\n`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (isVideoTab.value) {
      const { base, files: listed } = await listMedia()
      mediaBase.value = base
      videos.value = listed
    } else {
      const entries = await listDir(MEDIA_DIR)
      images.value = entries
        .filter((e) => e.type === 'file')
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) load()
  },
  { immediate: true },
)

watch(tab, () => {
  error.value = ''
  query.value = ''
  load()
})

// Keeps filenames URL-safe, since these end up verbatim in a public path.
function safeName(name) {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file'
  const ext = (dot > 0 ? name.slice(dot) : '').toLowerCase()

  let candidate = `${base}${ext}`
  let n = 2
  const taken = new Set(files.value.map((f) => f.name))
  while (taken.has(candidate)) {
    candidate = `${base}-${n}${ext}`
    n += 1
  }
  return candidate
}

// Phones export 4K HEVC by default, which Chrome and Firefox refuse to decode
// — it uploads fine and then plays for nobody. Ask this browser to read the
// file's metadata first; if it can't, neither can most visitors.
function browserCanDecode(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')
    let settled = false

    const done = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(ok)
    }

    // A slow decode shouldn't block the upload — a false "this is broken" is
    // worse than letting an odd file through, so time out permissively.
    const timer = setTimeout(() => done(true), 5000)

    probe.preload = 'metadata'
    probe.onloadedmetadata = () => done(true)
    probe.onerror = () => done(false)
    probe.src = url
  })
}

async function upload(list) {
  const chosen = Array.from(list || [])
  if (!chosen.length) return

  busy.value = true
  error.value = ''
  try {
    for (const [index, file] of chosen.entries()) {
      const limit = isVideoTab.value ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
      if (file.size > limit) {
        const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
        throw new Error(`${file.name} is ${mb(file.size)} — the limit is ${mb(limit)}.`)
      }

      if (isVideoTab.value && !(await browserCanDecode(file))) {
        throw new Error(
          `${file.name} won't play in this browser — it's probably HEVC/H.265, which Chrome and ` +
            'Firefox can\'t decode. Re-export it as H.264 and try again.',
        )
      }

      const name = safeName(file.name)
      progress.value = `Uploading ${name} (${index + 1}/${chosen.length})…`

      if (isVideoTab.value) {
        await putMedia(name, file)
      } else {
        await putFile({
          path: `${MEDIA_DIR}/${name}`,
          base64: bytesToBase64(await file.arrayBuffer()),
          message: `chore(media): upload ${name}`,
        })
      }
      // Reflect it immediately so the next filename check sees it.
      await load()
    }
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
    progress.value = ''
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function remove(file) {
  const warning = isVideoTab.value
    ? `Delete ${file.name} from R2? This is immediate and can't be undone.`
    : `Delete ${file.name}? This commits the deletion to the repo.`
  if (!confirm(warning)) return

  busy.value = true
  error.value = ''
  try {
    if (isVideoTab.value) {
      await deleteMedia(file.name)
      videos.value = videos.value.filter((f) => f.name !== file.name)
    } else {
      await deleteFile({
        path: `${MEDIA_DIR}/${file.name}`,
        sha: file.sha,
        message: `chore(media): delete ${file.name}`,
      })
      images.value = images.value.filter((f) => f.name !== file.name)
    }
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function copyPath(file) {
  try {
    await navigator.clipboard.writeText(urlFor(file))
    copied.value = file.name
    setTimeout(() => {
      if (copied.value === file.name) copied.value = ''
    }, 1500)
  } catch {
    error.value = 'Could not copy to clipboard.'
  }
}

function onDrop(event) {
  dragging.value = false
  upload(event.dataTransfer?.files)
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
    @click.self="emit('close')"
  >
    <div
      class="w-full sm:max-w-3xl max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-fg/10 bg-bg shadow-2xl"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <header class="flex items-center gap-3 px-5 py-4 border-b border-fg/10">
        <h2 class="text-sm font-semibold text-fg">Media</h2>
        <span class="text-xs font-mono text-muted/90 truncate">
          {{ isVideoTab ? (mediaBase || 'R2') : 'public/blog-media' }}
        </span>
        <button
          type="button"
          class="ml-auto text-muted hover:text-fg transition-colors text-lg leading-none px-1"
          aria-label="Close"
          @click="emit('close')"
        >×</button>
      </header>

      <div class="flex items-center gap-1 px-5 pt-3">
        <button
          v-for="t in [{ id: 'images', label: 'Images' }, { id: 'videos', label: 'Videos' }]"
          :key="t.id"
          type="button"
          class="h-8 px-3 rounded-md text-sm font-medium transition-colors"
          :class="tab === t.id ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </div>

      <div class="flex items-center gap-2 px-5 py-3 border-b border-fg/10">
        <input
          v-model="query"
          type="search"
          placeholder="Filter…"
          class="flex-1 min-w-0 h-9 px-3 rounded-md bg-surface border border-fg/10 text-sm text-fg
                 outline-none focus:border-accent/50 placeholder:text-muted/90"
        />
        <input
          ref="fileInput"
          type="file"
          multiple
          :accept="isVideoTab ? 'video/*' : 'image/*'"
          class="hidden"
          @change="upload($event.target.files)"
        />
        <button
          type="button"
          :disabled="busy"
          class="h-9 px-3 rounded-md bg-accent-strong text-white text-sm font-medium hover:brightness-110
                 disabled:opacity-50 transition-colors shrink-0"
          @click="fileInput?.click()"
        >Upload</button>
      </div>

      <p v-if="error" class="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
        {{ error }}
      </p>
      <p v-if="progress" class="mx-5 mt-3 text-xs font-mono text-muted">{{ progress }}</p>

      <div class="flex-1 overflow-y-auto p-5" :class="dragging && 'ring-2 ring-inset ring-accent/50'">
        <p v-if="loading" class="text-sm text-muted">Loading…</p>

        <div v-else-if="!visible.length" class="py-12 text-center">
          <p class="text-sm text-muted">
            {{ files.length ? 'Nothing matches that filter.' : `No ${isVideoTab ? 'video' : 'images'} yet.` }}
          </p>
          <p class="text-xs text-muted/90 mt-1">Drag files anywhere in this panel to upload.</p>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <figure
            v-for="file in visible"
            :key="file.name"
            class="group rounded-lg border border-fg/10 bg-surface overflow-hidden flex flex-col"
          >
            <button
              type="button"
              class="block aspect-video bg-fg/5 overflow-hidden w-full"
              :title="insertable ? 'Insert into the post' : 'Copy path'"
              @click="insertable ? emit('insert', { markdown: markdownFor(file) }) : copyPath(file)"
            >
              <video
                v-if="isVideoTab"
                :src="file.url"
                preload="metadata"
                muted
                playsinline
                class="w-full h-full object-cover"
              />
              <img
                v-else-if="IMAGE.test(file.name)"
                :src="file.download_url"
                :alt="file.name"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <span v-else class="w-full h-full flex items-center justify-center text-xs font-mono text-muted/90">
                {{ file.name.split('.').pop().toUpperCase() }}
              </span>
            </button>

            <figcaption class="p-2 flex flex-col gap-1.5">
              <span class="text-xs font-mono text-fg truncate" :title="file.name">{{ file.name }}</span>
              <div class="flex items-center gap-2 text-xs text-muted/90">
                <span>{{ humanSize(file.size) }}</span>
                <button type="button" class="ml-auto hover:text-fg transition-colors" @click="copyPath(file)">
                  {{ copied === file.name ? 'copied' : 'copy path' }}
                </button>
                <button type="button" class="hover:text-red-400 transition-colors" :disabled="busy" @click="remove(file)">
                  delete
                </button>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>

      <footer class="px-5 py-3 border-t border-fg/10 text-xs text-muted/90">
        {{ insertable ? 'Click a thumbnail to insert it.' : 'Click a thumbnail to copy its path.' }}
        <template v-if="isVideoTab">Video uploads go straight to R2 — no commit, no undo.</template>
        <template v-else>Uploads commit straight to <code class="font-mono">main</code>.</template>
      </footer>
    </div>
  </div>
</template>
