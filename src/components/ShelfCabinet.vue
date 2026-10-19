<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
import ShelfInspection from './ShelfInspection.vue'
import { shelfArtwork, shelfStatus } from '../utils/shelf.js'

const props = defineProps({ sections: { type: Array, required: true } })
const emit = defineEmits(['unsupported'])
const { t, localized } = useLocale('shelf')
const viewport = ref(null)
const columns = ref(24)
const selectedId = ref(null)
const failedImages = ref(new Set())
const angleX = ref(-6)
const angleY = ref(-12)
const dragging = ref(false)
const selected = computed(() => props.sections.flatMap(section => section.items).find(item => item.id === selectedId.value))
const rows = computed(() => props.sections.flatMap(section => {
  const result = []
  for (let i = 0; i < section.items.length; i += columns.value) {
    result.push({ key: `${section.key}-${i}`, label: section.label, first: i === 0, items: section.items.slice(i, i + columns.value) })
  }
  return result
}))
watch(selected, item => { if (!item) selectedId.value = null })

let observer, gesture = null, moved = false, suppressClick = false
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
function reset() { angleX.value = -6; angleY.value = -12; selectedId.value = null }
function pointerDown(event) {
  if (!event.isPrimary || event.button !== 0) return
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, angle: angleY.value }
  moved = false
  suppressClick = false
}
function pointerMove(event) {
  if (!gesture || event.pointerId !== gesture.id) return
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
  // Leave vertical gestures to normal page scrolling, including on phones.
  if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { gesture = null; return }
  if (!moved && Math.abs(dx) < 8) return
  moved = true
  dragging.value = true
  viewport.value?.setPointerCapture(event.pointerId)
  angleY.value = clamp(gesture.angle + dx * .14, -28, 28)
}
function pointerUp(event) {
  if (!gesture || event.pointerId !== gesture.id) return
  suppressClick = moved
  gesture = null
  dragging.value = false
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
}
function choose(item, event) {
  const skip = suppressClick && event.detail !== 0
  suppressClick = false
  if (skip) return
  selectedId.value = selectedId.value === item.id ? null : item.id
}
function spineHue(item) {
  return [...item.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0)
}
function failed(url) { failedImages.value = new Set([...failedImages.value, url]) }
function usableImage(item) {
  const url = shelfArtwork(item)
  return url && !failedImages.value.has(url) ? url : ''
}
function sceneKeys(event) {
  // Case buttons keep their normal Enter/Space behavior.
  if (event.key === 'Escape') { selectedId.value = null; return }
  if (event.target !== viewport.value) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    angleY.value = clamp(angleY.value + (event.key === 'ArrowLeft' ? -4 : 4), -28, 28)
  } else if (event.key === 'Home') { event.preventDefault(); reset() }
}
onMounted(() => {
  if (!CSS.supports('transform-style', 'preserve-3d')) { emit('unsupported'); return }
  observer = new ResizeObserver(([entry]) => { columns.value = Math.max(6, Math.min(30, Math.floor((entry.contentRect.width - 40) / 24))) })
  observer.observe(viewport.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="shelf-experience">
    <div class="shelf-controls">
      <p id="shelf-instructions">{{ t('instructions') }}</p>
      <div class="view-buttons" role="group" :aria-label="t('cameraControls')">
        <button type="button" :aria-label="t('turnLeft')" :disabled="angleY <= -28" @click="angleY = clamp(angleY - 6, -28, 28)">↶</button>
        <button type="button" :aria-label="t('resetView')" @click="reset">{{ t('reset') }}</button>
        <button type="button" :aria-label="t('turnRight')" :disabled="angleY >= 28" @click="angleY = clamp(angleY + 6, -28, 28)">↷</button>
      </div>
    </div>
    <div ref="viewport" class="cabinet-viewport" :class="{ dragging }" tabindex="0" role="region" :aria-label="t('cabinetLabel')" aria-describedby="shelf-instructions"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="dragging = false; gesture = null" @keydown="sceneKeys">
      <div :key="columns" class="cabinet" :style="{ '--view-x': `${angleX}deg`, '--view-y': `${angleY}deg` }">
        <div class="cabinet-back" aria-hidden="true" />
        <div class="cabinet-side cabinet-left" aria-hidden="true" />
        <div class="cabinet-side cabinet-right" aria-hidden="true" />
        <div class="cabinet-roof" aria-hidden="true" />
        <div class="cabinet-rail rail-left" aria-hidden="true" />
        <div class="cabinet-rail rail-right" aria-hidden="true" />
        <section v-for="row in rows" :key="row.key" class="cabinet-row" :class="{ 'album-row': row.items[0]?.type === 'album' }" :aria-label="t(row.label)">
          <div class="case-line">
            <button v-for="item in row.items" :key="item.id" type="button" class="case-slot" :style="{ '--spine-hue': spineHue(item) }" :class="{ album: item.type === 'album', picked: selectedId === item.id }"
              :aria-label="`${localized(item.title)}, ${item.type === 'album' ? item.artist || t('album') : t(shelfStatus(item) === 'watching' ? 'inProgress' : 'finished')}`"
              :aria-pressed="selectedId === item.id" @click="choose(item, $event)">
              <span class="media-case">
              <span class="case-face case-back" aria-hidden="true"><span class="back-lines" /></span>
              <span class="case-face case-spine" aria-hidden="true"><span>{{ localized(item.title) }}</span></span>
              <span class="case-face case-edge" aria-hidden="true" />
              <span class="case-face case-top" aria-hidden="true" />
              <span class="case-face case-bottom" aria-hidden="true" />
              <span class="case-face case-front" aria-hidden="true">
                <span v-if="item.type !== 'album'" class="case-format">{{ item.type === 'tv' ? t('tvCase') : t('movieCase') }}</span>
                <span class="case-cover">
                  <img v-if="usableImage(item)" :src="usableImage(item)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" @error="failed(shelfArtwork(item))" />
                  <span v-else class="cover-fallback"><span v-if="item.type === 'album'" class="record" /><span>{{ localized(item.title) }}</span></span>
                </span>
                <span class="case-gloss" />
              </span>
              </span>
            </button>
          </div>
          <div class="shelf-plank" aria-hidden="true">
            <span class="plank-top" /><span class="plank-front"><span v-if="row.first" class="shelf-plaque">{{ t(row.label) }}</span></span><span class="plank-bottom" />
          </div>
        </section>
        <div class="cabinet-foot" aria-hidden="true" />
      </div>
    </div>
    <p class="pick-prompt">{{ t('pickCase') }}</p>
    <ShelfInspection :item="selected || null" @close="selectedId = null" />
  </div>
</template>

<style scoped>
.shelf-experience { --wood-front: #70503a; --wood-edge: #a37a54; --wood-back: #35271e; --wood-side: #493222; }
.shelf-controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 4px; color: var(--color-muted); font-size: 12px; }
.view-buttons { display: flex; align-items: center; gap: 4px; }
.view-buttons button { min-width: 36px; min-height: 36px; padding: 6px 9px; border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent); border-radius: 5px; font-family: var(--font-mono); }
button:focus-visible, a:focus-visible, .cabinet-viewport:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 5px; }
.view-buttons button:hover { color: var(--color-fg); }
.view-buttons button:disabled { opacity: .3; }
.cabinet-viewport { container-type: inline-size; perspective: 1200px; perspective-origin: 50% 38%; padding: 40px 24px 44px; cursor: grab; touch-action: pan-y; position: relative; }
.cabinet-viewport.dragging { cursor: grabbing; }
.cabinet { --case-width: clamp(78px, 16cqw, 108px); --case-height: calc(var(--case-width) * 1.56); --case-depth: 16px; position: relative; padding: 22px 20px 12px; transform-style: preserve-3d; transform: rotateX(var(--view-x)) rotateY(var(--view-y)); transition: transform 180ms ease-out; }
.dragging .cabinet { transition: none; }
.cabinet-back { position: absolute; inset: 0; transform: translateZ(-110px); background: repeating-linear-gradient(91deg, #ffffff02 0 1px, transparent 1px 8px), linear-gradient(110deg, #413025, var(--wood-back) 45%, #211a15); box-shadow: inset 0 0 60px #0008, 12px 20px 40px #0003; }
.cabinet-side { position: absolute; top: 0; bottom: 0; width: 152px; background: repeating-linear-gradient(0deg, #ffffff04 0 1px, transparent 1px 11px), var(--wood-side); transform: translateZ(-34px) rotateY(90deg); }
.cabinet-left { left: -76px; }
.cabinet-right { right: -76px; }
.cabinet-roof { position: absolute; top: -76px; left: 0; right: 0; height: 152px; transform: translateZ(-34px) rotateX(90deg); background: var(--wood-edge); }
.cabinet-rail { position: absolute; top: 0; bottom: 0; width: 12px; transform: translateZ(28px); background: linear-gradient(90deg, #563d2c, #896447 40%, #5d412d); box-shadow: 1px 0 1px #0005; }
.rail-left { left: -6px; }.rail-right { right: -6px; }
.cabinet-row { position: relative; height: calc(var(--case-height) + 68px); transform-style: preserve-3d; }
.cabinet-row.album-row { height: calc(var(--case-width) + 68px); }
.case-line { position: absolute; inset: 0 0 24px; display: flex; align-items: flex-end; justify-content: flex-start; gap: 0; transform-style: preserve-3d; }
.case-slot { position: relative; flex: 0 0 24px; width: 24px; height: var(--case-height); transform-style: preserve-3d; cursor: pointer; -webkit-tap-highlight-color: transparent; }
/* A stationary hit surface keeps the hovered spine under the pointer while
   its case moves. Only these fixed surfaces take pointer input; moving
   covers and cabinet decoration never intercept adjacent spines. */
.case-slot::after { content: ''; position: absolute; inset: 0; transform: translateZ(20px); }
.case-slot.album { height: var(--case-width); }
.media-case { --plastic: #174c84; --plastic-light: #3b79ae; position: absolute; display: block; left: calc(12px - var(--case-width) / 2); bottom: 0; width: var(--case-width); height: var(--case-height); transform-style: preserve-3d; transform: translateZ(calc(20px - var(--case-width) / 2)) rotateY(90deg); transition: transform var(--case-motion, 180ms) ease-out; pointer-events: none; }
.album .media-case { --plastic: #888e94; --plastic-light: #d7dbdf; height: var(--case-width); --case-depth: 12px; }
.case-slot:focus-visible .media-case, .case-slot.picked .media-case { --case-motion: 260ms; transform: translateY(-6px) translateZ(120px) rotateY(-8deg); }
@media (hover: hover) and (pointer: fine) {
  .cabinet-viewport:not(.dragging) .case-slot:hover .media-case { --case-motion: 260ms; transform: translateY(-6px) translateZ(120px) rotateY(-8deg); }
}
.cabinet-back, .cabinet-side, .cabinet-roof, .cabinet-rail, .shelf-plank, .cabinet-foot { pointer-events: none; }
.case-face { position: absolute; display: block; backface-visibility: hidden; border-radius: 2px; }
.case-front, .case-back { inset: 0; }
.case-front { display: flex; flex-direction: column; padding: 3px; padding-top: 0; transform: translateZ(calc(var(--case-depth) / 2)); background: var(--plastic); box-shadow: 1px 2px 4px #0007; overflow: hidden; }
.case-format { height: 11px; flex: 0 0 11px; color: #e5eefb; text-align: center; font: italic 6px/11px sans-serif; letter-spacing: .18em; text-transform: uppercase; }
.case-cover { position: relative; display: block; flex: 1; min-height: 0; background: #171a20; overflow: hidden; }
.case-cover img { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none; }
.case-gloss { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, #fff2, transparent 25%, transparent 70%, #fff1); border: 1px solid #ffffff30; border-radius: 3px; }
.album .case-front { padding: 3px 3px 3px 9px; background: linear-gradient(90deg, #45484a 0 6px, #c1c5c8 6px 8px, #7e8489 8px); }
.case-back { transform: rotateY(180deg) translateZ(calc(var(--case-depth) / 2)); background: linear-gradient(145deg, #29303a, #111820); padding: 12px; }
.back-lines { display: block; height: 65%; margin-top: 20%; background: repeating-linear-gradient(0deg, #ffffff35 0 2px, transparent 2px 7px); }
.case-spine, .case-edge { top: 0; bottom: 0; width: var(--case-depth); background: var(--plastic); }
.case-spine { left: calc(var(--case-depth) / -2); transform: rotateY(-90deg); background: linear-gradient(90deg, #fff2, #0003), hsl(var(--spine-hue) 25% 24%); }
.case-spine span { position: absolute; inset: 7px 1px; writing-mode: vertical-rl; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 10px/14px var(--font-sans); color: #f2f4fa; }
.case-edge { right: calc(var(--case-depth) / -2); transform: rotateY(90deg); background: linear-gradient(90deg, #fff1, #0004), var(--plastic); }
.case-top, .case-bottom { left: 0; right: 0; height: var(--case-depth); background: var(--plastic-light); }
.case-top { top: calc(var(--case-depth) / -2); transform: rotateX(90deg); }
.case-bottom { bottom: calc(var(--case-depth) / -2); transform: rotateX(-90deg); background: var(--plastic); }
.cover-fallback { display: flex; align-items: center; justify-content: center; gap: 6px; flex-direction: column; height: 100%; padding: 8px; color: #ddd5c8; font: 600 11px/1.35 var(--font-sans); text-align: center; background: radial-gradient(ellipse at 20% 10%, #435163, #1c232c 75%); }
.record { display: block; width: 42px; height: 42px; border-radius: 50%; background: repeating-radial-gradient(circle, #202329 0 3px, #525963 3px 4px); border: 2px solid #9aa0a5; }
.shelf-plank { position: absolute; bottom: 12px; left: -20px; right: -20px; height: 12px; transform: translateZ(-34px); transform-style: preserve-3d; }
.plank-front { position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-start; padding-left: 14px; background: repeating-linear-gradient(0deg, #ffffff08 0 1px, transparent 1px 4px), linear-gradient(0deg, #553b29, var(--wood-front) 65%, #ab8059); transform: translateZ(76px); border-top: 1px solid #cfab7655; box-shadow: 0 12px 15px #0006; }
.plank-top, .plank-bottom { position: absolute; left: 0; right: 0; height: 152px; transform: rotateX(90deg); background: repeating-linear-gradient(90deg, #0000000a 0 1px, transparent 1px 6px), linear-gradient(0deg, var(--wood-front), #8e6c4f); }
.plank-top { top: -76px; }.plank-bottom { top: -64px; background: #39291e; }
.shelf-plaque { background: #211b15; border: 1px solid #b59a6655; color: #ead8b5; border-radius: 1px; padding: 3px 8px; font: 8px/1.1 var(--font-mono); letter-spacing: .05em; white-space: nowrap; }
.cabinet-foot { height: 14px; margin: 0 -20px -12px; transform: translateZ(16px); background: linear-gradient(0deg, #302319, #735238); }
.pick-prompt { border-top: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent); padding: 24px 0; font-size: 14px; color: var(--color-muted); }
@media (max-width: 499px) {
  .cabinet-viewport { padding: 28px 16px 30px; perspective: 950px; }
  .cabinet { --case-width: clamp(72px, 24cqw, 90px); padding: 18px 12px 10px; }
  .shelf-plank { left: -12px; right: -12px; }
  .cabinet-foot { margin-left: -12px; margin-right: -12px; }.shelf-plaque { font-size: 7px; padding: 3px 5px; }
}
@media (prefers-reduced-motion: reduce) { .cabinet, .media-case { transition: none; } }
</style>
