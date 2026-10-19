<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UploadProgress from './UploadProgress.vue'
import { useUploadProgress } from '../../utils/uploadProgress.js'
import { localAdmin, newContentId, encodeBase64, getFile, putFile, putMedia } from '../../utils/adminApi.js'
import { compareShelfTitles, findDuplicateAlbum, imdbId, musicBrainzReference, shelfStatus, validateShelfItem, wikipediaSourceUrl } from '../../utils/shelf.js'
import ShelfArtwork from '../ShelfArtwork.vue'
import ShelfSearch from './ShelfSearch.vue'
// Register the content HMR boundary even when the public shelf has not been opened.
import '../../utils/shelfContent.js'

const PATH = 'src/content/shelf.json'
const RECOVERY_KEY = 'leodeng:admin:shelf-buffer'
const emit = defineEmits(['dirty-change'])
const items = ref([])
const sha = ref(null)
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const coverInput = ref(null)
const catalogSearch = ref(null)
const error = ref('')
const uploadState = useUploadProgress()
const notice = ref('')
const form = ref(null)
const pristine = ref('')
const recovery = ref(null)
const filter = ref('all')
const types = { movie: 'Movies', tv: 'TV shows', album: 'Albums' }
const dirty = computed(() => uploading.value || !!form.value && JSON.stringify(form.value) !== pristine.value)
const visible = computed(() => items.value.filter(item => filter.value === 'all' || item.type === filter.value).sort(compareShelfTitles))
const preview = computed(() => {
  if (!form.value) return null
  const reference = musicBrainzReference(form.value.musicBrainzId, form.value.musicBrainzKind)
  return { ...form.value, ...(reference ? { musicBrainzId: reference.id, musicBrainzKind: reference.kind } : {}) }
})
watch(dirty, value => emit('dirty-change', value), { immediate: true })
watch(form, () => {
  try {
    if (dirty.value) localStorage.setItem(RECOVERY_KEY, JSON.stringify({ form: form.value, pristine: pristine.value }))
    else localStorage.removeItem(RECOVERY_KEY)
  } catch { /* Storage can be unavailable in private browsing. */ }
}, { deep: true })

onMounted(async () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECOVERY_KEY) || 'null')
    if (stored?.form && typeof stored.form.title?.en === 'string' && types[stored.form.type]) recovery.value = stored
  } catch { /* An old or inaccessible recovery must not block the editor. */ }
  await load()
})
onBeforeUnmount(() => emit('dirty-change', false))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const file = await getFile(PATH)
    if (!file) throw new Error('Shelf file not found. Deploy the shelf changes to the repository first.')
    const data = JSON.parse(file.text)
    if (!Array.isArray(data.items)) throw new Error('The shelf file must contain an items array.')
    items.value = data.items
    sha.value = file.sha
  } catch (err) { error.value = err.message }
  finally { loading.value = false }
}

