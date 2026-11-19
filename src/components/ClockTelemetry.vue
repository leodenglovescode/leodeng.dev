<script setup>
import { computed } from 'vue'
import { useLocale } from '../utils/i18n.js'
import ClockStability from './ClockStability.vue'

const props = defineProps({
  synchronized: Boolean,
  satellites: { type: Object, default: null },
  diagnostics: { type: Object, default: () => ({}) },
  history: { type: Array, default: () => [] },
  elapsedSeconds: { type: Number, default: 0 },
  stability: { type: Object, default: null },
  nowMs: { type: Number, default: null },
})
const { t, isZh } = useLocale('time')
const receiver = computed(() => props.diagnostics.receiver || {})
const tracking = computed(() => props.diagnostics.tracking || {})
const absent = computed(() => t('noMeasurement'))
const format = (value, digits = 2) => value == null ? absent.value
  : new Intl.NumberFormat(isZh.value ? 'zh-CN' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
const duration = (seconds) => {
  if (seconds == null) return absent.value
  const s = Math.max(0, Math.floor(seconds))
  return s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`
    : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`
      : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const lockDuration = computed(() => duration(tracking.value.lockedForSeconds == null ? null
  : tracking.value.lockedForSeconds + props.elapsedSeconds))
const fix = computed(() => receiver.value.fixMode == null ? absent.value : t(`fixMode${receiver.value.fixMode}`))
function measurement(value, unit, signed = false) {
  if (value == null) return { value: absent.value, unit: '' }
  if (unit === 's') {
    const magnitude = Math.abs(value)
    const scale = magnitude < 0.001 ? 1e6 : magnitude < 1 ? 1e3 : 1
    unit = scale === 1e6 ? 'µs' : scale === 1e3 ? 'ms' : 's'
    value *= scale
  }
  return { value: `${signed && value > 0 ? '+' : ''}${format(value)}`, unit }
}
const metrics = computed(() => [
  ['systemOffsetSeconds', 's', true], ['lastOffsetSeconds', 's', true], ['rmsOffsetSeconds', 's'],
  ['frequencyPpm', 'ppm', true], ['skewPpm', 'ppm'], ['rootDispersionSeconds', 's'],
  ['residualFrequencyPpm', 'ppm', true], ['rootDelaySeconds', 's'], ['updateIntervalSeconds', 's'],
].map(([key, unit, signed]) => ({ key, ...measurement(tracking.value[key], unit, signed) })))
const reception = computed(() => [
  { key: 'used', label: 'satellitesUsed', color: 'bg-accent' },
  { key: 'tracked', label: 'satellitesTracked', color: 'bg-highlight' },
  { key: 'visible', label: 'satellitesVisible', color: 'bg-fg/25' },
].map(row => ({ ...row, value: props.satellites?.[row.key] ?? null })))
const chart = computed(() => {
  // Only samples collected during this visit. X follows actual observation times.
  const rows = props.history
  if (rows.length < 2) return null
  const start = rows[0].time, span = Math.max(1, rows.at(-1).time - start)
  const range = Math.max(0.1e-6, ...rows.map(row => Math.abs(row.offset))) * 1.2
  const x = time => 8 + (time - start) / span * 584
  const y = offset => 58 - offset / range * 44
  // A missed/hidden-tab interval is a break, not a continuous recorded line.
  const path = rows.map((row, i) => `${!i || row.time - rows[i - 1].time > 90000 ? 'M' : 'L'}${x(row.time).toFixed(2)},${y(row.offset).toFixed(2)}`).join(' ')
  return { path, range: measurement(range, 's'), latestX: x(rows.at(-1).time), latestY: y(rows.at(-1).offset),
    span: duration(span / 1000) }
})
</script>

<template>
  <div class="space-y-6">
    <dl class="grid grid-cols-2 sm:grid-cols-4 border-y border-fg/10 py-5">
      <div class="pr-3">
        <dt class="text-xs text-muted mb-2">{{ t('ppsLock') }}</dt>
        <dd class="font-mono text-sm flex items-center gap-2" :class="synchronized ? 'text-accent' : 'text-muted'">
          <span class="size-1.5 rounded-full shrink-0" :class="synchronized ? 'bg-accent' : 'bg-highlight'" aria-hidden="true" />
          {{ synchronized ? t('locked') : t('unavailable') }}
        </dd>
      </div>
      <div class="px-4 border-l border-fg/8">
        <dt class="text-xs text-muted mb-2">{{ t('stratum') }}</dt>
        <dd class="font-mono text-sm">{{ synchronized ? '01' : absent }}<span v-if="synchronized" class="text-muted text-xs ml-2">{{ t('directReference') }}</span></dd>
      </div>
      <div class="pr-3 sm:px-4 mt-5 sm:mt-0 sm:border-l border-fg/8">
        <dt class="text-xs text-muted mb-2">{{ t('receiverFix') }}</dt>
        <dd class="font-mono text-sm">{{ fix }}</dd>
      </div>
      <div class="pl-4 mt-5 sm:mt-0 border-l border-fg/8">
        <dt class="text-xs text-muted mb-2">{{ t('observedLock') }}</dt>
        <dd class="font-mono text-sm tabular-nums">{{ lockDuration }}</dd>
      </div>
    </dl>

    <section aria-labelledby="satellite-heading" class="rounded-xl border border-fg/10 overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-fg/8">
        <h2 id="satellite-heading" class="text-sm font-semibold"><span class="font-mono text-accent text-xs mr-3">01</span>{{ t('satelliteTitle') }}</h2>
        <span class="text-[11px] font-mono text-muted">GPS / PPS</span>
      </div>
      <div class="grid sm:grid-cols-[1.4fr_1fr]">
        <div class="p-5 sm:p-6 space-y-5">
          <div v-for="row in reception" :key="row.key">
            <div class="flex justify-between items-baseline gap-4 mb-2">
              <span class="text-xs text-muted">{{ t(row.label) }}</span>
              <span class="font-mono text-xl tabular-nums" :class="row.key === 'used' ? 'text-accent' : 'text-fg'">{{ row.value ?? absent }}</span>
            </div>
            <div class="h-1.5 bg-fg/5 rounded-full overflow-hidden" aria-hidden="true">
              <div class="h-full rounded-full" :class="row.color" :style="{ width: `${satellites?.visible ? (row.value || 0) / satellites.visible * 100 : 0}%` }" />
            </div>
          </div>
          <p class="text-[11px] text-muted leading-relaxed">{{ t('receptionNote') }}</p>
        </div>
        <div class="p-5 sm:p-6 border-t sm:border-t-0 sm:border-l border-fg/8 bg-fg/[0.015] flex flex-col justify-between gap-5">
          <div>
            <h3 class="text-xs text-muted">{{ t('tdop') }}</h3>
            <p class="font-mono text-4xl tabular-nums tracking-tight mt-3" :class="receiver.tdop != null ? 'text-accent' : 'text-muted'">{{ format(receiver.tdop) }}</p>
            <p class="text-[11px] font-mono text-muted mt-2">{{ t('lowerIsBetter') }}</p>
          </div>
          <p class="text-xs text-muted leading-relaxed">{{ t('tdopNote') }}</p>
        </div>
      </div>
    </section>

    <section aria-labelledby="discipline-heading" class="rounded-xl border border-fg/10 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-fg/8">
        <h2 id="discipline-heading" class="text-sm font-semibold"><span class="font-mono text-accent text-xs mr-3">02</span>{{ t('disciplineTitle') }}</h2>
        <span class="text-[11px] font-mono text-muted">chrony · PPS</span>
      </div>
      <dl class="grid grid-cols-2 sm:grid-cols-3">
        <div v-for="(metric, index) in metrics" :key="metric.key" class="p-5 border-b border-fg/8 min-w-0" :class="[index % 2 === 0 && index !== 8 ? 'border-r sm:border-r-0' : '', index % 3 !== 2 ? 'sm:border-r' : '', index === 8 ? 'col-span-2 sm:col-span-1' : '', index === 0 ? 'bg-accent/[0.035]' : '']">
          <dt class="text-xs text-muted mb-3">{{ t(metric.key) }}</dt>
          <dd class="font-mono tabular-nums text-lg sm:text-xl tracking-tight break-words" :class="index === 0 ? 'text-accent' : 'text-fg'">{{ metric.value }}<span class="ml-1 text-xs text-muted">{{ metric.unit }}</span></dd>
          <dd class="text-[11px] leading-relaxed text-muted mt-2">{{ t(`${metric.key}Help`) }}</dd>
        </div>
      </dl>
      <div class="px-5 py-4 text-xs text-muted leading-relaxed space-y-2">
        <p class="font-mono text-[11px] flex flex-wrap gap-x-5 gap-y-1">
          <span>{{ t('referenceAge') }}: {{ duration(tracking.referenceAgeSeconds == null ? null : tracking.referenceAgeSeconds + elapsedSeconds) }}</span>
          <span>{{ t('snapshotAge') }}: {{ duration(tracking.sampleAgeSeconds == null ? null : tracking.sampleAgeSeconds + elapsedSeconds) }}</span>
        </p>
        <p>{{ t('disciplineNote') }}</p>
        <p>{{ t('lockNote') }}</p>
      </div>
    </section>

    <ClockStability :history="stability" :now-ms="nowMs" :synchronized="synchronized" />
    <section aria-labelledby="trace-heading" class="rounded-xl border border-fg/10 p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trace-heading" class="text-sm font-semibold"><span class="font-mono text-accent text-xs mr-3">04</span>{{ t('traceTitle') }}</h2>
        <span class="text-[11px] font-mono text-muted">{{ t('visitSamples', { count: history.length }) }}</span>
      </div>
      <template v-if="chart">
        <div class="flex justify-between mt-5 text-[11px] font-mono text-muted"><span>±{{ chart.range.value }} {{ chart.range.unit }}</span><span>{{ t('zeroReference') }}</span></div>
        <svg viewBox="0 0 600 116" class="w-full h-28 text-accent mt-2" role="img" :aria-label="t('traceAccessible')" preserveAspectRatio="none">
          <path d="M0 14H600 M0 102H600" stroke="currentColor" stroke-opacity="0.08" fill="none" vector-effect="non-scaling-stroke" />
          <path d="M0 58H600" stroke="currentColor" stroke-opacity="0.25" stroke-dasharray="3 5" fill="none" vector-effect="non-scaling-stroke" />
          <path :d="chart.path" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          <circle :cx="chart.latestX" :cy="chart.latestY" r="3" fill="currentColor" />
        </svg>
        <div class="flex justify-between text-[11px] font-mono text-muted"><span>{{ t('traceSpan', { span: chart.span }) }}</span><span>{{ t('latestSample') }}</span></div>
        <details class="text-xs text-muted mt-4">
          <summary class="cursor-pointer hover:text-fg">{{ t('traceValues') }}</summary>
          <ul class="max-h-36 overflow-y-auto mt-3 space-y-1 font-mono tabular-nums">
            <li v-for="point in history" :key="point.time">{{ new Date(point.time).toISOString().slice(11, 19) }} UTC · {{ measurement(point.offset, 's', true).value }} {{ measurement(point.offset, 's').unit }}</li>
          </ul>
        </details>
      </template>
      <p v-else class="text-xs text-muted py-8 text-center">{{ t('traceWaiting') }}</p>
      <p class="text-[11px] text-muted mt-4 leading-relaxed">{{ t('traceNote') }}</p>
    </section>
  </div>
</template>
