<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { searchShelf } from '../../utils/adminApi.js'
import { shelfArtwork } from '../../utils/shelf.js'

const props = defineProps({ type: { type: String, required: true } })
const emit = defineEmits(['select'])
const query = ref('')
const queryInput = ref(null)
defineExpose({ focus: () => queryInput.value?.focus() })
const artist = ref('')
const items = ref([])
const provider = ref('')
const busy = ref(false)
const searched = ref(false)
const error = ref('')
let revision = 0
watch(() => props.type, () => { revision++; items.value = []; error.value = ''; searched.value = false; busy.value = false })
onBeforeUnmount(() => revision++)
async function search() {
  if (busy.value || query.value.trim().length < 2) return
  const current = ++revision
  busy.value = true
  error.value = ''
  items.value = []
  searched.value = false
  try {
    const data = await searchShelf({ type: props.type, query: query.value.trim(), artist: props.type === 'album' ? artist.value.trim() : '' })
    if (current !== revision) return
    items.value = data.items
    provider.value = data.provider
    searched.value = true
  } catch (err) { if (current === revision) error.value = err.message }
  finally { if (current === revision) busy.value = false }
}
function choose(item) { emit('select', item); items.value = []; searched.value = false }
</script>

<template>
  <section class="rounded-lg border border-fg/15 bg-fg/[0.02] p-4" aria-label="Search media catalog" :aria-busy="busy">
    <div role="search" class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-2 text-xs text-muted flex-1 min-w-44">Search {{ type === 'album' ? 'albums' : type === 'tv' ? 'TV shows' : 'movies' }}
        <input ref="queryInput" v-model="query" type="search" maxlength="160" class="catalog-input" :placeholder="type === 'album' ? 'In Rainbows' : type === 'tv' ? 'Breaking Bad' : 'The Shawshank Redemption'" @keydown.enter.prevent="search" />
      </label>
      <label v-if="type === 'album'" class="flex flex-col gap-2 text-xs text-muted flex-1 min-w-36">Artist (optional)
        <input v-model="artist" maxlength="160" class="catalog-input" placeholder="Radiohead" @keydown.enter.prevent="search" />
      </label>
      <button type="button" :disabled="busy || query.trim().length < 2" class="catalog-search" @click="search">{{ busy ? 'Searching…' : 'Search' }}</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-400 mt-3">{{ error }}</p>
    <p v-else-if="searched && !items.length" role="status" class="text-sm text-muted mt-3">No results. Try another title, or fill in the fields below.</p>
    <template v-if="items.length">
      <p class="text-xs text-muted mt-3 mb-2">Select a result to fill in the fields. Results from {{ provider }}.</p>
      <ul class="grid gap-1 max-h-80 overflow-y-auto" aria-label="Search results">
        <li v-for="item in items" :key="item.catalogId">
          <button type="button" class="catalog-result" @click="choose(item)">
            <img v-if="shelfArtwork(item)" :src="shelfArtwork(item).replace('/front-500', '/front-250')" alt="" class="w-9 h-12 object-cover rounded-sm shrink-0 bg-fg/5" loading="lazy" referrerpolicy="no-referrer" @error="$event.target.style.visibility = 'hidden'" />
            <span class="min-w-0"><span class="block text-sm font-medium text-fg">{{ item.title.en }}</span><span class="block text-xs text-muted mt-1">{{ [item.artist, item.year, item.description].filter(Boolean).join(' · ') }}</span></span>
            <span class="ml-auto text-xs text-accent shrink-0">Select</span>
          </button>
        </li>
      </ul>
    </template>
    <p v-else-if="!busy && !searched && !error" class="text-xs text-muted mt-3">Search fills in available details and original artwork. You can also enter everything manually.</p>
  </section>
</template>

<style scoped>
.catalog-input { min-height: 44px; border: 1px solid color-mix(in srgb, var(--color-fg) 15%, transparent); border-radius: 5px; padding: 8px 12px; background: var(--color-bg); color: var(--color-fg); font-size: 14px; width: 100%; }
.catalog-search { min-height: 44px; border-radius: 5px; padding: 8px 18px; color: white; background: var(--color-accent-strong); font-size: 14px; }
.catalog-result { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px; border-radius: 5px; }
.catalog-result:hover { background: color-mix(in srgb, var(--color-fg) 6%, transparent); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
button:disabled { opacity: .5; }
</style>
