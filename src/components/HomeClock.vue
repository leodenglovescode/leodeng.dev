<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { estimateClockSample } from '../../lib/clock.js'

const { isZh, t } = useLocale('home')
const now = ref(null)
const localTimeZone = ref('UTC')
const synchronized = ref(false)
const roundTripMs = ref(null)
const lastSync = ref(null)
let anchor = null
let animation = null
let refreshTimer = null
let requestController = null
let stopped = false
let busy = false
let retryAt = 0
let reducedMotion = null

const formatter = computed(() => new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, hourCycle: 'h23',
}))
const displayedTime = computed(() => now.value == null ? '--:--:--.---' : formatter.value.format(now.value))
const localFormatter = computed(() => new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-GB', {
  timeZone: localTimeZone.value, hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, hourCycle: 'h23',
}))
const localOffsetFormatter = computed(() => new Intl.DateTimeFormat('en-GB', {
  timeZone: localTimeZone.value, timeZoneName: 'longOffset',
}))
const displayedLocalTime = computed(() => now.value == null ? '--:--:--.---' : localFormatter.value.format(now.value))
const localOffset = computed(() => {
  if (now.value == null) return ''
  const name = localOffsetFormatter.value.formatToParts(now.value)
    .find(part => part.type === 'timeZoneName')?.value || 'GMT'
  return name === 'GMT' ? 'UTC+00:00' : name.replace(/^GMT/, 'UTC')
})
const synchronizedAt = computed(() => lastSync.value == null ? '' : formatter.value.format(lastSync.value))

function fallback() {
  anchor = null
  synchronized.value = false
  roundTripMs.value = null
  lastSync.value = null
  now.value = Date.now()
}

function tick() {
  if (stopped || document.hidden) return
  now.value = anchor ? anchor.nowMs + performance.now() - anchor.monotonic : Date.now()
  animation = reducedMotion.matches ? setTimeout(tick, 1000) : requestAnimationFrame(tick)
}

function stopAnimation() {
  cancelAnimationFrame(animation)
  clearTimeout(animation)
}

function retryDelay(response) {
  const raw = response.headers.get('retry-after')
  if (!raw) return 60000
  const seconds = Number(raw)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(delay) ? Math.min(3600000, Math.max(60000, delay)) : 60000
}

async function synchronize() {
  if (busy || stopped || document.hidden || performance.now() < retryAt) return
  busy = true
  let best = null
  try {
    for (let i = 0; i < 3; i++) {
      requestController = new AbortController()
      const controller = requestController
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const startedAtMs = Date.now()
        const started = performance.now()
        const response = await fetch('/api/time', {
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        })
        if (!response.ok) {
          retryAt = performance.now() + retryDelay(response)
          throw new Error('Clock unavailable')
        }
        const body = await response.json()
        const received = performance.now()
        const sample = estimateClockSample(body, startedAtMs, received - started)
        if (!sample) throw new Error('Invalid clock sample')
        if (!best || sample.networkMs < best.networkMs) best = { ...sample, monotonic: received }
      } finally {
        clearTimeout(timeout)
      }
      if (stopped || document.hidden) return
    }
    anchor = best
    synchronized.value = true
    roundTripMs.value = Math.round(best.roundTripMs)
    lastSync.value = best.nowMs
  } catch {
    if (!stopped) fallback()
  } finally {
    busy = false
    requestController = null
  }
}

function visibilityChanged() {
  stopAnimation()
  if (document.hidden) {
    requestController?.abort()
    fallback()
  } else {
    tick()
    void synchronize()
  }
}

onMounted(() => {
  // Read the visitor's timezone, while both rows use the same corrected instant.
  // Resolve only in the browser so prerendering never adopts the build server's zone.
  localTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  fallback()
  tick()
  void synchronize()
  refreshTimer = setInterval(() => { void synchronize() }, 60000)
  document.addEventListener('visibilitychange', visibilityChanged)
})

onBeforeUnmount(() => {
  stopped = true
  stopAnimation()
  clearInterval(refreshTimer)
  requestController?.abort()
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <div class="text-muted text-sm font-mono mb-6">
    <p class="tabular-nums" aria-hidden="true">{{ t('clockYourTime') }}: {{ displayedLocalTime }} {{ localOffset }}</p>
    <p class="tabular-nums mt-1" aria-hidden="true">{{ t('clockLeoTime') }}: {{ displayedTime }} UTC+08:00</p>
    <p class="sr-only">{{ t('clockAccessible') }}</p>
    <p class="text-xs mt-1">{{ synchronized ? t('clockPiSource') : t('clockDeviceSource') }}</p>
    <details v-if="synchronized" class="text-xs mt-1">
      <summary class="cursor-pointer hover:text-fg">{{ t('clockDetails') }}</summary>
      <p class="mt-1">{{ t('clockRoundTrip', { p0: roundTripMs }) }}</p>
      <p>{{ t('clockLastSync', { p0: synchronizedAt }) }}</p>
      <p class="mt-1 max-w-sm">{{ t('clockPrecision') }}</p>
    </details>
  </div>
</template>