function discardRecovery() {
  recovery.value = null
  try { localStorage.removeItem(RECOVERY_KEY) } catch { /* Optional local recovery. */ }
}
function restoreRecovery() {
  pristine.value = recovery.value.pristine || ''
  form.value = { ...recovery.value.form, status: shelfStatus(recovery.value.form), artworkMode: recovery.value.form.artworkMode || 'original', customArtworkUrl: recovery.value.form.customArtworkUrl || '' }
  recovery.value = null
}
function edit(item = null) {
  if (saving.value || uploading.value || (dirty.value && !confirm('Discard unsaved shelf changes?'))) return
  initializeForm(item)
}
function initializeForm(item = null, type = filter.value === 'all' ? 'movie' : filter.value) {
  uploadState.clear()
  form.value = {
    id: item?.id || newContentId(),
    originalId: item?.id || null,
    type: item?.type || type,
    title: { en: item?.title?.en || '', zh: item?.title?.zh || '' },
    year: item?.year || '',
    artist: item?.artist || '',
    imdbId: item?.imdbId || '',
    posterUrl: item?.posterUrl || '',
    posterSourceUrl: item?.posterSourceUrl || '',
    artworkMode: item?.artworkMode || 'original',
    customArtworkUrl: item?.customArtworkUrl || '',
    musicBrainzId: item?.musicBrainzId || '',
    musicBrainzKind: item?.musicBrainzKind || 'release',
    watchedAt: item?.watchedAt || '',
    status: shelfStatus(item || {}),
  }
  pristine.value = JSON.stringify(form.value)
  error.value = ''
  notice.value = ''
}
function close() {
  if (saving.value || uploading.value || (dirty.value && !confirm('Discard unsaved shelf changes?'))) return
  form.value = null
  error.value = ''
}
function clean(item) {
  const base = { id: item.id, type: item.type, title: { en: item.title.en.trim(), zh: item.title.zh.trim() }, year: String(item.year).trim(), artworkMode: item.artworkMode || 'original', customArtworkUrl: item.customArtworkUrl || '' }
  if (item.type === 'album') {
    const reference = musicBrainzReference(item.musicBrainzId, item.musicBrainzKind)
    return { ...base, artist: item.artist.trim(), musicBrainzId: reference?.id || '', musicBrainzKind: reference?.kind || 'release' }
  }
  return { ...base, imdbId: imdbId(item.imdbId), posterUrl: item.posterUrl.trim(), posterSourceUrl: wikipediaSourceUrl(item.posterSourceUrl), status: shelfStatus(item), watchedAt: item.status === 'watching' ? '' : item.watchedAt }
}
function applyCatalog(item) {
  form.value.title = { ...item.title }
  form.value.year = item.year || ''
  form.value.artist = item.artist || ''
  form.value.imdbId = item.imdbId || ''
  form.value.posterUrl = item.posterUrl || ''
  form.value.posterSourceUrl = item.posterSourceUrl || ''
  form.value.musicBrainzId = item.musicBrainzId || ''
  form.value.musicBrainzKind = item.musicBrainzKind || 'release'
  notice.value = item.type !== 'album' && !item.imdbId ? 'This result has no IMDb ID. Add one below before saving.' : 'Details filled in. Check your viewing status and cover, then save.'
}
async function uploadCover(event) {
  if (uploading.value || saving.value) return
  const file = event.target.files?.[0]
  if (!file) return
  uploadState.clear()
  error.value = ''
  if (!file.type.startsWith('image/')) { error.value = 'Choose an image file.'; event.target.value = ''; return }
  if (file.size > 15 * 1024 * 1024) { error.value = 'Cover images must be smaller than 15 MB.'; event.target.value = ''; return }
  uploading.value = true
  uploadState.prepare(file)
  try {
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'img'
    const uploaded = await putMedia(`shelf-${newContentId()}.${extension}`.slice(0, 128), file, { onProgress: uploadState.update })
    form.value.customArtworkUrl = uploaded.url
    form.value.artworkMode = 'custom'
    notice.value = 'Cover uploaded to R2. Save the entry to use it on your shelf.'
    uploadState.complete()
  } catch (err) { uploadState.fail(); error.value = err.message }
  finally { uploading.value = false; if (coverInput.value) coverInput.value.value = '' }
}
async function commit(next, message) {
  const result = await putFile({ path: PATH, base64: encodeBase64(`${JSON.stringify({ items: next }, null, 2)}\n`), message, sha: sha.value })
  sha.value = result.content.sha
  items.value = next
}
function report(err) {
  error.value = [409, 422].includes(err.status)
    ? 'The shelf changed in the repository. Your edit is kept. Copy any unsaved changes, close the form, reload the shelf, then reapply them.'
    : err.status === 401 ? 'Your session expired. Your unsaved edit is kept on this device. Sign in again to save.' : err.message
}
async function save() {
  if (saving.value || uploading.value || !sha.value) return
  error.value = validateShelfItem(form.value)
  if (error.value) return
  const item = clean(form.value)
  const duplicate = findDuplicateAlbum(items.value, item, form.value.originalId)
  if (duplicate && !confirm(`This album is already on your shelf: “${duplicate.title.en}”${duplicate.artist ? ` by ${duplicate.artist}` : ''}.\n\nIt has the same MusicBrainz ID. Add it again?`)) return
  saving.value = true
  notice.value = ''
  const next = [...items.value]
  const index = next.findIndex(entry => entry.id === form.value.originalId)
  if (index < 0) next.unshift(item)
  else next.splice(index, 1, item)
  try {
    await commit(next, `content: ${index < 0 ? 'add' : 'update'} shelf ${item.type} "${item.title.en}"`)
    if (index < 0) {
      initializeForm(null, item.type)
      notice.value = `Added “${item.title.en}”. Ready for the next entry.`
    } else {
      form.value = null
      notice.value = localAdmin.value ? 'Saved to the local shelf file.' : 'Saved. Cloudflare Pages will rebuild the shelf in a minute or two.'
    }
  } catch (err) { report(err) }
  finally { saving.value = false }
  if (form.value && !form.value.originalId && !error.value) {
    await nextTick()
    catalogSearch.value?.focus()
  }
}
async function remove(item) {
  if (saving.value || uploading.value || !confirm(`Remove "${item.title.en}" from the shelf?`)) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await commit(items.value.filter(entry => entry.id !== item.id), `content: remove shelf item "${item.title.en}"`)
    notice.value = localAdmin.value ? 'Removed from the local shelf file.' : 'Removed. The site will rebuild shortly.'
  } catch (err) { report(err) }
  finally { saving.value = false }
}
</script>

