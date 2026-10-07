<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { deleteMedia, encodeBase64, getFile, putFile, putMedia } from '../../utils/adminApi.js'

const PROJECTS_PATH = 'src/content/projects.json'
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const emit = defineEmits(['dirty-change'])

const projects = ref([])
const sha = ref(null)
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const notice = ref('')
const form = ref(null)
const pristine = ref('')
const pendingDeletes = ref([])
const fileInput = ref(null)

const snapshot = (value) => JSON.stringify(value)
const isDirty = computed(() => !!form.value && snapshot(form.value) !== pristine.value)
watch(isDirty, (dirty) => emit('dirty-change', dirty), { immediate: true })

function warnIfDirty(event) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  window.addEventListener('beforeunload', warnIfDirty)
  await load()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnIfDirty)
  emit('dirty-change', false)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const file = await getFile(PROJECTS_PATH)
    if (!file) throw new Error(`${PROJECTS_PATH} does not exist.`)
    const data = JSON.parse(file.text)
    if (!Array.isArray(data.projects)) throw new Error(`${PROJECTS_PATH} has no projects array.`)
    projects.value = data.projects
    sha.value = file.sha
  } catch (err) {
    error.value = err instanceof SyntaxError ? `${PROJECTS_PATH} contains invalid JSON.` : err.message
  } finally {
    loading.value = false
  }
}

