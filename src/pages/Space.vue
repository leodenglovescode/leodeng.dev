<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { spaceKeepsakes } from '../content/space.js'
import { useLocale } from '../utils/i18n.js'

const { t, localized } = useLocale('space')
const index = ref(0)
const item = computed(() => spaceKeepsakes[index.value])
const stage = ref(null)
const dialog = ref(null)
const failed = ref(false)
const reducedMotion = ref(false)
const pose = ref({ x: 0, y: 0 })
let motionQuery
let touchStart
const cardStyle = computed(() => ({
  '--rx': `${pose.value.x}deg`,
  '--ry': `${pose.value.y}deg`,
  '--light-x': `${50 + pose.value.y * 2}%`,
  '--light-y': `${50 - pose.value.x * 3}%`,
  '--ratio': `${item.value.width} / ${item.value.height}`,
  '--card-width': `${60 * item.value.width / item.value.height}vh`,
}))
const clamp = value => Math.max(-1, Math.min(1, value))
function center() { pose.value = { x: 0, y: 0 } }
function follow(event) {
  if (event.pointerType === 'touch' || reducedMotion.value) return
  const bounds = stage.value.getBoundingClientRect()
  // Absolute, clamped angles never accumulate into a spin or expose the back.
  pose.value = {
    x: -clamp((event.clientY - bounds.top) / bounds.height * 2 - 1) * 12,
    y: clamp((event.clientX - bounds.left) / bounds.width * 2 - 1) * 18,
  }
}
function change(step) {
  index.value = (index.value + step + spaceKeepsakes.length) % spaceKeepsakes.length
  failed.value = false
  center()
}
function keys(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('dialog')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    change(event.key === 'ArrowLeft' ? -1 : 1)
  }
}
function startTouch(event) {
  if (event.pointerType === 'touch') touchStart = { x: event.clientX, y: event.clientY }
}
function endTouch(event) {
  if (!touchStart || event.pointerType !== 'touch') return
  const dx = event.clientX - touchStart.x
  const dy = event.clientY - touchStart.y
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) change(dx < 0 ? 1 : -1)
  touchStart = null
}
function syncMotion() {
  reducedMotion.value = motionQuery.matches
  if (reducedMotion.value) center()
}
function closeBackdrop(event) {
  if (event.target === dialog.value) {
    const bounds = dialog.value.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.value.close()
  }
}
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMotion()
  motionQuery.addEventListener('change', syncMotion)
})
onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', syncMotion)
  dialog.value?.close()
})
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight text-fg mb-4">{{ t('title') }}</h1>
    <p class="text-[15px] text-muted leading-relaxed max-w-lg">{{ t('intro') }}</p>

    <div class="collection mt-9" role="region" aria-roledescription="carousel" :aria-label="t('collection')" tabindex="0" @keydown="keys">
      <div class="stage-top"><span>{{ localized(item.title) }}</span><span>{{ String(index + 1).padStart(2, '0') }} / {{ String(spaceKeepsakes.length).padStart(2, '0') }}</span></div>
      <div ref="stage" class="ticket-stage" @pointermove="follow" @pointerleave="center" @pointerdown="startTouch" @pointerup="endTouch" @pointercancel="touchStart = null; center()">
        <div class="orbit orbit-one" aria-hidden="true" />
        <div class="orbit orbit-two" aria-hidden="true" />
        <div :key="item.id" class="ticket" :style="cardStyle">
          <img :src="item.image" :alt="localized(item.alt)" :width="item.width" :height="item.height" draggable="false" @load="failed = false" @error="failed = true" />
          <div class="ticket-sheen" aria-hidden="true" />
        </div>
      </div>
      <div class="stage-bottom"><span class="pointer-hint">{{ t('tiltHint') }}</span><span class="touch-hint">{{ t('touchHint') }}</span></div>
    </div>

    <div v-if="spaceKeepsakes.length > 1" class="flex justify-center items-center gap-6 mt-5">
      <button type="button" class="browse" :aria-label="t('previous')" @click="change(-1)">←</button>
      <span class="text-xs font-mono text-muted">{{ index + 1 }} / {{ spaceKeepsakes.length }}</span>
      <button type="button" class="browse" :aria-label="t('next')" @click="change(1)">→</button>
    </div>
    <div aria-live="polite" aria-atomic="true" class="mt-8">
      <h2 class="text-2xl font-semibold text-fg mt-2">{{ localized(item.title) }}</h2>
      <p class="text-[15px] text-muted leading-relaxed mt-4 max-w-lg">{{ localized(item.note) }}</p>
    </div>
    <p v-if="failed" role="alert" class="text-sm text-muted mt-4">{{ t('imageError') }}</p>
    <button type="button" class="inspect mt-5" aria-haspopup="dialog" @click="dialog.showModal()">{{ t('inspect') }} <span aria-hidden="true">↗</span></button>

    <dialog ref="dialog" class="inspection" :aria-label="t('inspect')" @click="closeBackdrop">
      <div class="flex justify-between items-center gap-4 mb-4">
        <p class="text-sm font-mono">{{ localized(item.title) }}</p>
        <button type="button" class="inspect" autofocus @click="dialog.close()">{{ t('close') }} ×</button>
      </div>
      <img :src="item.image" :alt="localized(item.alt)" :width="item.width" :height="item.height" class="inspection-image" />
      <a :href="item.image" target="_blank" rel="noopener noreferrer" class="inspect inline-block mt-4">{{ t('original') }} ↗</a>
    </dialog>
  </section>
