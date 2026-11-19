<script setup>
import { computed, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'

const props = defineProps({ history: { type: Object, default: null }, nowMs: { type: Number, default: null }, synchronized: Boolean })
const { t, isZh } = useLocale('time')
const selected = ref(null)
const percentFormatter = computed(() => new Intl.NumberFormat(isZh.value ? 'zh-CN' : 'en-GB', { style: 'percent', maximumFractionDigits: 2 }))
const percentage = value => percentFormatter.value.format(value)
const grades = ['good', 'fair', 'poor', 'bad']
const cells = computed(() => {
  // UTC calendar, Monday at the top, 13 weeks ending with the current week.
  // Keep the initial server/browser render deterministic until a clock is available.
  if (props.nowMs == null) return []
  const now = new Date(props.nowMs)
  const today = now.toISOString().slice(0, 10)
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const monday = midnight - ((now.getUTCDay() + 6) % 7) * 86400000
  const start = monday - 12 * 7 * 86400000
  const records = new Map((props.history?.days || []).map(day => [day.date, day]))
  return Array.from({ length: 91 }, (_, index) => {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10)
    const row = records.get(date)
    const future = date > today
    const expected = date === today ? Math.min(8640, Math.floor((props.nowMs - midnight) / 10000) + 1) : 8640
    const coverage = row ? Math.min(1, row.observed / expected) : 0
    const availability = row ? row.locked / row.observed : null
    const grade = availability == null ? 'none' : availability >= 0.999 ? 'good'
      : availability >= 0.99 ? 'fair' : availability >= 0.95 ? 'poor' : 'bad'
    const partial = !!row && coverage < 0.9
    const description = future ? t('futureDay') : row
      ? t('dayAvailability', { availability: percentage(availability), coverage: percentage(coverage) }) : t('noObservations')
    return { date, future, availability, coverage, grade, partial, description,
      label: `${date} UTC: ${description}${partial ? `. ${t('partialCoverage')}` : ''}` }
  })
})
const selectedDay = computed(() => cells.value.find(day => day.date === selected.value))
const totals = computed(() => (props.history?.days || []).reduce((total, day) => ({
  observed: total.observed + day.observed, locked: total.locked + day.locked,
}), { observed: 0, locked: 0 }))
</script>

<template>
  <section aria-labelledby="stability-heading" class="rounded-xl border border-fg/10 p-5 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="stability-heading" class="text-sm font-semibold"><span class="font-mono text-accent text-xs mr-3">03</span>{{ t('stabilityTitle') }}</h2>
        <p class="text-xs text-muted mt-2">{{ t('stabilitySubtitle') }}</p>
      </div>
      <p class="font-mono text-xl tabular-nums" :class="totals.observed ? 'text-accent' : 'text-muted'">{{ totals.observed ? percentage(totals.locked / totals.observed) : t('noMeasurement') }}<span class="block text-[11px] text-muted mt-1">{{ t('ofObservedChecks') }}</span></p>
    </div>
    <div v-if="cells.length" class="mt-6 max-w-[28rem]">
      <div class="flex gap-2 sm:gap-3">
        <div class="grid grid-rows-7 gap-1 sm:gap-1.5 text-[10px] text-muted font-mono" aria-hidden="true">
          <span v-for="(day, index) in t('weekdaysShort')" :key="index" class="flex items-center">{{ index % 2 === 0 ? day : '' }}</span>
        </div>
        <div class="grid grid-flow-col grid-rows-7 grid-cols-13 gap-1 sm:gap-1.5 flex-1 min-w-0" :aria-label="t('calendarLabel')">
          <button v-for="day in cells" :key="day.date" type="button" class="stability-square aspect-square w-full rounded-[3px] border border-fg/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            :class="[`stability-${day.grade}`, { 'stability-partial': day.partial, 'opacity-20': day.future, 'ring-2 ring-accent ring-offset-2 ring-offset-bg': selected === day.date }]"
            :disabled="day.future" :title="day.label" :aria-label="day.label" :aria-pressed="selected === day.date" @click="selected = day.date" />
        </div>
      </div>
      <div class="flex justify-between text-[10px] font-mono text-muted mt-2 pl-8"><span>{{ cells[0].date }}</span><span>{{ t('todayUtc') }}</span></div>
    </div>
    <div v-else class="h-44 flex items-center justify-center text-xs text-muted">{{ t('stabilityWaiting') }}</div>
    <p class="text-xs text-muted mt-4 min-h-8 leading-relaxed" role="status">{{ selectedDay ? selectedDay.label : t('calendarHint') }}</p>
    <div class="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted mt-2">
      <span v-for="grade in grades" :key="grade" class="inline-flex items-center gap-1.5"><span class="stability-square size-2.5 rounded-[2px]" :class="`stability-${grade}`" aria-hidden="true" />{{ t(`stabilityGrade.${grade}`) }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="stability-square stability-none size-2.5 rounded-[2px]" aria-hidden="true" />{{ t('noObservations') }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="stability-square stability-good stability-partial size-2.5 rounded-[2px]" aria-hidden="true" />{{ t('partialCoverage') }}</span>
    </div>
    <p class="text-[11px] text-muted leading-relaxed mt-5 pt-4 border-t border-fg/8">{{ t('stabilityNote') }}</p>
    <p v-if="!synchronized && history" class="text-[11px] text-highlight mt-2">{{ t('historyNotLive') }}</p>
  </section>
</template>

<style scoped>
.stability-good { background-color: #208448; }
.stability-fair { background-color: #c3a12a; }
.stability-poor { background-color: #d47927; }
.stability-bad { background-color: #c84c4c; }
.stability-none { background-color: var(--color-fg); opacity: 0.09; }
.stability-partial { background-image: repeating-linear-gradient(135deg, transparent 0 3px, rgb(0 0 0 / 0.4) 3px 5px); }
</style>
