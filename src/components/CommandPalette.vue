<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '../utils/i18n.js'
import { useTheme } from '../utils/theme.js'
import { getAllPosts } from '../utils/posts.js'

const router = useRouter()
const { t, localePath } = useLocale('palette')
const { setTheme } = useTheme()
const dialog = ref(null)
const input = ref(null)
const query = ref('')
const selected = ref(0)
const opened = ref(false)
const shortcut = ref('Ctrl K')
let previousFocus, previousOverflow
const paths = ['/', '/about', '/projects', '/gallery', '/stack', '/blog', '/contact', '/now', '/spotting', '/homelab', '/tokens', '/time', '/ip', '/terminal', '/changelog', '/interests', '/pgp', '/feed']
const posts = getAllPosts()
const entries = computed(() => [
  ...paths.map(path => ({ id: path, label: t(`pages.${path === '/' ? 'home' : path.slice(1)}`), kind: t('page'), hint: path, search: path, path })),
  { id: 'light', label: t('light'), kind: t('action'), hint: '☀', search: 'theme light', theme: false },
  { id: 'dark', label: t('dark'), kind: t('action'), hint: '☾', search: 'theme dark', theme: true },
  ...posts.map(post => ({ id: `post:${post.slug}`, label: post.title, kind: t('post'), hint: post.displayDate, search: `${post.slug} ${post.description || ''}`, path: `/blog/${post.slug}` })),
])
const results = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.value.filter(item => terms.every(term => `${item.label} ${item.search} ${item.kind}`.toLocaleLowerCase().includes(term))).slice(0, 40)
})
watch(query, () => { selected.value = 0 })
watch(selected, async () => {
  await nextTick()
  dialog.value?.querySelector(`#command-${selected.value}`)?.scrollIntoView({ block: 'nearest' })
})
async function open() {
  if (opened.value) return
  previousFocus = document.activeElement
  previousOverflow = document.documentElement.style.overflow
  query.value = ''
  selected.value = 0
  dialog.value.showModal()
  opened.value = true
  document.documentElement.style.overflow = 'hidden'
  await nextTick()
  input.value?.focus()
}
function close() { dialog.value?.close() }
function closed() {
  if (!opened.value) return
  opened.value = false
  document.documentElement.style.overflow = previousOverflow
  if (previousFocus?.isConnected) previousFocus.focus()
}
function choose(item) {
  if (!item) return
  close()
  if (typeof item.theme === 'boolean') setTheme(item.theme)
  else void router.push(localePath(item.path))
}
function keys(event) {
  if (event.isComposing) return
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    const length = results.value.length
    selected.value = length ? (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length : 0
  } else if (event.key === 'Enter' && event.target === input.value) {
    event.preventDefault()
    choose(results.value[selected.value])
  }
}
function globalKeys(event) {
  if (event.defaultPrevented || event.isComposing || document.fullscreenElement) return
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (opened.value) close()
    else void open()
  }
}
function backdrop(event) {
  if (event.target !== dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
}
onMounted(() => {
  shortcut.value = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
  document.addEventListener('keydown', globalKeys)
})
onBeforeUnmount(() => {
  close()
  closed()
  document.removeEventListener('keydown', globalKeys)
})
</script>

<template>
  <button class="text-xs font-mono text-muted hover:text-accent flex items-center gap-2" aria-haspopup="dialog" @click="open">
    {{ t('search') }} <kbd class="border border-fg/15 rounded px-1.5 py-0.5 text-[10px]">{{ shortcut }}</kbd>
  </button>
  <dialog ref="dialog" class="command-dialog" :aria-label="t('title')" @close="closed" @click="backdrop" @keydown="keys">
    <div class="flex items-center gap-3 px-4 py-4 border-b border-fg/10">
      <span aria-hidden="true" class="text-accent">⌕</span>
      <input ref="input" v-model="query" role="combobox" :aria-label="t('search')" :aria-expanded="opened" aria-controls="command-results" :aria-activedescendant="results.length ? `command-${selected}` : undefined" aria-autocomplete="list" :placeholder="t('placeholder')" autocomplete="off" spellcheck="false" class="w-full min-w-0 bg-transparent text-fg text-sm outline-none" />
      <button class="text-xs font-mono text-muted border border-fg/15 rounded px-2 py-1 hover:text-fg" :aria-label="t('close')" @click="close">Esc</button>
    </div>
    <div id="command-results" role="listbox" :aria-label="t('results')" class="max-h-[55dvh] overflow-y-auto p-2">
      <button v-for="(item, index) in results" :id="`command-${index}`" :key="item.id" role="option" :aria-selected="selected === index" tabindex="-1" class="command-result" :class="{ selected: selected === index }" @pointermove="selected = index" @click="choose(item)">
        <span class="min-w-0"><span class="block text-sm break-words">{{ item.label }}</span><span class="block text-[11px] text-muted mt-1">{{ item.kind }}</span></span>
        <span class="text-xs font-mono text-muted shrink-0 max-w-[35%] truncate">{{ item.hint }}</span>
      </button>
      <p v-if="!results.length" class="text-sm text-muted p-5">{{ t('empty') }}</p>
    </div>
    <div class="px-4 py-3 border-t border-fg/10 text-[11px] text-muted font-mono">↑ ↓ {{ t('navigate') }} · Enter {{ t('select') }} · Esc {{ t('close') }}</div>
  </dialog>
</template>

<style scoped>
.command-dialog { width: min(580px, calc(100vw - 32px)); max-height: 85dvh; margin: 15dvh auto auto; padding: 0; border: 1px solid color-mix(in srgb, var(--color-fg) 15%, transparent); border-radius: 12px; background: var(--color-bg); color: var(--color-fg); box-shadow: 0 20px 80px #0005; }
.command-dialog::backdrop { background: #0008; backdrop-filter: blur(4px); }
.command-result { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; text-align: left; padding: 10px 12px; border-radius: 7px; }
.command-result.selected { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); }
</style>
