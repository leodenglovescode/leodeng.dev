<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { getFile, putFile, putMedia, encodeBase64, localAdmin } from '../../utils/adminApi.js'
import { COMPRESSION, inspectGalleryPhoto, prepareGalleryPhoto, parseShutter } from '../../utils/galleryUpload.js'
import { GALLERY_PATH, validateGalleryManifest, validatePhotoMetadata } from '../../../lib/gallery-validation.js'

const emit = defineEmits(['dirty-change', 'busy-change'])
const clone = value => JSON.parse(JSON.stringify(value))
const manifest = ref(null), sha = ref(null), collection = ref(''), search = ref('')
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref(''), progress = ref('')
const collectionForm = ref(null)
const form = ref(null), originalSnapshot = ref(''), sourceFile = ref(null), preview = ref(''), prepared = ref(null)
const compression = ref('normal'), newTitle = ref(''), newSlug = ref('')
const RECOVERY = 'leodeng:admin:gallery-buffer'
const recovery = ref(null)
const dirty = computed(() => busy.value || !!form.value && JSON.stringify(form.value) !== originalSnapshot.value ||
  !!collectionForm.value && !!(collectionForm.value.title || collectionForm.value.slug))
const collections = computed(() => Object.keys(manifest.value?.collections ?? {}).sort())
const photos = computed(() => (manifest.value?.collections[collection.value] ?? []).filter(entry => {
  const text = `${entry.name} ${entry.metadata?.caption ?? ''} ${entry.camera ?? ''}`.toLowerCase()
  return text.includes(search.value.toLowerCase())
}))
const numbers = [{ key: 'focalLength', label: 'Focal length (mm)' }, { key: 'aperture', label: 'Aperture (f/)' }, { key: 'iso', label: 'ISO' }]
const strings = [{ key: 'caption', label: 'Caption' }, { key: 'make', label: 'Camera manufacturer' }, { key: 'camera', label: 'Camera model' }, { key: 'lens', label: 'Lens' }]
watch(dirty, value => emit('dirty-change', value), { immediate: true })
watch(busy, value => emit('busy-change', value), { immediate: true })
watch([form, collectionForm, newTitle, newSlug], () => {
  try {
    if (dirty.value && (form.value || collectionForm.value)) localStorage.setItem(RECOVERY, JSON.stringify({ form: form.value, collectionForm: collectionForm.value, newTitle: newTitle.value, newSlug: newSlug.value, snapshot: originalSnapshot.value, sha: sha.value }))
    else localStorage.removeItem(RECOVERY)
  } catch { /* Files stay on the device; metadata recovery is optional. */ }
}, { deep: true })
watch(compression, () => { prepared.value = null })
watch(() => form.value?.entry.kind, kind => { prepared.value = null; if (kind && kind !== 'photo') compression.value = 'original' })
onMounted(async () => {
  try { recovery.value = JSON.parse(localStorage.getItem(RECOVERY) || 'null') } catch { /* Optional. */ }
  await load()
})
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value); emit('dirty-change', false); emit('busy-change', false) })
function bytes(value) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${Math.round(value / 1024)} KB` }
function title(slug) { return manifest.value?.titles?.[slug] || slug }
function thumb(entry, slug = collection.value) {
  return entry.assets ? `${manifest.value.base}/${encodeURIComponent(entry.assets.thumb)}` : `${manifest.value.base}/${manifest.value.prefix}/${slug}/thumbs/${encodeURIComponent(entry.name)}.webp`
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const file = await getFile(GALLERY_PATH)
    if (!file) throw new Error('Gallery manifest not found.')
    manifest.value = validateGalleryManifest(JSON.parse(file.text)); sha.value = file.sha
    if (!manifest.value.collections[collection.value]) collection.value = Object.keys(manifest.value.collections)[0] || ''
  } catch (err) { error.value = err.message } finally { loading.value = false }
}
function reset() {
  collectionForm.value = null
  form.value = null; prepared.value = null; sourceFile.value = null; originalSnapshot.value = ''
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; recovery.value = null
  try { localStorage.removeItem(RECOVERY) } catch { /* Optional. */ }
}
function close() { if (!busy.value && (!dirty.value || confirm('Discard unsaved gallery changes?'))) reset() }
function startCollection() {
  if (busy.value || !manifest.value || dirty.value && !confirm('Discard unsaved gallery changes?')) return
  reset(); error.value = ''; notice.value = ''
  collectionForm.value = { title: '', slug: '', autoSlug: true }
}
function updateCollectionTitle(value) {
  collectionForm.value.title = value
  if (collectionForm.value.autoSlug) collectionForm.value.slug = value.normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
async function createCollection() {
  if (busy.value || !collectionForm.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const name = collectionForm.value.title.trim()
    const slug = collectionForm.value.slug.trim()
    if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Enter a title and a lowercase slug using letters, numbers, and hyphens.')
    if (Object.hasOwn(manifest.value.collections, slug)) throw new Error('That collection already exists. Choose a different slug.')
    const next = clone(manifest.value)
    next.collections[slug] = []; next.titles ||= {}; next.titles[slug] = name
    await commit(next, 'content: add gallery collection')
    collection.value = slug; search.value = ''; reset()
    notice.value = localAdmin.value ? 'Collection created locally. You can add photos now. Build and deploy to publish.' : 'Collection created. You can add photos now; the website will update after its build finishes.'
  } catch (err) { error.value = err.status === 409 ? 'The gallery changed elsewhere. Reload the gallery and try creating the collection again.' : err.message }
  finally { busy.value = false }
}
function metadata(entry) {
  const data = { ...entry, ...entry.metadata }
  return {
    caption: data.caption ?? '', capturedAt: data.shotAt?.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') ?? '',
    make: data.make ?? '', camera: data.camera ?? '', lens: data.lens ?? '', focalLength: data.focalLength ?? '',
    aperture: data.aperture ?? '', iso: data.iso ?? '', shutter: data.shutter ?? '',
    latitude: data.location?.latitude ?? '', longitude: data.location?.longitude ?? '',
  }
}
function edit(entry) {
  if (busy.value || dirty.value && !confirm('Discard unsaved gallery changes?')) return
  reset()
  form.value = { entry: clone(entry), origin: collection.value, target: collection.value, isNew: false, metadata: metadata(entry), staged: null }
  originalSnapshot.value = JSON.stringify(form.value)
  preview.value = ''
}
async function choose(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file || busy.value) return
  if (form.value?.isNew && !sourceFile.value && !form.value.staged) {
    busy.value = true; error.value = ''
    try {
      const entry = await inspectGalleryPhoto(file)
      form.value.entry = { ...entry, name: form.value.entry.name }
      sourceFile.value = file; preview.value = URL.createObjectURL(file)
    } catch (err) { error.value = err.message } finally { busy.value = false }
    return
  }
  if (dirty.value && !confirm('Discard unsaved gallery changes?')) return
  reset(); busy.value = true; error.value = ''; notice.value = ''; progress.value = 'Reading media…'
  try {
    const entry = await inspectGalleryPhoto(file)
    sourceFile.value = file; preview.value = URL.createObjectURL(file)
    form.value = { entry, origin: null, target: collection.value || '__new', isNew: true, metadata: metadata(entry), staged: null }
    originalSnapshot.value = ''
  } catch (err) { error.value = err.message } finally { busy.value = false; progress.value = '' }
}
async function prepare() {
  if (!sourceFile.value) throw new Error('Select the file again to prepare its upload.')
  progress.value = 'Preparing image copies…'
  const entry = { ...form.value.entry }
  if (entry.kind === 'photosphere' && !entry.panorama) {
    if (entry.width !== entry.height * 2) throw new Error('A complete photosphere must be a 2:1 image with a full spherical view.')
    entry.panorama = { fullWidth: entry.width, fullHeight: entry.height, width: entry.width, height: entry.height, left: 0, top: 0 }
  }
  if (entry.kind === 'photo') { delete entry.panorama; delete entry.original }
  prepared.value = await prepareGalleryPhoto(sourceFile.value, entry, compression.value)
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = URL.createObjectURL(prepared.value.jobs.find(job => job.key === prepared.value.entry.assets.full).blob)
}
async function previewCompression() {
  busy.value = true; error.value = ''
  try { await prepare() } catch (err) { error.value = err.message } finally { busy.value = false; progress.value = '' }
}
function overrides() {
  const m = form.value.metadata
  const data = { caption: m.caption.trim(), make: m.make.trim(), camera: m.camera.trim(), lens: m.lens.trim(),
    shotAt: m.capturedAt ? m.capturedAt.replace(/^(\d{4})-(\d{2})-(\d{2})T/, '$1:$2:$3 ') : null,
    shutter: parseShutter(m.shutter), location: null }
  if (data.shotAt?.length === 16) data.shotAt += ':00'
  for (const { key } of numbers) data[key] = m[key] === '' ? null : Number(m[key])
  if (m.latitude !== '' || m.longitude !== '') {
    if (m.latitude === '' || m.longitude === '') throw new Error('Enter both latitude and longitude, or clear both.')
    data.location = { latitude: Number(m.latitude), longitude: Number(m.longitude) }
  }
  return validatePhotoMetadata(data)
}
async function commit(next, message) {
  validateGalleryManifest(next)
  const result = await putFile({ path: GALLERY_PATH, sha: sha.value, base64: encodeBase64(JSON.stringify(next, null, 1) + '\n'), message })
  manifest.value = next; sha.value = result.content.sha
}
async function save() {
  if (busy.value || !form.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const data = overrides()
    const next = clone(manifest.value)
    let target = form.value.target
    if (target === '__new') {
      target = newSlug.value.trim()
      if (!/^[a-z0-9][a-z0-9-]*$/.test(target) || !newTitle.value.trim()) throw new Error('Enter a collection title and a lowercase slug using letters, numbers, and hyphens.')
      if (Object.hasOwn(next.collections, target)) throw new Error('That collection already exists. Select it from the list.')
      next.collections[target] = []; next.titles ||= {}; next.titles[target] = newTitle.value.trim()
    }
    if (!Object.hasOwn(next.collections, target)) throw new Error('Choose a collection.')
    let entry = clone(form.value.entry)
    if (form.value.isNew) {
      if (!form.value.staged) {
        if (!prepared.value) await prepare()
        const preparedPhoto = prepared.value
        for (let i = 0; i < preparedPhoto.jobs.length; i++) {
          const job = preparedPhoto.jobs[i]
          if (job.uploaded) continue
          await putMedia(job.key, job.blob, { onProgress: p => { progress.value = `Uploading ${i + 1}/${preparedPhoto.jobs.length}: ${Math.round(p.loaded / p.total * 100)}%` } })
          job.uploaded = true
        }
        form.value.staged = preparedPhoto.entry
      }
      entry = clone(form.value.staged)
    }
    entry.metadata = data
    if (!form.value.isNew) next.collections[form.value.origin] = next.collections[form.value.origin].filter(p => p.name !== entry.name)
    if (next.collections[target].some(p => p.name === entry.name)) throw new Error('This photo already exists in that collection.')
    next.collections[target].unshift(entry)
    progress.value = 'Saving gallery…'
    await commit(next, `content: ${form.value.isNew ? 'add gallery work' : 'update gallery metadata'}`)
    collection.value = target; reset()
    notice.value = localAdmin.value ? 'Saved to the local gallery. Build and deploy to publish.' : 'Gallery saved. The website will update after its build finishes.'
  } catch (err) {
    error.value = err.status === 409 ? 'The gallery changed elsewhere. Your form and uploaded files are kept. Reload the gallery, then save again.' : err.message
  } finally { busy.value = false; progress.value = '' }
}
async function remove(entry) {
  if (busy.value || dirty.value || !confirm('Remove this work from the gallery? Its uploaded files will remain in R2.')) return
  busy.value = true; error.value = ''
  try {
    const next = clone(manifest.value)
    next.collections[collection.value] = next.collections[collection.value].filter(p => p.name !== entry.name)
    next.featured = (next.featured ?? []).filter(item => item.collection !== collection.value || item.name !== entry.name)
    next.excluded ||= {}
    next.excluded[collection.value] = [...new Set([...(next.excluded[collection.value] || []), entry.name])]
    await commit(next, 'content: remove photo from gallery')
    notice.value = 'Work removed from the gallery.'
  } catch (err) { error.value = err.message } finally { busy.value = false }
}
function featuredIndex(entry, slug = collection.value) {
  return (manifest.value?.featured ?? []).findIndex(item => item.collection === slug && item.name === entry.name)
}
async function feature(entry, slug = collection.value, direction = 0) {
  if (busy.value || dirty.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const next = clone(manifest.value)
    next.featured ||= []
    const index = next.featured.findIndex(item => item.collection === slug && item.name === entry.name)
    if (direction) {
      const target = index + direction
      if (index < 0 || target < 0 || target >= next.featured.length) return
      ;[next.featured[index], next.featured[target]] = [next.featured[target], next.featured[index]]
    } else if (index >= 0) next.featured.splice(index, 1)
    else {
      if (next.featured.length >= 5) throw new Error('Five works are already featured. Unfeature one first.')
      next.featured.push({ collection: slug, name: entry.name })
    }
    await commit(next, 'content: update featured gallery works')
    notice.value = localAdmin.value ? 'Featured selection saved locally. Build and deploy to publish.' : 'Featured selection saved. The website will update after its build finishes.'
  } catch (err) { error.value = err.message } finally { busy.value = false }
}
function featuredCaption(item) {
  const entry = manifest.value.collections[item.collection]?.find(entry => entry.name === item.name)
  return entry?.metadata?.caption || entry?.caption || item.name
}
function restore() {
  form.value = recovery.value.form ?? null; collectionForm.value = recovery.value.collectionForm ?? null
  newTitle.value = recovery.value.newTitle || ''; newSlug.value = recovery.value.newSlug || ''
  originalSnapshot.value = recovery.value.snapshot || ''
  // Keep the current revision; a saved buffer must not silently overwrite a newer edit.
  if (recovery.value.sha !== sha.value) { error.value = 'The gallery changed since this buffer was saved. Review its metadata before saving.' }
  recovery.value = null
}
</script>

<template>
  <section class="gallery-manager">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <h2 class="text-lg font-semibold mr-auto">Gallery</h2>
      <button type="button" :disabled="busy" @click="load">Reload gallery</button>
      <button type="button" :disabled="busy || !manifest" @click="startCollection">New collection</button>
      <label class="upload-label" :class="{ disabled: busy }">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" class="sr-only" @change="choose" /></label>
      <label class="upload-label" :class="{ disabled: busy }">Add video<input type="file" accept="video/mp4,video/webm,.mp4,.webm" :disabled="busy" class="sr-only" @change="choose" /></label>
    </div>
    <p class="text-sm text-muted mb-5">Photos and videos are stored in R2. Metadata is saved with the gallery and appears on both versions of the site.</p>
    <p v-if="loading" role="status">Loading gallery…</p>
    <p v-if="error" role="alert" class="text-red-400 mb-4">{{ error }}</p>
    <p v-if="notice" role="status" class="text-accent mb-4">{{ notice }}</p>
    <p v-if="progress" role="status" class="text-sm text-muted mb-4">{{ progress }}</p>
    <div v-if="recovery && !form && !collectionForm" class="mb-4 border border-fg/15 p-3 rounded">
      Unsaved gallery changes are available. <button @click="restore">Restore</button>
      <button @click="reset">Discard</button>
    </div>
    <div v-if="manifest" class="border border-fg/15 rounded p-4 mb-6">
      <h3 class="font-semibold">Featured works ({{ manifest.featured?.length || 0 }}/5)</h3>
      <p class="text-sm text-muted my-2">Choose up to five photos or videos using Feature below. They appear first on the gallery page.</p>
      <ol v-if="manifest.featured?.length" class="space-y-2">
        <li v-for="(item, index) in manifest.featured" :key="`${item.collection}/${item.name}`" class="flex flex-wrap items-center gap-2">
          <span class="mr-auto">{{ index + 1 }}. {{ featuredCaption(item) }}</span>
          <button :disabled="busy || dirty || index === 0" @click="feature(item, item.collection, -1)">Move up</button>
          <button :disabled="busy || dirty || index === manifest.featured.length - 1" @click="feature(item, item.collection, 1)">Move down</button>
          <button :disabled="busy || dirty" @click="feature(item, item.collection)">Unfeature</button>
        </li>
      </ol>
    </div>
    <div v-if="manifest" class="flex flex-wrap gap-3 mb-5">
      <label>Browse collection<select v-model="collection"><option v-for="slug in collections" :key="slug" :value="slug">{{ title(slug) }} ({{ manifest.collections[slug].length }})</option></select></label>
      <label>Find works<input v-model="search" type="search" placeholder="Caption, filename, or camera" /></label>
    </div>
    <form v-if="collectionForm" class="gallery-form collection-form mb-8" @submit.prevent="createCollection">
      <h3 class="font-semibold mb-4">New collection</h3>
      <p class="text-sm text-muted mb-4">Create an empty collection, then add photos whenever you are ready.</p>
      <div class="fields">
        <label>Collection title<input :value="collectionForm.title" required maxlength="300" :disabled="busy" placeholder="Summer in Suzhou" @input="updateCollectionTitle($event.target.value)" /></label>
        <label>Collection slug<input v-model="collectionForm.slug" required pattern="[a-z0-9][a-z0-9-]*" :disabled="busy" placeholder="summer-in-suzhou" @input="collectionForm.autoSlug = false" /></label>
      </div>
      <p class="text-xs text-muted mt-3">Gallery address: /gallery/{{ collectionForm.slug || 'collection-slug' }}</p>
      <div class="flex gap-3 mt-4"><button type="submit" :disabled="busy">{{ busy ? 'Creating…' : 'Create collection' }}</button><button type="button" :disabled="busy" @click="close">Cancel</button></div>
    </form>
    <form v-if="form" class="gallery-form mb-8" @submit.prevent="save">
      <h3 class="font-semibold mb-4">{{ form.isNew ? 'Add work' : 'Edit metadata' }}</h3>
      <video v-if="form.entry.kind === 'video'" :key="preview || form.entry.name" :src="preview || (form.entry.assets ? `${manifest.base}/${form.entry.assets.full}` : undefined)" controls playsinline preload="metadata" class="max-h-52 max-w-full mb-4 rounded" />
      <img v-else :src="preview || thumb(form.staged || form.entry, form.origin)" alt="Selected photo preview" class="max-h-52 max-w-full object-contain mb-4 rounded" />
      <label>Collection<select v-model="form.target" :disabled="busy || !form.isNew"><option v-for="slug in collections" :key="slug" :value="slug">{{ title(slug) }}</option><option value="__new">New collection…</option></select></label>
      <div v-if="form.target === '__new'" class="fields"><label>Collection title<input v-model="newTitle" :disabled="busy" /></label><label>Collection slug<input v-model="newSlug" :disabled="busy" placeholder="summer-in-suzhou" /></label></div>
      <template v-if="form.isNew && !form.staged">
        <label v-if="form.entry.kind !== 'video'">Photo type<select v-model="form.entry.kind" :disabled="busy || form.entry.detectedKind !== 'photo'"><option value="photo">Photo</option><option value="panorama">Panorama</option><option value="photosphere">360° photosphere</option></select></label>
        <label v-if="form.entry.kind !== 'video'">Compression<select v-model="compression" :disabled="busy || form.entry.kind !== 'photo'"><option v-for="(preset, key) in COMPRESSION" :key="key" :value="key">{{ preset.label }}</option></select></label>
        <p class="text-sm text-muted my-3">{{ form.entry.kind === 'video' ? 'Video is uploaded unchanged, up to 95 MB. Use MP4 with H.264 for the widest device support. A poster and small previews are generated separately. Video metadata can be entered below.' : form.entry.kind !== 'photo' ? 'Panorama and photosphere originals are always uploaded unchanged. Only separate grid previews are resized.' : 'Original uploads the full photo unchanged. Normal uses up to 2200 px at 82% quality. Maximum uses up to 1600 px at 55% quality. Small previews and JPEG copies are prepared separately.' }}</p>
        <button type="button" :disabled="busy || !sourceFile" @click="previewCompression">Prepare and check size</button>
        <p v-if="prepared" class="text-sm mt-2">Full file: {{ bytes(prepared.fullBytes) }}. Total upload including previews: {{ bytes(prepared.totalBytes) }}.</p>
        <p v-if="!sourceFile" class="text-sm text-muted mt-2">Choose the file again to finish this upload. The metadata buffer has been restored.</p>
      </template>
      <p v-if="form.staged" class="text-sm text-accent my-3">Media files are uploaded. Saving again will reuse them.</p>
      <div class="fields mt-4">
        <label v-for="field in strings" :key="field.key">{{ field.label }}<input v-model="form.metadata[field.key]" :disabled="busy" /></label>
        <label>Captured at<input v-model="form.metadata.capturedAt" type="datetime-local" step="1" :disabled="busy" /></label>
        <label v-for="field in numbers" :key="field.key">{{ field.label }}<input v-model="form.metadata[field.key]" type="number" step="any" min="0" :disabled="busy" /></label>
        <label>Shutter speed (seconds or 1/125)<input v-model="form.metadata.shutter" :disabled="busy" /></label>
        <label>Latitude<input v-model="form.metadata.latitude" type="number" step="any" min="-90" max="90" :disabled="busy" /></label>
        <label>Longitude<input v-model="form.metadata.longitude" type="number" step="any" min="-180" max="180" :disabled="busy" /></label>
      </div>
      <p class="text-xs text-muted my-3">Metadata edits update the displayed photo details. Coordinates are published with this photo. Leave both blank to omit its location.</p>
      <div class="flex gap-3 mt-4"><button type="submit" :disabled="busy">{{ busy ? 'Saving…' : form.isNew ? 'Upload and publish work' : 'Save metadata' }}</button><button type="button" :disabled="busy" @click="close">Cancel</button></div>
    </form>
    <p v-if="manifest && collection && !photos.length && !loading" class="text-sm text-muted mb-5">{{ search ? 'No works match your search.' : 'This collection is empty. Choose Add photo or Add video to upload its first work.' }}</p>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <article v-for="photo in photos" :key="photo.name" class="border border-fg/10 rounded-lg overflow-hidden">
        <button type="button" class="photo-tile" :disabled="busy" @click="edit(photo)"><img :src="thumb(photo)" :alt="photo.metadata?.caption || photo.name" loading="lazy" class="aspect-square w-full object-cover" /></button>
        <div class="p-3"><p v-if="photo.kind === 'video'" class="text-xs text-accent mb-1">▶ Video</p><p class="text-xs break-all mb-2">{{ photo.metadata?.caption || photo.name }}</p><div class="flex flex-wrap gap-2"><button :disabled="busy" @click="edit(photo)">Edit</button><button :disabled="busy || dirty || (featuredIndex(photo) < 0 && manifest.featured?.length >= 5)" @click="feature(photo)">{{ featuredIndex(photo) >= 0 ? 'Unfeature' : 'Feature' }}</button><button :disabled="busy || dirty" @click="remove(photo)">Remove</button></div></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.gallery-manager button, .upload-label { border: 1px solid var(--color-muted); padding: 0.4rem 0.7rem; border-radius: 0.35rem; font-size: 13px; cursor: pointer; }
.gallery-manager button:disabled, .disabled { opacity: 0.45; cursor: default; }
.upload-label:focus-within { outline: 2px solid var(--color-accent); outline-offset: 2px; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 13px; }
input, select { width: 100%; color: var(--color-fg); background: var(--color-bg); border: 1px solid var(--color-muted); padding: 0.5rem; border-radius: 0.3rem; }
.gallery-form { border: 1px solid var(--color-muted); padding: 1rem; border-radius: 0.5rem; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.8rem; }
.gallery-manager .photo-tile { display: block; width: 100%; padding: 0; border: 0; }
</style>
