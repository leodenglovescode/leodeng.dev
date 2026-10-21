<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import PhotoDetails from './PhotoDetails.vue'
import { useLocale } from '../utils/i18n.js'

const props = defineProps({ photo: { type: Object, required: true } })
const { t } = useLocale('gallery-collection')
const viewer = ref(null)
const fullscreen = ref(false)
const fullscreenFallback = ref(false)
const fullscreenButton = ref(null)
const surface = ref(null)
function syncFullscreen() {
  fullscreen.value = document.fullscreenElement === viewer.value || fullscreenFallback.value
  if (!fullscreen.value) fullscreenButton.value?.focus()
}
async function toggleFullscreen() {
  if (fullscreen.value) {
    if (document.fullscreenElement === viewer.value) await document.exitFullscreen()
    fullscreenFallback.value = false
    syncFullscreen()
  } else {
    try {
      if (!viewer.value.requestFullscreen || !document.fullscreenEnabled) throw new Error('Fullscreen unavailable')
      await viewer.value.requestFullscreen()
    } catch {
      fullscreenFallback.value = true
    }
    syncFullscreen()
  }
  await nextTick()
  fullscreenButton.value?.focus()
}
function fullscreenKey(event) {
  if (!fullscreen.value) return
  if (!flat.value && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) { key(event); return }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void toggleFullscreen()
  }
  if (event.key === 'Tab') {
    event.stopPropagation()
    const focusable = [...viewer.value.querySelectorAll('button, a[href], summary, [tabindex="0"]')]
      .filter(el => el.getClientRects().length)
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus() }
  }
}
const loading = ref(true)
const failed = ref(false)
const flat = ref(!props.photo.panorama)
let renderer, scene, camera, observer, image
let disposed = false
let longitude = 0, latitude = 0, fov = 65, maxFov = 90
const pointers = new Map()
let pinchDistance = null

function draw() {
  if (!renderer || !camera || disposed) return
  const p = props.photo.panorama
  if (p) {
    const top = 90 - p.top / p.fullHeight * 180
    const bottom = 90 - (p.top + p.height) / p.fullHeight * 180
    latitude = Math.max(bottom + fov / 2, Math.min(top - fov / 2, latitude))
    // Keep a partial horizontal capture inside its photographed region too.
    if (p.width < p.fullWidth) {
      const half = Math.atan(Math.tan(fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI
      const left = p.left / p.fullWidth * 360
      const right = (p.left + p.width) / p.fullWidth * 360
      longitude = Math.max(left + half, Math.min(right - half, longitude))
    }
  }
  const phi = (90 - latitude) * Math.PI / 180
  const theta = longitude * Math.PI / 180
  camera.fov = fov
  camera.updateProjectionMatrix()
  camera.lookAt(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
  renderer.render(scene, camera)
}
function zoom(delta) {
  fov = Math.max(Math.min(25, maxFov), Math.min(maxFov, fov + delta))
  draw()
}
function reset() {
  const p = props.photo.panorama
  longitude = p ? (p.left + p.width / 2) / p.fullWidth * 360 : 0
  latitude = p ? 90 - (p.top + p.height / 2) / p.fullHeight * 180 : 0
  fov = Math.min(65, maxFov)
  draw()
}
function down(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  surface.value.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
}
function move(e) {
  const previous = pointers.get(e.pointerId)
  if (!previous) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchDistance) zoom((pinchDistance - distance) * 0.15)
    pinchDistance = distance
  } else {
    longitude -= (e.clientX - previous.x) * fov / surface.value.clientHeight
    latitude += (e.clientY - previous.y) * fov / surface.value.clientHeight
    draw()
  }
}
function up(e) { pointers.delete(e.pointerId); pinchDistance = null }
function key(e) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'ArrowLeft') longitude -= 5
  if (e.key === 'ArrowRight') longitude += 5
  if (e.key === 'ArrowUp') latitude += 5
  if (e.key === 'ArrowDown') latitude -= 5
  if (e.key === '+' || e.key === '=') zoom(-5)
  if (e.key === '-') zoom(5)
  if (e.key === 'Home') reset()
  draw()
}
function release() {
  observer?.disconnect()
  scene?.traverse(object => {
    object.geometry?.dispose()
    if (object.material) {
      const canvas = object.material.map?.image
      object.material.map?.dispose()
      if (canvas instanceof HTMLCanvasElement) { canvas.width = 1; canvas.height = 1 }
      object.material.dispose()
    }
  })
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
  renderer = null
}
function showFlat() {
  flat.value = true
  release()
}
onMounted(async () => {
  document.addEventListener('fullscreenchange', syncFullscreen)
  if (flat.value) { loading.value = false; return }
  try {
    const THREE = await import('three')
    if (disposed) return
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.setAttribute('aria-hidden', 'true')
    surface.value.appendChild(renderer.domElement)
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100)
    image = new Image()
    image.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = props.photo.viewerSrc
    })
    if (disposed) return
    const p = props.photo.panorama
    // Native-resolution tiles avoid WebGL's texture-size downscaling on phones.
    const tileSize = Math.min(2048, renderer.capabilities.maxTextureSize)
    for (let y = 0; y < image.naturalHeight; y += tileSize) {
      for (let x = 0; x < image.naturalWidth; x += tileSize) {
        const width = Math.min(tileSize, image.naturalWidth - x)
        const height = Math.min(tileSize, image.naturalHeight - y)
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.generateMipmaps = false
        texture.minFilter = THREE.LinearFilter
        const geometry = new THREE.SphereGeometry(10, Math.max(8, Math.ceil(width / p.fullWidth * 192)),
          Math.max(4, Math.ceil(height / p.fullHeight * 96)),
          (p.left + x) / p.fullWidth * Math.PI * 2, width / p.fullWidth * Math.PI * 2,
          (p.top + y) / p.fullHeight * Math.PI, height / p.fullHeight * Math.PI)
        geometry.scale(-1, 1, 1)
        scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture })))
      }
    }
    maxFov = Math.min(90, p.height / p.fullHeight * 180 - 1)
    observer = new ResizeObserver(() => {
      if (!renderer) return
      const { clientWidth: width, clientHeight: height } = surface.value
      renderer.setSize(width, height)
      camera.aspect = width / height
      draw()
    })
    observer.observe(surface.value)
    reset()
    loading.value = false
    image = null
  } catch {
    if (disposed) return
    release()
    failed.value = true
    flat.value = true
    loading.value = false
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (document.fullscreenElement === viewer.value) void document.exitFullscreen().catch(() => {})
  disposed = true
  if (image) { image.onload = null; image.onerror = null; image.src = '' }
  release()
})
</script>

