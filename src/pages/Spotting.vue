<script setup>
import { stats, shortLens, formatShutter } from '../utils/spotting.js'
import { computed } from 'vue'
import { useLocale } from '../utils/i18n.js'

const { isZh, t, localePath } = useLocale('spotting')

// stats is computed once at module load and never changes, so none of this
// needs to be reactive.

// Bars are sized against the busiest bucket rather than the total, so a
// distribution with one dominant value still shows the shape of its tail.
// Non-empty buckets keep a 2% floor so they stay visible.
function scale(values) {
  const max = Math.max(...values, 1)
  return v => `${v > 0 ? Math.max((v / max) * 100, 2) : 0}%`
}

const hourScale = scale(stats.hours?.map(h => h.count) ?? [])
const focalScale = scale(stats.focalHistogram?.map(f => f.count) ?? [])
const monthScale = scale(stats.timeline?.map(m => m.count) ?? [])

// 24 ticks under a chart this wide is mush; three anchors read fine.
const HOUR_LABELS = [6, 12, 18]

const headline = computed(() => [
  { value: stats.total, label: t('framesPublished') },
  { value: stats.sessionCount, label: t('spottingDays') },
  { value: stats.perSession?.toFixed(1), label: t('framesPerDay') },
  { value: stats.lenses?.length, label: t('lensesUsed') },
])

const sessionsNewestFirst = [...(stats.sessions ?? [])].reverse()

