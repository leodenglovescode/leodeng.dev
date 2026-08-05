<script setup>
import { computed, ref, watch } from 'vue'
import { bytesToBase64, deleteFile, listDir, putFile } from '../../utils/adminApi.js'

const MEDIA_DIR = 'public/blog-media'
const PUBLIC_PREFIX = '/blog-media'
const MAX_BYTES = 20 * 1024 * 1024

const props = defineProps({
  open: { type: Boolean, default: false },
  // False when opened from the post list, where there's no editor to insert into
  // — clicking a thumbnail copies its path instead.
  insertable: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'insert'])

const files = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const progress = ref('')
const dragging = ref(false)
const query = ref('')
const fileInput = ref(null)
const copied = ref('')

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i
const VIDEO = /\.(mp4|webm|mov)$/i

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return files.value.filter((f) => !q || f.name.toLowerCase().includes(q))
})

function publicPath(name) {
  return `${PUBLIC_PREFIX}/${name}`
}

function markdownFor(file) {
  const path = publicPath(file.name)
  if (VIDEO.test(file.name)) {
    return `<video src="${path}" controls playsinline class="w-full rounded-lg"></video>\n`
  }
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  return `![${alt}](${path})\n`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const entries = await listDir(MEDIA_DIR)
    files.value = entries
      .filter((e) => e.type === 'file')
      .sort((a, b) => a.name.localeCompare(b.name))
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

async function upload(list) {
  const chosen = Array.from(list || [])
  if (!chosen.length) return

  busy.value = true
  error.value = ''
  try {
    for (const [index, file] of chosen.entries()) {
      if (file.size > MAX_BYTES) {
        throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 20 MB.`)
      }
      const name = safeName(file.name)
      progress.value = `Uploading ${name} (${index + 1}/${chosen.length})…`
      const base64 = bytesToBase64(await file.arrayBuffer())
      await putFile({
        path: `${MEDIA_DIR}/${name}`,
        base64,
        message: `chore(media): upload ${name}`,
      })
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
  if (!confirm(`Delete ${file.name}? This commits the deletion to the repo.`)) return
  busy.value = true
  error.value = ''
  try {
    await deleteFile({
      path: `${MEDIA_DIR}/${file.name}`,
      sha: file.sha,
      message: `chore(media): delete ${file.name}`,
    })
    files.value = files.value.filter((f) => f.name !== file.name)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function copyPath(file) {
  try {
    await navigator.clipboard.writeText(publicPath(file.name))
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
        <span class="text-xs font-mono text-muted/50">public/blog-media</span>
        <button
          type="button"
          class="ml-auto text-muted hover:text-fg transition-colors text-lg leading-none px-1"
          aria-label="Close"
          @click="emit('close')"
        >×</button>
      </header>

      <div class="flex items-center gap-2 px-5 py-3 border-b border-fg/10">
        <input
          v-model="query"
          type="search"
          placeholder="Filter…"
          class="flex-1 min-w-0 h-9 px-3 rounded-md bg-surface border border-fg/10 text-sm text-fg
                 outline-none focus:border-accent/50 placeholder:text-muted/40"
        />
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          class="hidden"
          @change="upload($event.target.files)"
        />
        <button
          type="button"
          :disabled="busy"
          class="h-9 px-3 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-soft
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
            {{ files.length ? 'Nothing matches that filter.' : 'No media yet.' }}
          </p>
          <p class="text-xs text-muted/50 mt-1">Drag files anywhere in this panel to upload.</p>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <figure
            v-for="file in visible"
            :key="file.sha"
            class="group rounded-lg border border-fg/10 bg-surface overflow-hidden flex flex-col"
          >
            <button
              type="button"
              class="block aspect-video bg-fg/5 overflow-hidden"
              :title="insertable ? 'Insert into the post' : 'Copy path'"
              @click="insertable ? emit('insert', { markdown: markdownFor(file) }) : copyPath(file)"
            >
              <img
                v-if="IMAGE.test(file.name)"
                :src="file.download_url"
                :alt="file.name"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <span v-else class="w-full h-full flex items-center justify-center text-xs font-mono text-muted/60">
                {{ file.name.split('.').pop().toUpperCase() }}
              </span>
            </button>

            <figcaption class="p-2 flex flex-col gap-1.5">
              <span class="text-[11px] font-mono text-fg truncate" :title="file.name">{{ file.name }}</span>
              <div class="flex items-center gap-2 text-[10px] text-muted/50">
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

      <footer class="px-5 py-3 border-t border-fg/10 text-[11px] text-muted/50">
        {{ insertable ? 'Click a thumbnail to insert it.' : 'Click a thumbnail to copy its path.' }}
        Uploads commit straight to <code class="font-mono">main</code>.
      </footer>
    </div>
  </div>
</template>