<template>
  <div>
    <p v-if="error" role="alert" class="mb-5 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{{ error }}</p>
    <p v-if="notice" role="status" class="mb-5 text-sm text-accent bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">{{ notice }}</p>
    <p v-if="loading" class="text-sm text-muted">Loading shelf…</p>
    <template v-else-if="!form">
      <div v-if="recovery" class="mb-5 rounded-lg border border-accent/20 p-4 text-sm text-muted">
        <p>Unsaved shelf entry: {{ recovery.form.title.en || 'Untitled' }}</p>
        <button type="button" class="mt-2 mr-4 text-accent" :disabled="!sha" @click="restoreRecovery">Restore edit</button>
        <button type="button" class="text-muted hover:text-fg" @click="discardRecovery">Discard</button>
      </div>
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <label class="sr-only" for="shelf-admin-filter">Category</label>
        <select id="shelf-admin-filter" v-model="filter" class="shelf-input w-auto">
          <option value="all">All entries</option>
          <option v-for="(label, type) in types" :key="type" :value="type">{{ label }}</option>
        </select>
        <a href="/shelf" target="_blank" rel="noopener noreferrer" class="text-sm text-muted hover:text-fg">View shelf ↗</a>
        <button type="button" :disabled="saving || uploading" class="text-sm text-muted hover:text-fg" @click="load">Reload</button>
        <button type="button" :disabled="!sha || saving || !!recovery" class="shelf-primary ml-auto" @click="edit()">Add entry</button>
      </div>
      <p class="text-sm text-muted mb-6">Movies and shows link to IMDb. Albums have no outgoing link. Each shelf is sorted A to Z by title automatically.</p>
      <p v-if="!visible.length" class="py-10 text-sm text-muted">Nothing here yet. Add a movie, TV show or album to start your shelf.</p>
      <ul class="divide-y divide-fg/10">
        <li v-for="item in visible" :key="item.id" class="flex items-center gap-4 py-4">
          <button type="button" :disabled="saving || uploading" class="text-left flex gap-4 items-center flex-1 min-w-0" @click="edit(item)">
            <ShelfArtwork :item="item" class="w-12 shrink-0" />
            <span class="min-w-0"><span class="block text-sm font-semibold text-fg truncate">{{ item.title.en }}</span><span class="block text-xs text-muted mt-1">{{ [types[item.type], item.type === 'album' ? item.artist : shelfStatus(item) === 'watching' ? 'In progress' : 'Finished', item.year].filter(Boolean).join(' · ') }}</span></span>
          </button>
          <div class="flex items-center gap-3 shrink-0">
            <button type="button" :disabled="saving || uploading" class="text-xs text-muted hover:text-red-400" @click="remove(item)">Remove</button>
          </div>
        </li>
      </ul>
    </template>
    <form v-else class="space-y-6" @submit.prevent="save">
      <div class="flex items-center gap-3">
        <button type="button" :disabled="saving || uploading" class="text-sm font-mono text-muted hover:text-fg" @click="close">← Shelf</button>
        <span v-if="dirty" class="text-xs font-mono text-accent">unsaved</span>
        <button type="submit" :disabled="saving || uploading || !sha" class="shelf-primary ml-auto">{{ saving ? 'Saving…' : 'Save entry' }}</button>
      </div>
      <fieldset :disabled="saving || uploading" class="grid min-w-0 sm:grid-cols-[1fr_9rem] gap-6">
        <div class="space-y-5 min-w-0">
          <label class="shelf-field">Category
            <select v-model="form.type" class="shelf-input"><option v-for="(label, type) in types" :key="type" :value="type">{{ label }}</option></select>
          </label>
          <ShelfSearch :key="form.id" ref="catalogSearch" :type="form.type" @select="applyCatalog" />
          <label class="shelf-field">Title<input v-model="form.title.en" required maxlength="200" class="shelf-input" placeholder="Album, movie or show title" /></label>
          <label class="shelf-field">Chinese title (optional)<input v-model="form.title.zh" maxlength="200" class="shelf-input" /><span class="shelf-help">Falls back to the title above on the Chinese page.</span></label>
          <label class="shelf-field">Release year (optional)<input v-model="form.year" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" class="shelf-input" placeholder="2024" /></label>
          <template v-if="form.type === 'album'">
            <label class="shelf-field">Artist<input v-model="form.artist" required maxlength="200" class="shelf-input" /></label>
            <label class="shelf-field">MusicBrainz link or ID (optional)
              <input v-model="form.musicBrainzId" class="shelf-input" placeholder="https://musicbrainz.org/release/…" />
              <span class="shelf-help">Paste a release or release-group link. The cover preview loads automatically from Cover Art Archive.</span>
            </label>
            <label v-if="form.musicBrainzId && !form.musicBrainzId.includes('/')" class="shelf-field">ID type
              <select v-model="form.musicBrainzKind" class="shelf-input"><option value="release">Release (Picard's MusicBrainz Album ID)</option><option value="release-group">Release group (MusicBrainz Release Group ID)</option></select>
            </label>
            <a href="https://musicbrainz.org/search?type=release_group&method=indexed" target="_blank" rel="noopener noreferrer" class="inline-block text-sm text-accent">Find an album on MusicBrainz ↗</a>
          </template>
          <template v-else>
            <label class="shelf-field">Watching status
              <select v-model="form.status" class="shelf-input" @change="form.status === 'watching' && (form.watchedAt = '')">
                <option value="finished">Finished</option><option value="watching">In progress</option>
              </select>
            </label>
            <label class="shelf-field">IMDb link or ID<input v-model="form.imdbId" required class="shelf-input" placeholder="https://www.imdb.com/title/tt…/" /></label>
            <label class="shelf-field">Poster image URL (optional)
              <input v-model="form.posterUrl" type="url" class="shelf-input" placeholder="https://image.tmdb.org/t/p/w342/…jpg" />
              <span class="shelf-help">Paste the direct HTTPS image address, not a movie page. Images stay on their original host. Leave blank for a text placeholder.</span>
            </label>
            <label v-if="form.status !== 'watching'" class="shelf-field">Watched date (optional)<input v-model="form.watchedAt" type="date" class="shelf-input" /><span class="shelf-help">Leave blank if you don't remember.</span></label>
            <a href="https://www.themoviedb.org/search" target="_blank" rel="noopener noreferrer" class="inline-block text-sm text-accent">Find a poster on TMDB ↗</a>
          </template>
        </div>
        <div class="sm:pt-7 min-w-0">
          <div class="max-w-36"><ShelfArtwork :item="preview" :title="form.title.en" /></div>
          <fieldset class="mt-4 space-y-3">
            <legend class="text-xs font-mono text-muted mb-3">Cover artwork</legend>
            <label class="flex items-center gap-2 text-sm text-fg"><input v-model="form.artworkMode" type="radio" value="original" name="shelf-artwork" /> Original</label>
            <label class="flex items-center gap-2 text-sm text-fg"><input v-model="form.artworkMode" type="radio" value="custom" name="shelf-artwork" /> My image</label>
            <input ref="coverInput" type="file" accept="image/*" class="sr-only" aria-label="Upload custom cover" @change="uploadCover" />
            <button type="button" class="text-sm text-accent text-left" :disabled="uploading" @click="coverInput.click()">{{ uploading ? 'Uploading…' : form.customArtworkUrl ? 'Replace my image' : 'Upload my image' }}</button>
            <UploadProgress :progress="uploadState.progress" />
            <p class="shelf-help text-muted">Your image uploads to R2. Choosing Original keeps it available for later.</p>
          </fieldset>
        </div>
      </fieldset>
      <p class="text-xs text-muted border-t border-fg/10 pt-4">{{ localAdmin ? 'Saving updates src/content/shelf.json locally.' : 'Saving commits to main and rebuilds the site.' }} Unsaved edits are recovered on this device.</p>
    </form>
  </div>
</template>

<style scoped>
.shelf-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
.shelf-input { width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; border-radius: 6px; background: var(--color-surface); color: var(--color-fg); border: 1px solid color-mix(in srgb, var(--color-fg) 15%, transparent); font-size: 15px; }
.shelf-input:focus { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.shelf-help { font-size: 12px; line-height: 1.6; }
.shelf-primary { min-height: 38px; padding: 8px 16px; border-radius: 6px; background: var(--color-accent-strong); color: white; font-size: 14px; }
button:disabled { opacity: .5; }
</style>
