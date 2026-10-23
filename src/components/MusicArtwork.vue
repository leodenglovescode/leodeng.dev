<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { musicArtwork } from '../utils/musicArtwork.js'
const props = defineProps({ kind:String, name:String, artist:{type:String,default:''} })
const artwork=ref(null), failed=ref(false), visible=ref(false), element=ref(null)
const initial=computed(() => (props.name || '?').slice(0,1).toUpperCase())
let observer, generation=0
async function load() {
  if (!visible.value) return
  const current=++generation
  artwork.value=null;failed.value=false
  const result=await musicArtwork(props.kind,props.name,props.artist)
  if(current===generation) artwork.value=result
}
watch(() => [props.kind,props.name,props.artist],load)
onMounted(() => {
  if ('IntersectionObserver' in window) {
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){visible.value=true;observer.disconnect();void load()}},{rootMargin:'100px'})
    observer.observe(element.value)
  } else {visible.value=true;void load()}
})
onBeforeUnmount(()=>{generation++;observer?.disconnect()})
</script>
<template>
  <span ref="element" class="music-artwork" :class="{ 'artist-photo':kind === 'artists' }">
    <a v-if="artwork && !failed" :href="artwork.source" target="_blank" rel="noopener noreferrer" :aria-label="`${name}: artwork from ${artwork.provider}`" :title="`Artwork: ${artwork.provider}`">
      <img :src="artwork.image" alt="" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed=true">
    </a>
    <span v-else class="artwork-placeholder" aria-hidden="true">{{ initial }}</span>
  </span>
</template>
<style scoped>
.music-artwork { display:block; flex:none; width:48px; height:48px; border-radius:5px; overflow:hidden; background:color-mix(in srgb,var(--color-fg) 7%,transparent); }
.music-artwork a { display:block; width:100%; height:100%; }
.music-artwork img { width:100%; height:100%; object-fit:cover; }
.artist-photo { border-radius:50%; }
.artwork-placeholder { display:flex; align-items:center; justify-content:center; width:100%; height:100%; font:500 19px var(--font-mono); color:var(--color-muted); }
</style>
