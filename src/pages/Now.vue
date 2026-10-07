<script setup>
import { marked } from 'marked'
import { computed } from 'vue'
import nowData from '../content/now.json'
import { useLocale } from '../utils/i18n.js'

const { isZh, t, localized, localePath } = useLocale('now')

const STATUS = computed(() => ({
  active: {
    heading: t('buildingNow'),
    label: t('active'),
    dot: 'bg-accent',
  },
  recurring: {
    heading: t('keepingRunning'),
    label: t('ongoing'),
    dot: 'bg-[#15a34a] dark:bg-[#4ade80]',
  },
  paused: {
    heading: t('onPause'),
    label: t('paused'),
    dot: 'bg-highlight',
  },
  finished: {
    heading: t('recentlyFinished'),
    label: t('finished'),
    dot: 'bg-muted',
  },
}))

const STATUS_ORDER = ['active', 'recurring', 'paused', 'finished']
const events = computed(() => (nowData.events || []).map((event) => ({
  ...event,
  title: localized(event.title),
  details: localized(event.details),
  status: STATUS.value[event.status] ? event.status : 'active',
})))

const sections = computed(() => STATUS_ORDER
  .map((status) => ({
    status,
    ...STATUS.value[status],
    events: events.value.filter((event) => event.status === status),
  }))
  .filter((section) => section.events.length))

function dateFromIso(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function monthYear(iso) {
  const date = dateFromIso(iso)
  return date ? new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date) : ''
}

function fullDate(iso) {
  const date = dateFromIso(iso)
  return date ? new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date) : ''
}

function eventDates(event) {
  const dates = []
  if (event.startedAt) dates.push(t('started', { p0: monthYear(event.startedAt) }))
  if (event.updatedAt && event.status !== 'finished') dates.push(t('updated', { p0: fullDate(event.updatedAt) }))
  if (event.finishedAt && event.status === 'finished') dates.push(t('finished2', { p0: monthYear(event.finishedAt) }))
  return dates
}

function renderDetails(source) {
  return marked.parseInline(String(source || ''))
    .replace(/<a href="(\/[^"]+)"/g, (_match, href) => `<a href="${localePath(href)}"`)
    .replace(/<a href="(https?:\/\/[^\"]+)"/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer"')
}

const lastUpdated = computed(() => fullDate(nowData.updatedAt) || t('recently'))
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('now') }}</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">{{ t('lastUpdated', { p0: lastUpdated }) }}</p>

    <div class="space-y-4 text-[15px] leading-relaxed text-muted mb-12">
      <p>{{ t('aSnapshotOfWhatIAmBuilding') }}</p>
    </div>

    <div class="space-y-14">
      <section v-for="section in sections" :key="section.status">
        <div class="flex items-center gap-3 mb-5">
          <h3 class="text-xs font-mono text-muted uppercase tracking-widest">
            {{ section.heading }}
          </h3>
          <span class="h-px flex-1 bg-fg/10" />
          <span class="text-xs font-mono text-muted/90">{{ section.events.length }}</span>
        </div>

        <div class="divide-y divide-fg/10 border-y border-fg/10">
          <article
            v-for="event in section.events"
            :key="event.id"
            class="grid sm:grid-cols-[7rem_1fr] gap-3 sm:gap-6 py-6"
          >
            <div class="flex items-center sm:items-start gap-2 pt-0.5">
              <span :class="['w-2 h-2 rounded-full shrink-0 mt-1', section.dot]" />
              <span class="text-xs font-mono text-muted uppercase tracking-wider">
                {{ section.label }}
              </span>
            </div>

            <div class="min-w-0">
              <h4 class="text-base font-semibold text-fg mb-2">{{ event.title }}</h4>
              <p
                class="text-sm leading-relaxed text-muted [&_a]:text-fg [&_a]:underline [&_a]:decoration-fg/20
                       [&_a]:underline-offset-4 [&_a]:hover:text-accent [&_a]:transition-colors"
                v-html="renderDetails(event.details)"
              />
              <p v-if="eventDates(event).length" class="text-xs font-mono text-muted/90 mt-3">
                <template v-for="(date, index) in eventDates(event)" :key="date">
                  <span v-if="index" aria-hidden="true"> · </span>{{ date }}
                </template>
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>

    <p class="text-xs text-muted/90 font-mono mt-14">
      {{ t('inspiredByThe') }} <a href="https://nownownow.com" target="_blank" rel="noopener noreferrer" class="hover:text-muted transition-colors">{{ t('nowPageMovement') }}</a>{{ t('period') }}
    </p>
  </section>
</template>