function blankProject() {
  return {
    id: '',
    title: { en: '', zh: '' },
    description: { en: '', zh: '' },
    url: '',
    linkLabel: { en: 'website', zh: '网站' },
    tagsText: '',
    images: [],
    originalId: null,
    idTouched: false,
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function newProject() {
  if (isDirty.value && !confirm('Discard unsaved project changes?')) return
  form.value = blankProject()
  pristine.value = snapshot(form.value)
  pendingDeletes.value = []
  error.value = ''
  notice.value = ''
}

function editProject(project) {
  if (isDirty.value && !confirm('Discard unsaved project changes?')) return
  form.value = {
    id: project.id,
    title: { en: project.title?.en || '', zh: project.title?.zh || '' },
    description: { en: project.description?.en || '', zh: project.description?.zh || '' },
    url: project.url || '',
    linkLabel: {
      en: project.linkLabel?.en || (project.url ? 'website' : ''),
      zh: project.linkLabel?.zh || (project.url ? '网站' : ''),
    },
    tagsText: (project.tags || []).join(', '),
    images: (project.images || []).map((image) => ({
      url: image.url,
      objectName: image.objectName || '',
      alt: { en: image.alt?.en || '', zh: image.alt?.zh || '' },
    })),
    originalId: project.id,
    idTouched: true,
  }
  pristine.value = snapshot(form.value)
  pendingDeletes.value = []
  error.value = ''
  notice.value = ''
}

function closeEditor() {
  if (isDirty.value && !confirm('Discard unsaved project changes?')) return
  form.value = null
  pendingDeletes.value = []
  error.value = ''
}

function onEnglishTitle() {
  if (!form.value.idTouched) form.value.id = slugify(form.value.title.en)
}

function validate(project) {
  if (!project.id || !/^[a-z0-9][a-z0-9-]*$/.test(project.id)) {
    return 'ID is required and can only use lowercase letters, numbers and dashes.'
  }
  if (projects.value.some((item) => item.id === project.id && item.id !== project.originalId)) {
    return `A project with the ID "${project.id}" already exists.`
  }
  if (!project.title.en.trim() || !project.title.zh.trim()) return 'Add both English and Chinese titles.'
  if (!project.description.en.trim() || !project.description.zh.trim()) return 'Add both English and Chinese descriptions.'
  if (project.url) {
    try {
      const url = new URL(project.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      return 'Project URL must be a valid http or https URL.'
    }
  }
  return null
}

function cleanProject(project) {
  return {
    id: project.id.trim(),
    title: { en: project.title.en.trim(), zh: project.title.zh.trim() },
    description: { en: project.description.en.trim(), zh: project.description.zh.trim() },
    url: project.url.trim(),
    linkLabel: { en: project.linkLabel.en.trim(), zh: project.linkLabel.zh.trim() },
    tags: project.tagsText.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    images: project.images.map((image) => ({
      url: image.url,
      ...(image.objectName ? { objectName: image.objectName } : {}),
      alt: { en: image.alt.en.trim(), zh: image.alt.zh.trim() },
    })),
  }
}

async function commitProjects(nextProjects, message) {
  if (!sha.value) throw new Error('The projects file is not loaded. Reload the admin page and try again.')
  const result = await putFile({
    path: PROJECTS_PATH,
    base64: encodeBase64(`${JSON.stringify({ projects: nextProjects }, null, 2)}\n`),
    message,
    sha: sha.value,
  })
  projects.value = nextProjects
  sha.value = result.content.sha
}

async function saveProject() {
  if (saving.value) return
  const problem = validate(form.value)
  if (problem) {
    error.value = problem
    return
  }

  saving.value = true
  error.value = ''
  notice.value = ''
  const project = cleanProject(form.value)
  const index = projects.value.findIndex((item) => item.id === form.value.originalId)
  const nextProjects = [...projects.value]
  if (index === -1) nextProjects.push(project)
  else nextProjects.splice(index, 1, project)

  try {
    await commitProjects(
      nextProjects,
      `content: ${form.value.originalId ? 'update' : 'add'} project "${project.title.en}"`,
    )

    // Remove objects only after the committed project data no longer refers to
    // them. A failed delete leaves an orphan in R2, never a broken live image.
    const failedDeletes = []
    for (const name of pendingDeletes.value) {
      try {
        await deleteMedia(name)
      } catch {
        failedDeletes.push(name)
      }
    }

    form.value = null
    editProject(project)
    notice.value = failedDeletes.length
      ? `Project saved, but ${failedDeletes.length} unused R2 image${failedDeletes.length === 1 ? '' : 's'} could not be deleted.`
      : 'Project saved. Cloudflare Pages will rebuild in a minute or two.'
  } catch (err) {
    error.value = err.status === 409 || err.status === 422
      ? 'The projects file changed in the repo. Reload and reapply your edit.'
      : err.message
  } finally {
    saving.value = false
  }
}

async function removeProject(project) {
  if (!confirm(`Delete "${project.title?.en || project.id}"? Its R2 images will be kept until you delete them explicitly.`)) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await commitProjects(
      projects.value.filter((item) => item.id !== project.id),
      `content: delete project "${project.title?.en || project.id}"`,
    )
    notice.value = `Deleted "${project.title?.en || project.id}".`
  } catch (err) {
    error.value = err.status === 409 || err.status === 422
      ? 'The projects file changed in the repo. Reload and try again.'
      : err.message
  } finally {
    saving.value = false
  }
}

async function moveProject(index, direction) {
  const destination = index + direction
  if (destination < 0 || destination >= projects.value.length || saving.value) return
  const nextProjects = [...projects.value]
  const [project] = nextProjects.splice(index, 1)
  nextProjects.splice(destination, 0, project)
  saving.value = true
  error.value = ''
  try {
    await commitProjects(nextProjects, `content: reorder project "${project.title?.en || project.id}"`)
    notice.value = 'Project order updated.'
  } catch (err) {
    error.value = err.status === 409 || err.status === 422
      ? 'The projects file changed in the repo. Reload and try again.'
      : err.message
  } finally {
    saving.value = false
  }
}

function safeImageName(file) {
  const dot = file.name.lastIndexOf('.')
  const originalBase = dot > 0 ? file.name.slice(0, dot) : file.name
  const base = originalBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image'
  const ext = (dot > 0 ? file.name.slice(dot) : '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  const prefix = slugify(form.value.id || form.value.title.en || 'project') || 'project'
  return `project-${prefix}-${Date.now().toString(36)}-${base}${ext}`.slice(0, 128)
}

async function uploadImages(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`)
      if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than the 15 MB image limit.`)
      const name = safeImageName(file)
      const uploaded = await putMedia(name, file)
      form.value.images.push({
        url: uploaded.url,
        objectName: uploaded.name,
        alt: {
          en: `${form.value.title.en || 'Project'} screenshot`,
          zh: `${form.value.title.zh || '项目'}截图`,
        },
        isNew: true,
      })
    }
  } catch (err) {
    error.value = err.message
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function removeImage(image, index) {
  const destroysObject = !!image.objectName
  const message = destroysObject
    ? 'Remove this image from the project and delete it from R2 when you save? This cannot be undone after saving.'
    : 'Remove this image from the project? The legacy file itself will be kept.'
  if (!confirm(message)) return

  form.value.images.splice(index, 1)
  if (!image.objectName) return

  if (image.isNew) {
    try {
      await deleteMedia(image.objectName)
    } catch (err) {
      error.value = `The image was removed from the form, but its unused R2 object could not be deleted: ${err.message}`
    }
  } else {
    pendingDeletes.value.push(image.objectName)
  }
}
</script>

<template>
  <div>
    <p v-if="error" class="mb-5 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{{ error }}</p>
    <p v-if="notice" class="mb-5 text-sm text-accent bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">{{ notice }}</p>

    <p v-if="loading" class="text-sm text-muted font-mono">Loading projects…</p>

    <template v-else-if="!form">
      <div class="flex items-center justify-between gap-4 mb-6">
        <p class="text-sm text-muted">Projects appear on the public page in this order.</p>
        <button type="button" class="h-9 px-4 rounded-md bg-accent-strong text-white text-sm font-medium hover:brightness-110" @click="newProject">
          New project
        </button>
      </div>

      <p v-if="!projects.length" class="text-sm text-muted/90 italic py-10">No projects yet.</p>
      <ul v-else class="flex flex-col">
        <li v-for="(project, index) in projects" :key="project.id" class="group flex items-center gap-4 py-4 border-b border-fg/5">
          <img v-if="project.images?.[0]" :src="project.images[0].url" alt="" class="w-20 h-12 rounded object-cover border border-fg/8 shrink-0" />
          <button type="button" class="flex-1 min-w-0 text-left" @click="editProject(project)">
            <h3 class="text-fg font-semibold text-sm group-hover:text-accent transition-colors truncate">{{ project.title?.en || project.id }}</h3>
            <p class="text-xs text-muted mt-1 line-clamp-1">{{ project.title?.zh }} · {{ project.description?.en }}</p>
          </button>
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" :disabled="index === 0 || saving" class="text-xs text-muted hover:text-fg disabled:opacity-25" title="Move up" @click="moveProject(index, -1)">↑</button>
            <button type="button" :disabled="index === projects.length - 1 || saving" class="text-xs text-muted hover:text-fg disabled:opacity-25" title="Move down" @click="moveProject(index, 1)">↓</button>
            <a href="/projects" target="_blank" rel="noopener" class="text-xs text-muted/90 hover:text-fg no-underline">View</a>
            <button type="button" :disabled="saving" class="text-xs text-muted/90 hover:text-red-400" @click="removeProject(project)">Delete</button>
          </div>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex items-center gap-3 mb-6">
        <button type="button" class="text-sm font-mono text-muted hover:text-fg" @click="closeEditor">← Projects</button>
        <span v-if="isDirty" class="text-xs font-mono text-accent">unsaved</span>
        <button type="button" :disabled="saving || uploading" class="ml-auto h-9 px-4 rounded-md bg-accent-strong text-white text-sm font-medium hover:brightness-110 disabled:opacity-40" @click="saveProject">
          {{ saving ? 'Saving…' : 'Save project' }}
        </button>
      </div>

      <div class="grid gap-5">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-mono text-muted uppercase tracking-wider">Project ID</span>
          <input v-model="form.id" type="text" placeholder="my-project" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" @input="form.idTouched = true" />
          <span class="text-xs text-muted/90">Used as a stable key. Lowercase letters, numbers and dashes only.</span>
        </label>

        <div class="grid sm:grid-cols-2 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">English title</span>
            <input v-model="form.title.en" type="text" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" @input="onEnglishTitle" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">Chinese title</span>
            <input v-model="form.title.zh" type="text" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" />
          </label>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">English description</span>
            <textarea v-model="form.description.en" rows="5" class="px-3 py-2 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50 resize-y" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">Chinese description</span>
            <textarea v-model="form.description.zh" rows="5" class="px-3 py-2 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50 resize-y" />
          </label>
        </div>

        <div class="grid sm:grid-cols-[1fr_10rem_10rem] gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">Project URL</span>
            <input v-model="form.url" type="url" placeholder="https://…" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">English link label</span>
            <input v-model="form.linkLabel.en" type="text" placeholder="github" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-mono text-muted uppercase tracking-wider">Chinese link label</span>
            <input v-model="form.linkLabel.zh" type="text" placeholder="GitHub" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" />
          </label>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-mono text-muted uppercase tracking-wider">Tags</span>
          <input v-model="form.tagsText" type="text" placeholder="vue, vite, self-hosting" class="h-11 px-3 rounded-md bg-surface border border-fg/10 text-fg outline-none focus:border-accent/50" />
          <span class="text-xs text-muted/90">Comma-separated.</span>
        </label>

        <section class="pt-2">
          <div class="flex items-center justify-between gap-4 mb-3">
            <div>
              <h3 class="text-xs font-mono text-muted uppercase tracking-wider">Photos</h3>
              <p class="text-xs text-muted/90 mt-1">Uploads go to R2. You can add more than one image.</p>
            </div>
            <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="uploadImages($event.target.files)" />
            <button type="button" :disabled="uploading" class="h-9 px-3 rounded-md border border-fg/15 text-sm text-muted hover:text-fg disabled:opacity-40" @click="fileInput?.click()">
              {{ uploading ? 'Uploading…' : 'Upload photos' }}
            </button>
          </div>

          <div v-if="form.images.length" class="grid sm:grid-cols-2 gap-4">
            <div v-for="(image, index) in form.images" :key="`${image.url}-${index}`" class="rounded-lg border border-fg/10 overflow-hidden bg-surface">
              <img :src="image.url" :alt="image.alt.en" class="w-full aspect-video object-cover bg-fg/5" />
              <div class="p-3 grid gap-2">
                <input v-model="image.alt.en" type="text" placeholder="English alt text" class="h-9 px-2 rounded bg-bg border border-fg/10 text-sm text-fg outline-none focus:border-accent/50" />
                <input v-model="image.alt.zh" type="text" placeholder="中文替代文字" class="h-9 px-2 rounded bg-bg border border-fg/10 text-sm text-fg outline-none focus:border-accent/50" />
                <button type="button" class="justify-self-end text-xs text-muted hover:text-red-400" @click="removeImage(image, index)">
                  {{ image.objectName ? 'Delete photo' : 'Remove from project' }}
                </button>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-muted/90 italic py-6">No photos yet.</p>
        </section>
      </div>
    </template>
  </div>
</template>
