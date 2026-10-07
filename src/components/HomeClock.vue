<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { estimateClockSample } from '../../lib/clock.js'

defineProps({ expanded: Boolean })
const { isZh, t, localePath } = useLocale('home')
const { t: timeText } = useLocale('time')
const now = ref(null)
const localTimeZone = ref('UTC')
const synchronized = ref(false)
const roundTripMs = ref(null)
const lastSync = ref(null)
const deviceOffsetMs = ref(null)
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
const utcFormatter = computed(() => new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-GB', {
  timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, hourCycle: 'h23',
}))
const displayedUtc = computed(() => now.value == null ? '--:--:--.---' : utcFormatter.value.format(now.value))
const displayedOffset = computed(() => deviceOffsetMs.value == null ? timeText('unavailable')
  : `${deviceOffsetMs.value >= 0 ? '+' : ''}${Math.round(deviceOffsetMs.value)} ms`)
const dateFormatter = computed(() => new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-GB', {
  timeZone: localTimeZone.value, year: 'numeric', month: 'short', day: 'numeric',
}))
const localDate = computed(() => now.value == null ? '' : dateFormatter.value.format(now.value))

function fallback() {
  anchor = null
  synchronized.value = false
  roundTripMs.value = null
  lastSync.value = null
  deviceOffsetMs.value = null
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
    deviceOffsetMs.value = best.offsetMs
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
  <div :class="expanded ? 'space-y-6' : 'text-muted text-sm font-mono mb-6'">
    <template v-if="expanded">
      <div class="rounded-xl border border-accent/25 bg-accent/5 p-5 sm:p-7">
        <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">{{ t('clockYourTime') }}</p>
        <p class="text-3xl sm:text-5xl font-mono tabular-nums text-fg tracking-tight" aria-live="off">{{ displayedLocalTime }}</p>
        <p class="text-sm text-muted font-mono mt-3">{{ localTimeZone }} · {{ localOffset }}</p>
        <p class="text-xs text-muted mt-1">{{ localDate }}</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="rounded-xl border border-fg/8 p-5">
          <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">{{ t('clockLeoTime') }}</p>
          <p class="text-2xl font-mono tabular-nums text-fg" aria-live="off">{{ displayedTime }}</p>
          <p class="text-xs text-muted font-mono mt-2">Asia/Shanghai · UTC+08:00</p>
        </div>
        <div class="rounded-xl border border-fg/8 p-5">
          <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">UTC</p>
          <p class="text-2xl font-mono tabular-nums text-fg" aria-live="off">{{ displayedUtc }}</p>
          <p class="text-xs text-muted font-mono mt-2">UTC+00:00</p>
        </div>
      </div>
      <div class="rounded-xl border border-fg/8 p-5">
        <p class="flex items-start gap-2 text-sm font-mono">
          <span class="w-2 h-2 rounded-full mt-1.5 shrink-0" :class="synchronized ? 'bg-accent' : 'bg-highlight'" aria-hidden="true" />
          {{ synchronized ? t('clockPiSource') : t('clockDeviceSource') }}
        </p>
        <dl class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('roundTrip') }}</dt>
            <dd class="font-mono tabular-nums">{{ roundTripMs == null ? timeText('unavailable') : `${roundTripMs} ms` }}</dd>
          </div>
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('deviceOffset') }}</dt>
            <dd class="font-mono tabular-nums">{{ displayedOffset }}</dd>
          </div>
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('lastSync') }}</dt>
            <dd class="font-mono tabular-nums">{{ lastSync == null ? timeText('unavailable') : `${synchronizedAt} UTC+08:00` }}</dd>
          </div>
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('refresh') }}</dt>
            <dd>{{ timeText('refreshValue') }}</dd>
          </div>
        </dl>
        <p class="text-xs text-muted leading-relaxed mt-5">{{ timeText('offsetNote') }}</p>
      </div>
    </template>
    <template v-else>
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
      <RouterLink :to="localePath('/time')" class="inline-block text-xs mt-2 text-accent hover:text-fg transition-colors">{{ t('clockPage') }} →</RouterLink>
    </template>
  </div>
</template>