function dayLabel(dayKey, fallback = dayKey) {
  if (!isZh.value) return fallback
  const [year, month, day] = dayKey.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function monthLabel(month) {
  return isZh.value ? `${Number(month.key.slice(5))}月` : month.label
}

function monthTitle(month) {
  return isZh.value ? `${month.year}年${monthLabel(month)}` : `${month.label} ${month.year}`
}

function focalLabel(label) {
  if (!isZh.value) return label
  return label.replace(' to ', ' 至 ').replace(/^(\d+ 至 \d+|> \d+)$/, '$1mm')
}

const firstDay = computed(() => dayLabel(stats.sessions?.[0]?.dayKey, stats.firstDay))
const lastDay = computed(() => dayLabel(stats.sessions?.at(-1)?.dayKey, stats.lastDay))

// Print the year only when it turns, the way an axis should.
function yearLabel(m, i) {
  if (i !== 0 && stats.timeline[i - 1].year === m.year) return ''
  return isZh.value ? `${m.year}年` : m.year
}
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('spottingStats') }}</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      <template v-if="!stats.empty">{{ t('dateRange', { p0: firstDay, p1: lastDay }) }} ·</template>
      {{ t('exifFromThe') }}
      <RouterLink :to="localePath('/gallery/planespotting')" class="text-fg hover:text-accent transition-colors">{{ t('gallery') }}</RouterLink>
    </p>

    <p v-if="stats.empty" class="text-sm text-muted italic">
      {{ t('noPhotosIndexedYetAddSomeTo') }} <code class="font-mono">src/photos/</code> {{ t('andRebuild') }}
    </p>

    <template v-else>
      <!-- Headline numbers -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-14">
        <div v-for="stat in headline" :key="stat.label" class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ stat.value }}</div>
          <div class="text-xs text-muted mt-1">{{ stat.label }}</div>
        </div>
      </div>

      <!-- Time of day -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">{{ t('whenIShoot') }}</h3>
      <p class="text-xs text-muted mb-5">
        {{ t('byHourBeijingTimePeak') }} {{ String(stats.peakHour.hour).padStart(2, '0') }}:00{{ t('comma') }}{{ stats.peakHour.count }} {{ t('frames') }}
      </p>
      <div class="flex items-end gap-[3px] h-28 mb-2">
        <div
          v-for="h in stats.hours"
          :key="h.hour"
          class="flex-1 bg-accent/70 rounded-t-[2px] min-h-0"
          :style="{ height: hourScale(h.count) }"
          :title="`${String(h.hour).padStart(2, '0')}:00: ${t('frame', { p0: h.count, p1: h.count === 1 ? '' : 's' })}`"
        />
      </div>
      <div class="flex gap-[3px] text-xs font-mono text-muted mb-14">
        <div v-for="h in stats.hours" :key="h.hour" class="flex-1 text-center">
          <span v-if="HOUR_LABELS.includes(h.hour)">{{ h.hour }}</span>
        </div>
      </div>

      <!-- Months -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">{{ t('activity') }}</h3>
      <p class="text-xs text-muted mb-5">{{ t('framesPerMonth') }}</p>
      <div class="flex items-end gap-1 h-24 mb-2">
        <div
          v-for="m in stats.timeline"
          :key="m.key"
          class="flex-1 bg-accent/70 rounded-t-[2px]"
          :style="{ height: monthScale(m.count) }"
          :title="`${monthTitle(m)}: ${t('frame', { p0: m.count, p1: m.count === 1 ? '' : 's' })}`"
        />
      </div>
      <div class="flex gap-1 text-xs font-mono text-muted mb-14">
        <div v-for="(m, i) in stats.timeline" :key="m.key" class="flex-1 text-center overflow-hidden">
          <div>{{ monthLabel(m) }}</div>
          <div class="text-fg/60">{{ yearLabel(m, i) }}</div>
        </div>
      </div>

      <!-- Gear -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-5">{{ t('glass') }}</h3>
      <div class="space-y-3 mb-8">
        <div v-for="lens in stats.lenses" :key="lens.value">
          <div class="flex justify-between items-baseline text-sm mb-1.5 gap-4">
            <span class="text-fg font-mono">{{ shortLens(lens.value) }}</span>
            <span class="text-xs font-mono text-muted shrink-0">
              {{ lens.count }} · {{ Math.round(lens.share * 100) }}%
            </span>
          </div>
          <div class="h-1.5 rounded-full bg-fg/8 overflow-hidden">
            <div class="h-full bg-accent rounded-full" :style="{ width: `${lens.share * 100}%` }" />
          </div>
        </div>
      </div>

      <ul class="text-sm text-muted space-y-2 mb-14">
        <li v-for="body in stats.bodies" :key="body.value" class="flex gap-3">
          <span class="text-accent shrink-0">→</span>
          <span>
            <span class="text-fg">{{ body.value }}</span><template v-if="isZh">：{{ t('frame', { p0: body.count }) }}</template><template v-else>: {{ t('frame', { p0: body.count, p1: body.count === 1 ? '' : 's' }) }}</template>
          </span>
        </li>
      </ul>

      <!-- Focal lengths -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">{{ t('focalLength') }}</h3>
      <p class="text-xs text-muted mb-5">
        {{ stats.focal.min }}mm {{ t('to') }} {{ stats.focal.max }}mm，{{ t('median') }} {{ stats.focal.median }}mm{{ t('period') }}
      </p>
      <div class="space-y-2.5 mb-14">
        <div v-for="b in stats.focalHistogram" :key="b.label" class="flex items-center gap-3">
          <span class="text-xs font-mono text-muted w-20 shrink-0 text-right">{{ focalLabel(b.label) }}</span>
          <div class="flex-1 h-4 rounded-sm bg-fg/5 overflow-hidden">
            <div class="h-full bg-accent/70" :style="{ width: focalScale(b.count) }" />
          </div>
          <span class="text-xs font-mono text-muted w-6 shrink-0">{{ b.count }}</span>
        </div>
      </div>

      <!-- Exposure -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-5">{{ t('exposure') }}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-14">
        <div class="bg-bg p-4">
          <div class="text-xs font-mono text-muted uppercase tracking-wider mb-2">{{ t('shutter') }}</div>
          <div class="text-sm text-muted space-y-1">
            <div><span class="text-fg font-mono">{{ formatShutter(stats.shutter.fastest) }}</span> {{ t('fastest') }}</div>
            <div><span class="text-fg font-mono">{{ formatShutter(stats.shutter.median) }}</span> {{ t('median') }}</div>
            <div><span class="text-fg font-mono">{{ formatShutter(stats.shutter.slowest) }}</span> {{ t('slowest') }}</div>
          </div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-xs font-mono text-muted uppercase tracking-wider mb-2">ISO</div>
          <div class="text-sm text-muted space-y-1">
            <div><span class="text-fg font-mono">{{ stats.iso.min }}</span> {{ t('lowest') }}</div>
            <div><span class="text-fg font-mono">{{ stats.iso.median }}</span> {{ t('median') }}</div>
            <div><span class="text-fg font-mono">{{ stats.iso.max }}</span> {{ t('highest') }}</div>
          </div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-xs font-mono text-muted uppercase tracking-wider mb-2">{{ t('aperture') }}</div>
          <div class="text-sm text-muted space-y-1">
            <div><span class="text-fg font-mono">f/{{ stats.aperture.widest }}</span> {{ t('widest') }}</div>
            <div><span class="text-fg font-mono">f/{{ stats.aperture.narrowest }}</span> {{ t('narrowest') }}</div>
          </div>
        </div>
      </div>

      <!-- Sessions -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">{{ t('daysOut') }}</h3>
      <p class="text-xs text-muted mb-5">
        {{ t('bestSession', { p0: dayLabel(stats.busiest.dayKey, stats.busiest.label), p1: stats.busiest.count }) }}<template
          v-if="stats.busiest.minutes > 0">，{{ t('in') }} {{ stats.busiest.minutes }} {{ t('minutes') }}</template>{{ t('period') }}
      </p>
      <div class="border border-fg/8 rounded-lg overflow-hidden">
        <div
          v-for="(s, i) in sessionsNewestFirst"
          :key="s.dayKey"
          class="flex items-center gap-4 px-4 py-2.5 text-sm"
          :class="i % 2 ? 'bg-fg/[0.02]' : ''"
        >
          <span class="font-mono text-muted text-xs sm:text-sm w-24 sm:w-32 shrink-0">{{ dayLabel(s.dayKey, s.label) }}</span>
          <div class="flex-1 h-1.5 rounded-full bg-fg/8 overflow-hidden">
            <div class="h-full bg-accent/70 rounded-full" :style="{ width: `${(s.count / stats.busiest.count) * 100}%` }" />
          </div>
          <span class="font-mono text-xs text-muted w-6 text-right shrink-0">{{ s.count }}</span>
        </div>
      </div>

      <p class="text-xs text-muted/90 font-mono mt-12">
        {{ t('generatedAtBuildTimeFromFiles', { p0: stats.total }) }}
      </p>
    </template>
  </section>
</template>
