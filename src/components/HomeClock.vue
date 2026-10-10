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
const busy = ref(false)
const uncertaintyMs = ref(null)
const samples = ref(0)
const retrySeconds = ref(0)
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
// Device minus reference: positive means the device is ahead of GPS time.
const offset = computed(() => deviceOffsetMs.value == null ? null : -deviceOffsetMs.value)
const displayedOffset = computed(() => offset.value == null ? timeText('unavailable')
  : `${offset.value >= 0 ? '+' : ''}${Math.round(offset.value)} ms`)
const offsetStatus = computed(() => {
  if (offset.value == null) return timeText('unavailable')
  if (Math.abs(offset.value) <= uncertaintyMs.value) return timeText('withinUncertainty')
  return timeText(offset.value > 0 ? 'deviceAhead' : 'deviceBehind')
})
const meterRange = computed(() => Math.max(100, Math.ceil((Math.abs(offset.value || 0) + (uncertaintyMs.value || 0)) * 1.2 / 50) * 50))
const meterPosition = computed(() => 50 + (offset.value || 0) / meterRange.value * 50)
const meterBand = computed(() => ({ left: `${meterPosition.value - (uncertaintyMs.value || 0) / meterRange.value * 50}%`, width: `${(uncertaintyMs.value || 0) / meterRange.value * 100}%` }))
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
  uncertaintyMs.value = null
  samples.value = 0
  now.value = Date.now()
}

function tick() {
  if (stopped || document.hidden) return
  retrySeconds.value = Math.max(0, Math.ceil((retryAt - performance.now()) / 1000))
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
  if (busy.value || stopped || document.hidden || performance.now() < retryAt) return
  busy.value = true
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
    uncertaintyMs.value = best.networkMs / 2
    samples.value = 3
    retryAt = performance.now() + 10000
  } catch {
    retryAt = Math.max(retryAt, performance.now() + 60000)
    if (!stopped) fallback()
  } finally {
    busy.value = false
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
      <section class="rounded-xl border border-fg/10 bg-fg/[0.02] p-5 sm:p-7" aria-labelledby="offset-heading">
        <div class="flex flex-wrap justify-between gap-3 items-center">
          <h2 id="offset-heading" class="text-sm font-semibold">{{ timeText('meterTitle') }}</h2>
          <button class="text-xs font-mono text-accent disabled:text-muted" :disabled="busy || retrySeconds > 0" @click="synchronize">{{ busy ? timeText('syncing') : retrySeconds > 0 ? timeText('retryIn', { seconds: retrySeconds }) : timeText('syncNow') }}</button>
        </div>
        <p class="font-mono tabular-nums text-3xl sm:text-4xl mt-6" :class="synchronized ? 'text-accent' : 'text-muted'">{{ displayedOffset }}</p>
        <p class="text-xs text-muted mt-2" role="status">{{ offsetStatus }}</p>
        <div class="relative h-10 mt-6" aria-hidden="true">
          <div class="absolute top-4 inset-x-0 h-1 rounded bg-fg/10" />
          <div class="absolute top-1 bottom-1 left-1/2 w-px bg-fg/30" />
          <template v-if="synchronized">
            <div class="absolute top-2 h-5 rounded bg-accent/15 border border-accent/25 min-w-px" :style="meterBand" />
            <div class="absolute top-1 h-7 w-1 rounded bg-accent -translate-x-1/2" :style="{ left: `${meterPosition}%` }" />
          </template>
        </div>
        <div class="flex justify-between text-[11px] font-mono text-muted tabular-nums" aria-hidden="true"><span>−{{ meterRange }} ms</span><span>0</span><span>+{{ meterRange }} ms</span></div>
        <dl class="grid grid-cols-1 min-[400px]:grid-cols-3 gap-4 mt-6 pt-5 border-t border-fg/8">
          <div><dt class="text-xs text-muted mb-2">{{ timeText('roundTrip') }}</dt><dd class="font-mono text-sm">{{ roundTripMs == null ? timeText('unavailable') : `${roundTripMs} ms` }}</dd></div>
          <div><dt class="text-xs text-muted mb-2">{{ timeText('uncertainty') }}</dt><dd class="font-mono text-sm">{{ uncertaintyMs == null ? timeText('unavailable') : `±${Math.ceil(uncertaintyMs)} ms` }}</dd></div>
          <div><dt class="text-xs text-muted mb-2">{{ timeText('samples') }}</dt><dd class="font-mono text-sm">{{ samples ? `${samples} · ${timeText('lowestLatency')}` : timeText('unavailable') }}</dd></div>
        </dl>
        <p class="text-[11px] text-muted mt-5">{{ timeText('meterNote') }}</p>
      </section>
      <div class="rounded-xl border border-fg/8 p-5">
        <p class="flex items-start gap-2 text-sm font-mono">
          <span class="w-2 h-2 rounded-full mt-1.5 shrink-0" :class="synchronized ? 'bg-accent' : 'bg-highlight'" aria-hidden="true" />
          {{ synchronized ? t('clockPiSource') : t('clockDeviceSource') }}
        </p>
        <dl class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('lastSync') }}</dt>
            <dd class="font-mono tabular-nums">{{ lastSync == null ? timeText('unavailable') : `${synchronizedAt} UTC+08:00` }}</dd>
          </div>
          <div>
            <dt class="text-muted text-xs mb-1">{{ timeText('refresh') }}</dt>
            <dd>{{ timeText('refreshValue') }}</dd>
          </div>
        </dl>
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
