<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { STACK_ICON_NAMES, STACK_PATH, validateStack } from '../../../lib/stack-validation.js'
import { encodeBase64, getFile, localAdmin, putFile } from '../../utils/adminApi.js'
import StackTextField from './StackTextField.vue'

const emit = defineEmits(['dirty-change', 'busy-change'])
const data = ref(null)
const sha = ref(null)
const pristine = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const section = ref('hardware')
const dirty = computed(() => !!data.value && JSON.stringify(data.value) !== pristine.value)
watch(dirty, value => emit('dirty-change', value), { immediate: true })
watch(saving, value => emit('busy-change', value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const file = await getFile(STACK_PATH)
    if (!file) throw new Error('The stack file could not be found.')
    const next = validateStack(JSON.parse(file.text))
    data.value = next
    sha.value = file.sha
    pristine.value = JSON.stringify(next)
  } catch (err) { error.value = err.message }
  finally { loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { emit('dirty-change', false); emit('busy-change', false) })

const blankText = () => ({ en: '', zh: '' })
function addEntry() {
  const item = { name: blankText(), icon: section.value === 'hardware' ? 'desktop' : 'code', description: blankText(), rows: [] }
  if (section.value === 'hardware') { item.model = ''; item.group = 'computers' }
  else item.tags = []
  data.value[section.value].push(item)
}
function move(list, index, direction) {
  const target = index + direction
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}
function removeEntry(index) {
  const item = data.value[section.value][index]
  if (confirm(`Remove "${item.name.en || 'Untitled entry'}"? Save to apply this change.`)) data.value[section.value].splice(index, 1)
}
async function save() {
  if (saving.value || !data.value || !sha.value) return
  error.value = ''
  notice.value = ''
  try { validateStack(data.value) } catch (err) { error.value = err.message; return }
  saving.value = true
  try {
    const result = await putFile({ path: STACK_PATH, base64: encodeBase64(JSON.stringify(data.value, null, 2) + '\n'), sha: sha.value, message: 'content: update technology stack' })
    sha.value = result.content.sha
    pristine.value = JSON.stringify(data.value)
    notice.value = localAdmin.value ? 'Stack saved to the local file.' : 'Stack saved. Cloudflare Pages will rebuild in a minute or two.'
  } catch (err) {
    error.value = [409, 422].includes(err.status) ? 'The stack file changed. Copy your edits before reloading the admin page.' : err.message
  } finally { saving.value = false }
}
function reset() {
  if (!confirm('Discard unsaved stack changes?')) return
  data.value = JSON.parse(pristine.value)
  error.value = ''
  notice.value = ''
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h2 class="text-lg font-semibold">Technology stack</h2>
        <p class="text-sm text-muted">Edit devices, software, descriptions and details. Blank Chinese fields use English.</p>
      </div>
      <span v-if="dirty" class="text-xs text-accent">Unsaved changes</span>
      <button type="button" :disabled="!dirty || saving" class="stack-button" @click="reset">Discard changes</button>
      <button type="button" :disabled="!dirty || loading || saving" class="stack-button bg-accent-strong text-white" @click="save">{{ saving ? 'Saving…' : 'Save stack' }}</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-accent">{{ notice }}</p>
    <p v-if="loading" class="text-sm text-muted">Loading stack…</p>
    <button v-else-if="!data" type="button" class="stack-button" @click="load">Retry</button>
    <fieldset v-else :disabled="saving" class="space-y-4">
      <div class="flex gap-2 flex-wrap">
        <button v-for="key in ['hardware', 'software']" :key="key" type="button" class="stack-button capitalize" :aria-pressed="section === key" :class="section === key ? 'text-accent border-accent' : ''" @click="section = key">{{ key }} ({{ data[key].length }})</button>
        <button type="button" class="stack-button ml-auto" @click="addEntry">Add {{ section === 'hardware' ? 'device' : 'software group' }}</button>
      </div>
      <p class="text-xs text-muted">Entries appear in this order. Add detail rows for specs or software roles, and tags for software names.</p>
      <p v-if="!data[section].length" class="text-sm text-muted py-6">No entries yet.</p>
      <details v-for="(item, index) in data[section]" :key="`${section}-${index}`" class="rounded-lg border border-fg/10 p-4" :open="!item.name.en">
        <summary class="cursor-pointer font-medium">{{ item.model || item.name.en || 'New entry' }} <span class="text-xs text-muted ml-2">{{ item.name.en }}</span></summary>
        <div class="space-y-5 mt-5">
          <div class="flex flex-wrap gap-2">
            <button type="button" class="stack-button" :disabled="index === 0" @click="move(data[section], index, -1)">Move up</button>
            <button type="button" class="stack-button" :disabled="index === data[section].length - 1" @click="move(data[section], index, 1)">Move down</button>
            <button type="button" class="stack-button ml-auto" @click="removeEntry(index)">Remove entry</button>
          </div>
          <label v-if="section === 'hardware'" class="block text-sm text-muted">Display group
            <select :value="item.group || (['desktop', 'laptop', 'phone', 'cpu'].includes(item.icon) ? 'computers' : 'gear')" class="stack-input" @change="item.group = $event.target.value">
              <option value="computers">Computers and devices</option>
              <option value="gear">Camera, audio and everyday gear</option>
            </select>
          </label>
          <StackTextField v-model="item.name" :label="section === 'hardware' ? 'Device category' : 'Group name'" />
          <label v-if="section === 'hardware'" class="block text-sm text-muted">Model<input v-model="item.model" class="stack-input" /></label>
          <label class="block text-sm text-muted">Icon<select v-model="item.icon" class="stack-input"><option v-for="icon in STACK_ICON_NAMES" :key="icon" :value="icon">{{ icon }}</option></select></label>
          <StackTextField v-model="item.description" label="Description (optional)" />
          <div v-for="(row, rowIndex) in item.rows" :key="rowIndex" class="space-y-3 border-t border-fg/10 pt-4">
            <StackTextField v-model="row.label" label="Detail label (CPU, RAM, Lens, Hosting…)" />
            <StackTextField v-model="row.value" label="Detail value" />
            <div class="flex gap-2 flex-wrap">
              <button type="button" class="stack-button" :disabled="rowIndex === 0" @click="move(item.rows, rowIndex, -1)">Move detail up</button>
              <button type="button" class="stack-button" :disabled="rowIndex === item.rows.length - 1" @click="move(item.rows, rowIndex, 1)">Move detail down</button>
              <button type="button" class="stack-button" @click="item.rows.splice(rowIndex, 1)">Remove detail</button>
            </div>
          </div>
          <button type="button" class="stack-button" @click="item.rows.push({ label: blankText(), value: blankText() })">Add detail</button>
          <div v-if="section === 'software'" class="space-y-2">
            <label v-for="(_, tagIndex) in item.tags" :key="tagIndex" class="flex items-center gap-2 text-sm text-muted">Tag {{ tagIndex + 1 }}<input v-model="item.tags[tagIndex]" class="stack-input flex-1" /><button type="button" class="stack-button" @click="item.tags.splice(tagIndex, 1)">Remove tag</button></label>
            <button type="button" class="stack-button" @click="item.tags.push('')">Add tag</button>
          </div>
        </div>
      </details>
    </fieldset>
  </div>
</template>

<style scoped>
@reference '../../style.css';
.stack-button { @apply rounded-md border border-fg/15 px-3 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed; }
.stack-input { @apply mt-1 block w-full rounded-md border border-fg/15 bg-bg px-3 py-2 text-sm text-fg; }
</style>
