<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { shelfArtwork, shelfLink, shelfStatus } from '../utils/shelf.js'

const props = defineProps({ item: { type: Object, default: null } })
const emit = defineEmits(['close'])
const { t, localized } = useLocale('shelf')
const dialog = ref(null)
const opened = ref(false)
const imageFailed = ref(false)
let previousOverflow
function unlockScroll() {
  if (previousOverflow !== undefined) {
    document.body.style.overflow = previousOverflow
    previousOverflow = undefined
  }
}
function dismiss() { dialog.value?.close(); unlockScroll(); emit('close') }
watch(() => props.item, async item => {
  opened.value = false
  imageFailed.value = false
  await nextTick()
  if (item && !dialog.value.open) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.value.showModal()
  } else if (!item) {
    dialog.value?.close()
    unlockScroll()
  }
}, { flush: 'post' })
onBeforeUnmount(() => { dialog.value?.close(); unlockScroll() })
</script>

<template>
  <dialog ref="dialog" class="inspection-dialog" aria-labelledby="inspection-title" @cancel.prevent="dismiss" @click="event => { if (event.target === dialog) dismiss() }">
    <div v-if="item" class="inspection-content">
      <header>
        <p class="inspection-kicker">{{ item.type === 'album' ? t('album') : t(item.type === 'tv' ? 'tv' : 'movie') }}</p>
        <h2 id="inspection-title">{{ localized(item.title) }}</h2>
        <p class="inspection-meta">{{ [item.artist, item.year].filter(Boolean).join(' · ') }}</p>
      </header>
      <div class="inspection-stage" :class="{ 'is-open': opened, 'is-album': item.type === 'album' }">
        <div class="held-case">
          <div class="case-tray">
            <span class="case-disc" aria-hidden="true"><span>{{ localized(item.title) }}</span></span>
            <a v-if="opened && shelfLink(item)" class="inside-link" :href="shelfLink(item)" target="_blank" rel="noopener noreferrer" :aria-label="`${localized(item.title)}: IMDb`">IMDb ↗</a>
            <span v-else-if="opened" class="disc-artist">{{ item.artist }}</span>
          </div>
          <button type="button" class="held-cover" :aria-label="t(opened ? 'closeCase' : 'openCase')" :aria-expanded="opened" @click="opened = !opened">
            <span class="cover-outside">
              <span v-if="item.type !== 'album'" class="held-format">{{ t(item.type === 'tv' ? 'tvCase' : 'movieCase') }}</span>
              <img v-if="shelfArtwork(item) && !imageFailed" :src="shelfArtwork(item)" alt="" referrerpolicy="no-referrer" draggable="false" @error="imageFailed = true" />
              <span v-else class="held-fallback">{{ localized(item.title) }}</span>
            </span>
            <span class="cover-inside"><span>{{ localized(item.title) }}</span><span>{{ item.artist || t(shelfStatus(item) === 'watching' ? 'inProgress' : 'finished') }}</span></span>
          </button>
        </div>
      </div>
      <div class="inspection-actions">
        <button type="button" class="open-case" @click="opened = !opened">{{ t(opened ? 'closeCase' : 'openCase') }}</button>
        <button type="button" class="put-back" @click="dismiss">{{ t('putBack') }}</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.inspection-dialog { position: fixed; inset: 0; margin: auto; width: min(760px, 100%); max-width: 100%; max-height: 100dvh; padding: 32px 20px; overflow: auto; border: 0; background: transparent; color: #f5f2ea; }
.inspection-dialog::backdrop { background: #080a10e8; backdrop-filter: blur(7px); }
.inspection-content { text-align: center; }
.inspection-kicker { font: 11px var(--font-mono); text-transform: uppercase; letter-spacing: .16em; color: #b5b2ae; }
h2 { margin: 8px 0 4px; font-size: clamp(20px, 4vw, 28px); font-weight: 600; }
.inspection-meta { font-size: 14px; color: #b5b2ae; min-height: 22px; }
.inspection-stage { --held-width: min(220px, 39vw); --held-height: calc(var(--held-width) * 1.5); --case-color: #1c4c7d; perspective: 1400px; padding: 40px 0 44px; }
.inspection-stage.is-album { --held-height: var(--held-width); --case-color: #747c83; }
.held-case { position: relative; width: var(--held-width); height: var(--held-height); margin: auto; transform-style: preserve-3d; transform: rotateX(4deg) rotateY(-10deg); transition: transform 650ms cubic-bezier(.2,.7,.2,1); }
.is-open .held-case { transform: translateX(calc(var(--held-width) * .45)) rotateX(4deg) rotateY(-5deg); }
.case-tray { position: absolute; inset: 0; border: 6px solid var(--case-color); border-radius: 5px; background: linear-gradient(115deg, #242c38, #0e131c); box-shadow: 7px 3px 0 color-mix(in srgb, var(--case-color) 70%, #000), 9px 16px 28px #0009, inset 0 0 0 2px #ffffff24; }
.case-disc { position: absolute; width: 88%; aspect-ratio: 1; left: 6%; top: 12%; display: grid; place-items: center; border-radius: 50%; border: 1px solid #b4bfca; background: radial-gradient(circle, #18212c 0 7%, #b8b9b6 7.5% 10%, transparent 10.5%), conic-gradient(#738997, #d3d9d3, #77899b, #b9a3c5, #8fae9c, #e2d8c5, #738997); box-shadow: 0 3px 10px #0008; }
.case-disc span { margin-top: 39%; width: 70%; font: 600 clamp(8px, 2vw, 11px)/1.2 var(--font-sans); color: #26313d; }
.is-album .case-disc { top: 6%; }
.inside-link, .disc-artist { position: absolute; left: 10%; right: 10%; bottom: 9%; font: 600 14px var(--font-mono); }
.inside-link { padding: 10px 4px; background: #dbe7f0; color: #142e4c; border-radius: 3px; box-shadow: 0 2px 5px #0006; }
.disc-artist { bottom: 8%; font-size: 10px; color: #23303d; background: #dce1e7cc; padding: 3px; border-radius: 2px; }
.held-cover { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: left center; transform: translateZ(9px) rotateY(0deg); transition: transform 750ms cubic-bezier(.2,.7,.2,1); border-radius: 4px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.is-open .held-cover { transform: translateZ(9px) rotateY(-165deg); }
.cover-outside, .cover-inside { position: absolute; inset: 0; display: flex; flex-direction: column; border: 5px solid var(--case-color); border-radius: 4px; backface-visibility: hidden; background: var(--case-color); box-shadow: inset 0 0 0 1px #fff3, 2px 3px 8px #0006; overflow: hidden; }
.cover-outside { transform: translateZ(1px); }
.cover-outside::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, #fff3, transparent 32%, transparent 70%, #fff1); }
.held-format { flex: 0 0 17px; font: italic 8px/17px sans-serif; letter-spacing: .2em; text-transform: uppercase; }
.cover-outside img { width: 100%; flex: 1; min-height: 0; object-fit: cover; }
.is-album .cover-outside { border-left-width: 12px; }
.held-fallback { display: grid; place-items: center; flex: 1; padding: 12px; background: linear-gradient(140deg, #435163, #151c24); }
.cover-inside { transform: rotateY(180deg) translateZ(1px); justify-content: center; gap: 16px; padding: 16px; color: #cdc8bc; background: repeating-linear-gradient(0deg, #ffffff03 0 1px, transparent 1px 5px), #19232f; }
.cover-inside span:first-child { font: 600 clamp(12px, 3vw, 20px)/1.3 var(--font-sans); }
.cover-inside span:last-child { font: 10px var(--font-mono); color: #929ca7; }
.inspection-actions { display: flex; justify-content: center; align-items: center; gap: 24px; font-size: 14px; }
.open-case { border: 1px solid #ffffff45; border-radius: 5px; padding: 10px 18px; background: #ffffff0d; }
.put-back { padding: 10px 4px; color: #bbbfc6; }
button:focus-visible, a:focus-visible { outline: 2px solid #8ebfff; outline-offset: 5px; }
@media (max-height: 600px) { .inspection-dialog { padding-top: 16px; padding-bottom: 16px; }.inspection-stage { --held-width: min(160px, 32vw); padding: 24px 0; } }
@media (prefers-reduced-motion: reduce) { .held-case, .held-cover { transition: none; } }
</style>
