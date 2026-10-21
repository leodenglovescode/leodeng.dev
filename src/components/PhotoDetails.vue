<script setup>
import { computed } from 'vue'
import { useLocale } from '../utils/i18n.js'
const props = defineProps({ photo: { type: Object, required: true } })
const { t } = useLocale('gallery-collection')
const camera = computed(() => {
  const { make, camera } = props.photo
  return make && camera && !camera.toLowerCase().includes(make.toLowerCase()) ? `${make} ${camera}` : camera ?? make
})
const location = computed(() => {
  const { latitude, longitude } = props.photo.location ?? {}
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null
})
const coordinates = computed(() => location.value
  ? `${location.value.latitude.toFixed(6)}, ${location.value.longitude.toFixed(6)}` : '')
const mapUrl = computed(() => location.value
  ? `https://www.openstreetmap.org/?mlat=${location.value.latitude}&mlon=${location.value.longitude}#map=15/${location.value.latitude}/${location.value.longitude}` : '')
function exposure(value) {
  return value >= 1 ? `${Number(value.toFixed(2))} s` : `1/${Math.round(1 / value)} s`
}
</script>

<template>
  <details class="photo-details">
    <summary>{{ t('photoDetails') }}</summary>
    <div class="photo-details-body">
      <dl>
        <template v-if="photo.shotAt"><dt>{{ t('capturedAt') }}</dt><dd>{{ photo.shotAt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') }}</dd></template>
        <template v-if="camera"><dt>{{ t('camera') }}</dt><dd>{{ camera }}</dd></template>
        <template v-if="photo.lens"><dt>{{ t('lens') }}</dt><dd>{{ photo.lens }}</dd></template>
        <template v-if="photo.focalLength > 0"><dt>{{ t('focalLength') }}</dt><dd>{{ photo.focalLength }} mm</dd></template>
        <template v-if="photo.aperture > 0"><dt>{{ t('aperture') }}</dt><dd>f/{{ photo.aperture }}</dd></template>
        <template v-if="photo.shutter > 0"><dt>{{ t('shutter') }}</dt><dd>{{ exposure(photo.shutter) }}</dd></template>
        <template v-if="photo.iso > 0"><dt>ISO</dt><dd>{{ photo.iso }}</dd></template>
        <template v-if="photo.width && photo.height"><dt>{{ t('originalDimensions') }}</dt><dd>{{ photo.width }} × {{ photo.height }} px</dd></template>
        <template v-if="location"><dt>{{ t('coordinates') }}</dt><dd class="photo-coordinates">{{ coordinates }}<br /><a :href="mapUrl" target="_blank" rel="noopener noreferrer">{{ t('viewMap') }} ↗</a></dd></template>
      </dl>
      <p v-if="!location" class="location-unavailable">{{ t('locationUnavailable') }}</p>
    </div>
  </details>
</template>

<style scoped>
.photo-details { width: 100%; max-width: 42rem; margin: 0.65rem auto 0; color: #ffffffb3; font-size: 13px; text-align: left; }
summary { width: fit-content; margin: auto; padding: 0.25rem 0.5rem; cursor: pointer; }
summary:focus-visible, a:focus-visible { outline: 2px solid #4d9dff; outline-offset: 3px; }
.photo-details-body { max-height: min(25dvh, 14rem); overflow: auto; background: #161616; border: 1px solid #ffffff26; border-radius: 0.4rem; padding: 0.75rem; margin-top: 0.5rem; }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 1rem; }
dt { color: #ffffff80; } dd { margin: 0; overflow-wrap: anywhere; }
a { color: #8abaff; text-decoration: underline; }
.location-unavailable { margin-top: 0.4rem; color: #ffffff80; }
</style>
