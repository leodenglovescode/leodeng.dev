<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'

const props = defineProps({ works: { type: Array, required: true } })
const { isZh, localePath } = useLocale('gallery')
const active = ref(0), paused = ref(false), hovered = ref(false), focused = ref(false), hidden = ref(false)
const rotating = computed(() => props.works.length > 1 && !paused.value && !hovered.value && !focused.value && !hidden.value)
let timer, motion
function visibility() { hidden.value = document.hidden }
function preference(event) { paused.value = event.matches }
function select(index) { active.value = index }
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  preference(motion); visibility()
  motion.addEventListener('change', preference)
  document.addEventListener('visibilitychange', visibility)
  timer = window.setInterval(() => { if (rotating.value) active.value = (active.value + 1) % props.works.length }, 1000)
})
onBeforeUnmount(() => {
  window.clearInterval(timer)
  motion?.removeEventListener('change', preference)
  document.removeEventListener('visibilitychange', visibility)
})
function focusOut(event) { focused.value = event.currentTarget.contains(event.relatedTarget) }
function image(work) { return work.kind === 'video' ? work.posterSrc || work.thumbSrc : work.kind === 'photo' ? work.fullSrc : work.thumbSrc }
</script>

<template>
  <section class="featured-hero mb-12" role="region" aria-roledescription="carousel" :aria-label="isZh ? '精选作品' : 'Featured works'" @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focused = true" @focusout="focusOut">
    <div class="hero-track" :style="{ transform: `translateX(-${active * 100}%)` }">
      <RouterLink v-for="(work, index) in works" :key="`${work.collection}/${work.sortKey}`" :to="localePath(work.href)" class="hero-slide" :tabindex="index === active ? 0 : -1" :aria-hidden="index !== active" role="group" aria-roledescription="slide" :aria-label="`${index + 1} / ${works.length}: ${work.caption}`">
        <img :src="image(work)" :alt="work.caption" :loading="index === 0 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'" />
        <div class="hero-shade"></div>
        <div class="hero-copy">
          <p class="hero-eyebrow">{{ isZh ? '精选作品' : 'Featured works' }}<span v-if="work.kind === 'video'"> · ▶ {{ isZh ? '视频' : 'Video' }}</span></p>
          <h3>{{ work.caption }}</h3>
          <p class="hero-collection">{{ work.collectionTitle }}</p>
        </div>
      </RouterLink>
    </div>
    <div v-if="works.length > 1" class="hero-controls">
      <div class="hero-dots" :aria-label="isZh ? '选择作品' : 'Choose a work'">
        <button v-for="(work, index) in works" :key="work.href" type="button" :aria-label="`${isZh ? '查看作品' : 'Show work'} ${index + 1}: ${work.caption}`" :aria-current="index === active ? 'true' : undefined" @click="select(index)"><span></span></button>
      </div>
      <button type="button" class="hero-pause" :aria-label="paused ? (isZh ? '播放幻灯片' : 'Play slideshow') : (isZh ? '暂停幻灯片' : 'Pause slideshow')" :aria-pressed="paused" @click="paused = !paused">{{ paused ? '▶' : 'Ⅱ' }}</button>
    </div>
  </section>
</template>

<style scoped>
.featured-hero { position: relative; width: 100%; overflow: hidden; border-radius: 0.85rem; background: #111; color: #fff; }
.hero-track { display: flex; transition: transform 450ms ease; }
.hero-slide { position: relative; flex: 0 0 100%; min-width: 0; height: clamp(24rem, 60vw, 34rem); overflow: hidden; }
.hero-slide img { width: 100%; height: 100%; object-fit: cover; }
.hero-shade { position: absolute; inset: 0; background: linear-gradient(180deg, #0000 25%, #0006 55%, #000d 100%); }
.hero-copy { position: absolute; bottom: 4.5rem; left: clamp(1.25rem, 4vw, 2.5rem); right: 1.25rem; text-shadow: 0 1px 10px #0008; }
.hero-eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #ffffffc9; margin-bottom: 0.65rem; }
.hero-copy h3 { font-size: clamp(1.5rem, 4vw, 2.6rem); line-height: 1.15; font-weight: 600; overflow-wrap: anywhere; }
.hero-collection { color: #ffffffbd; font-size: 14px; margin-top: 0.75rem; }
.hero-controls { position: absolute; bottom: 1rem; left: 1.25rem; right: 1.25rem; display: flex; align-items: center; justify-content: space-between; }
.hero-dots { display: flex; }
.hero-dots button, .hero-pause { display: grid; place-items: center; width: 40px; height: 40px; cursor: pointer; }
.hero-dots span { display: block; width: 7px; height: 7px; border-radius: 99px; background: #ffffff70; transition: width 200ms, background 200ms; }
.hero-dots [aria-current] span { width: 24px; background: #fff; }
.hero-pause { border: 1px solid #ffffff60; border-radius: 50%; background: #0004; font-size: 14px; }
button:focus-visible, .hero-slide:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
@media (prefers-reduced-motion: reduce) { .hero-track, .hero-dots span { transition: none; } }
</style>
