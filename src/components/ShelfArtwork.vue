<script setup>
import { computed, ref, watch } from 'vue'
import { shelfArtwork } from '../utils/shelf.js'

const props = defineProps({ item: { type: Object, required: true }, title: { type: String, default: '' } })
const source = computed(() => shelfArtwork(props.item))
const failed = ref(false)
watch(source, () => { failed.value = false })
</script>

<template>
  <div class="shelf-artwork" :class="{ 'shelf-album': item.type === 'album' }">
    <img v-if="source && !failed" :key="source" :src="source" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
    <div v-else class="shelf-placeholder" aria-hidden="true">
      <svg v-if="item.type === 'album'" viewBox="0 0 100 100" fill="none" class="w-3/4 text-fg/10">
        <circle cx="50" cy="50" r="43" stroke="currentColor" stroke-width="1.5" />
        <circle cx="50" cy="50" r="35" stroke="currentColor" />
        <circle cx="50" cy="50" r="27" stroke="currentColor" />
        <circle cx="50" cy="50" r="13" fill="currentColor" />
        <circle cx="50" cy="50" r="3" fill="var(--color-bg)" />
      </svg>
      <span v-else class="font-mono text-4xl text-fg/15">{{ (title || item.title?.en || '?').slice(0, 1) }}</span>
    </div>
  </div>
</template>

<style scoped>
.shelf-artwork { aspect-ratio: 2 / 3; overflow: hidden; border-radius: 4px; background: var(--color-surface); border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent); box-shadow: 0 5px 14px #0002; }
.shelf-album { aspect-ratio: 1; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }
.shelf-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; background: linear-gradient(135deg, color-mix(in srgb, var(--color-fg) 4%, transparent), transparent); }
</style>