<template>
  <div ref="viewer" class="panorama-viewer" :class="{ 'is-fullscreen': fullscreen, 'fullscreen-fallback': fullscreenFallback }" @keydown="fullscreenKey">
    <div v-if="!flat" ref="surface" class="panorama-surface" tabindex="0" role="region"
      :aria-label="t('interactiveView')" :aria-describedby="'panorama-help'"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up"
      @wheel.prevent="zoom($event.deltaY * 0.04)" @keydown="key" @dblclick="reset" />
    <div v-else class="panorama-flat" tabindex="0" :aria-label="t('flatView')">
      <img :src="photo.fullSrc" :alt="photo.caption" />
    </div>
    <p v-if="loading" class="panorama-loading" role="status">{{ t('loadingView') }}</p>
    <p v-if="failed" class="text-sm text-white/70 mt-2" role="status">{{ t('viewerFallback') }}</p>
    <div class="viewer-controls flex flex-wrap items-center justify-center gap-3 mt-3 text-sm text-white/80">
      <button ref="fullscreenButton" type="button" class="viewer-button" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? t('exitFullscreen') : t('fullscreen') }} ⛶</button>
      <template v-if="!flat && !loading">
        <button type="button" class="viewer-button" :aria-label="t('zoomIn')" @click="zoom(-10)">+</button>
        <button type="button" class="viewer-button" :aria-label="t('zoomOut')" @click="zoom(10)">−</button>
        <button type="button" class="viewer-button" @click="reset">{{ t('resetView') }}</button>
        <button type="button" class="viewer-button" @click="showFlat">{{ t('flatView') }}</button>
      </template>
      <a :href="photo.fullSrc" target="_blank" rel="noopener" class="viewer-button">{{ t('openOriginal') }} ↗</a>
    </div>
    <PhotoDetails :photo="photo" />
    <p id="panorama-help" class="text-xs text-white/60 text-center mt-2">{{ flat ? t('flatHelp') : t('panoramaHelp') }}</p>
  </div>
</template>

<style scoped>
.panorama-viewer { position: relative; width: min(80vw, 1100px); }
.panorama-surface, .panorama-flat { width: 100%; height: min(65vh, 650px, max(120px, calc(100dvh - 230px))); border-radius: 0.5rem; background: #111; overflow: hidden; }
.panorama-viewer:fullscreen, .panorama-viewer.is-fullscreen { width: 100%; height: 100dvh; max-width: none; padding: 0.75rem; background: #080808; display: flex; flex-direction: column; box-sizing: border-box; overflow: auto; }
.panorama-viewer.fullscreen-fallback { position: fixed; inset: 0; z-index: 110; }
.is-fullscreen .panorama-surface, .is-fullscreen .panorama-flat { flex: 1 1 auto; min-height: 100px; height: auto; border-radius: 0; }
.is-fullscreen .viewer-controls, .is-fullscreen :deep(.photo-details), .is-fullscreen #panorama-help { flex-shrink: 0; }
.panorama-surface { touch-action: none; cursor: grab; }
.panorama-surface:active { cursor: grabbing; }
.panorama-surface:focus-visible, .panorama-flat:focus-visible, .viewer-button:focus-visible { outline: 2px solid #4d9dff; outline-offset: 3px; }
.panorama-flat { overflow: auto; }
.panorama-flat img { height: 100%; width: auto; max-width: none; display: block; }
.panorama-loading { position: absolute; top: 45%; width: 100%; text-align: center; color: white; }
.viewer-button { padding: 0.25rem 0.65rem; border: 1px solid #ffffff40; border-radius: 0.3rem; }
.viewer-button:hover { background: #ffffff18; }
</style>