</template>

<style scoped>
.collection { border: 1px solid #d69a5140; border-radius: 18px; background: radial-gradient(ellipse at 50% 60%, #6f3c222e, transparent 70%), #100f15; color: #c3b4a4; overflow: hidden; }
.collection:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 5px; }
.stage-top, .stage-bottom { display: flex; justify-content: space-between; gap: 12px; padding: 20px 24px; font: 10px/1.5 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; }
.stage-top { border-bottom: 1px solid #ffffff0c; }
.stage-bottom { color: #b1a292; }
.ticket-stage { position: relative; display: grid; place-items: center; min-height: 300px; padding: 64px 36px; perspective: 1100px; touch-action: pan-y; isolation: isolate; background-image: radial-gradient(circle, #fff5 .7px, transparent 1px), radial-gradient(circle, #e9b76b4d .8px, transparent 1.2px); background-size: 91px 83px, 137px 127px; background-position: 12px 20px, 61px 47px; }
.orbit { position: absolute; z-index: -1; width: 80%; height: 70%; border: 1px solid #d49b5b15; border-radius: 50%; transform: rotate(-25deg); pointer-events: none; }
.orbit-two { width: 64%; height: 90%; transform: rotate(32deg); }
.ticket { position: relative; width: min(100%, 620px, var(--card-width)); aspect-ratio: var(--ratio); transform: rotateX(var(--rx)) rotateY(var(--ry)); transition: transform 180ms ease-out; border-radius: 5px; background: #9f7853; box-shadow: 0 1px #d3b291, 0 2px #856347, 0 3px #67472f, 0 4px #503725, 0 22px 42px #0009; backface-visibility: hidden; }
.ticket img { display: block; width: 100%; height: 100%; max-height: 60vh; object-fit: contain; border-radius: inherit; user-select: none; }
.ticket-sheen { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(ellipse at var(--light-x) var(--light-y), #fff3, transparent 65%); box-shadow: inset 0 0 0 1px #fff3; }
.browse { width: 44px; height: 44px; border: 1px solid color-mix(in srgb, var(--color-fg) 15%, transparent); border-radius: 50%; color: var(--color-fg); }
.browse:hover { border-color: var(--color-accent); color: var(--color-accent); }
.inspect { font-size: 13px; color: var(--color-accent); text-underline-offset: 4px; }
.inspect:hover { text-decoration: underline; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 5px; }
.inspection { margin: auto; width: min(1300px, calc(100vw - 32px)); max-height: 90dvh; overflow: auto; padding: 20px; border: 1px solid color-mix(in srgb, var(--color-fg) 15%, transparent); border-radius: 12px; background: var(--color-bg); color: var(--color-fg); }
.inspection::backdrop { background: #000c; }
.inspection-image { display: block; width: 100%; height: auto; max-height: 72dvh; object-fit: contain; }
.touch-hint { display: none; }
@media (pointer: coarse) { .pointer-hint { display: none; } .touch-hint { display: inline; } }
@media (max-width: 540px) { .ticket-stage { padding: 52px 23px; min-height: 230px; } .stage-top, .stage-bottom { padding: 16px; font-size: 9px; letter-spacing: .04em; } }
@media (prefers-reduced-motion: reduce) { .ticket { transform: none; transition: none; } .ticket-sheen { background: none; } }
</style>
