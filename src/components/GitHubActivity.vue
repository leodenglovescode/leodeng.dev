<script setup>
import { ref, computed, onMounted } from 'vue'
import { currentYearDays } from '../utils/githubCalendar.js'
import { statsJson } from '../../lib/monkeyStats.js'
import { useLocale } from '../utils/i18n.js'
const { isZh, t } = useLocale('about')
const props = defineProps({ visual: Boolean })
const languageCounts = ref({})
const GITHUB_LOGIN = 'leodenglovescode'
const loading = ref(true)
const getJson = url => statsJson(url, { credentials: 'omit', headers: { Accept: 'application/json' } })

const repoCount = ref(null)
const starCount = ref(null)
const followerCount = ref(null)
const prCount = ref(null)
const topLanguages = ref([])

const totalContributions = ref(null)
const contributionDays = ref([]) // { date, level, gridColumn, gridRow }
const monthLabels = ref([])
const weeksCount = ref(0)
const contributionRangeLabel = ref('year')
const localizedContributionRange = computed(() => contributionRangeLabel.value === 'recent'
  ? t('publicEventsInTheLast30Days')
  : t('contributionsThisYear'))

const tooltip = ref({ visible: false, x: 0, y: 0, count: 0, dateLabel: '' })

function formatStat(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n)
}

// GitHub's own Octicons (MIT, github.com/primer/octicons), inlined so the
// icons are pixel-identical to GitHub's UI without a CDN or extra dependency.
const ICON_PATHS = {
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
  starFill: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
  gitPullRequest: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  people: 'M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z',
}

const statTiles = computed(() => [
  { icon: 'repo', value: repoCount.value, label: t('repos') },
  { icon: 'starFill', value: starCount.value, label: t('stars') },
  { icon: 'gitPullRequest', value: prCount.value, label: t('mergedPrs') },
  { icon: 'people', value: followerCount.value, label: t('followers') },
].filter(t => t.value !== null))

const levelClasses = [
  'bg-fg/8',
  'bg-accent/25',
  'bg-accent/50',
  'bg-accent/75',
  'bg-accent',
]

// Buckets raw event counts into the same 0-4 levels GitHub uses for its own
// contribution graph, since the events-API fallback has no precomputed level.
function levelForCount(count) {
  if (count <= 0) return 0
  if (count <= 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

// Shared grid-position math: takes ascending {date, level, count} entries and
// assigns each a Sunday-anchored (gridColumn, gridRow), plus month labels.
function layoutCalendar(daysWithCount) {
  const firstDate = new Date(daysWithCount[0].date + 'T00:00:00Z')
  const anchor = new Date(firstDate)
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay()) // back up to Sunday

  const labels = []
  let prevMonth = null
  let prevColumn = -1

  const days = daysWithCount.map(d => {
    const date = new Date(d.date + 'T00:00:00Z')
    const diffDays = Math.round((date - anchor) / 86400000)
    const column = Math.floor(diffDays / 7)
    const row = (diffDays % 7) + 1

    const month = date.getUTCMonth()
    if (column !== prevColumn && month !== prevMonth) {
      labels[column] = date.toLocaleString(isZh.value ? 'zh-CN' : 'en-US', { month: 'short', timeZone: 'UTC' })
      prevMonth = month
      prevColumn = column
    }

    return { date: d.date, level: d.level, count: d.count, future: d.future, gridColumn: column + 1, gridRow: row }
  })

  return { days, labels, weeksCount: Math.max(...days.map(d => d.gridColumn)) }
}

function showTooltip(event, day) {
  const rect = event.currentTarget.getBoundingClientRect()
  tooltip.value = {
    visible: true,
    x: rect.left + rect.width / 2,
    y: rect.top - 6,
    count: day.count,
    dateLabel: new Date(day.date + 'T00:00:00Z').toLocaleDateString(isZh.value ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }
}

function hideTooltip() {
  tooltip.value.visible = false
}

// Primary source: a public, no-auth wrapper around GitHub's real contribution
// calendar. GitHub's own GraphQL API requires an auth token even for public
// data, which can't safely live in client-side JS. The public wrapper
// supplies the calendar without exposing a browser token.
async function fetchContributionsPrimary() {
  const data = await getJson(`https://github-contributions-api.jogruber.de/v4/${GITHUB_LOGIN}?y=last`)
  const year = String(new Date().getUTCFullYear())
  const today = new Date().toISOString().slice(0, 10)
  const rawDays = data.contributions?.filter(d => d.date.startsWith(year + '-') && d.date <= today)
  if (!rawDays?.length) throw new Error('empty contributions response')

  const { days, labels, weeksCount: wc } = layoutCalendar(
    currentYearDays(rawDays)
  )
  contributionDays.value = days
  monthLabels.value = labels
  weeksCount.value = wc
  totalContributions.value = rawDays.reduce((sum, day) => sum + day.count, 0)
  contributionRangeLabel.value = 'year'
}

// Fallback: GitHub's own official REST API, no auth needed, but it only
// exposes recent public events (30 days / 300 events max), not a full
// contribution calendar, and event counts approximate rather than match
// contribution counts exactly (e.g. one push = one event regardless of
// commit count). Used only if the primary source is unreachable.
async function fetchContributionsFallback() {
  const counts = new Map()
  for (let page = 1; page <= 3; page++) {
    const events = await getJson(`https://api.github.com/users/${GITHUB_LOGIN}/events/public?per_page=100&page=${page}`)
    if (!Array.isArray(events) || events.length === 0) break
    for (const e of events) {
      const date = e.created_at.slice(0, 10)
      counts.set(date, (counts.get(date) || 0) + 1)
    }
    if (events.length < 100) break
  }
  if (counts.size === 0) throw new Error('no public events available')

  const dates = [...counts.keys()].sort()
  const start = new Date(dates[0] + 'T00:00:00Z')
  const end = new Date(dates[dates.length - 1] + 'T00:00:00Z')
  const daysWithCount = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    const count = counts.get(key) || 0
    daysWithCount.push({ date: key, level: levelForCount(count), count })
  }

  const { days, labels, weeksCount: wc } = layoutCalendar(daysWithCount)
  contributionDays.value = days
  monthLabels.value = labels
  weeksCount.value = wc
  totalContributions.value = [...counts.values()].reduce((a, b) => a + b, 0)
  contributionRangeLabel.value = 'recent'
}

async function fetchGithubStats() {
  try {
    const user = await getJson(`https://api.github.com/users/${GITHUB_LOGIN}`)
    repoCount.value = user.public_repos ?? 0
    followerCount.value = user.followers ?? 0

    const repos = []
    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      const page = await getJson(`https://api.github.com/users/${GITHUB_LOGIN}/repos?per_page=100&page=${pageNum}&type=owner`)
      if (!Array.isArray(page) || page.length === 0) break
      repos.push(...page)
      if (page.length < 100) break
    }

    const ownRepos = repos.filter(r => !r.fork)
    starCount.value = ownRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0)

    const langCounts = {}
    for (const r of ownRepos) {
      if (!r.language) continue
      langCounts[r.language] = (langCounts[r.language] || 0) + 1
    }
    languageCounts.value = langCounts
    topLanguages.value = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang)
  } catch {
    // stats stay null; tiles simply don't render
  }

  try {
    const prData = await getJson(`https://api.github.com/search/issues?q=is:pr+is:merged+author:${GITHUB_LOGIN}`)
    prCount.value = prData.total_count ?? 0
  } catch {
    // stays null; tile simply doesn't render
  }
}

const languageSlices = computed(() => {
  const entries = Object.entries(languageCounts.value).sort((a, b) => b[1] - a[1])
  const slices = entries.slice(0, 5)
  if (entries.length > 5) slices.push([t('otherLanguages'), entries.slice(5).reduce((sum, entry) => sum + entry[1], 0)])
  const total = slices.reduce((sum, entry) => sum + entry[1], 0)
  const colors = ['#4d9dff', '#d4a62a', '#43a87b', '#a277d5', '#dc7869', '#7d8b9e']
  let offset = 0
  return slices.map(([name, count], index) => {
    const share = count / total, circumference = 2 * Math.PI * 60
    const result = { name, count, color: colors[index], percent: Math.round(share * 100), dash: `${share * circumference} ${circumference}`, offset: -offset * circumference }
    offset += share; return result
  })
})
const months = computed(() => {
  const entries = new Map()
  for (const day of contributionDays.value) {
    if (day.future) continue
    const key = day.date.slice(0, 7)
    entries.set(key, (entries.get(key) || 0) + day.count)
  }
  const maximum = Math.max(1, ...entries.values())
  return [...entries].map(([key, count]) => ({ key, count, height: count / maximum * 100,
    label: new Date(key + '-01T00:00:00Z').toLocaleDateString(isZh.value ? 'zh-CN' : 'en', { month: 'short', timeZone: 'UTC' }) }))
})

onMounted(async () => {
  await Promise.allSettled([
    fetchGithubStats(),
    fetchContributionsPrimary().catch(() => fetchContributionsFallback()).catch(() => {}),
  ])
  loading.value = false
})
</script>

<template>
    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">GitHub</h2>

      <p v-if="!statTiles.length && !contributionDays.length" role="status" class="text-sm text-muted mb-4">{{ t(loading ? 'githubLoading' : 'githubUnavailable') }}</p>
      <div v-if="statTiles.length" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div
          v-for="t in statTiles"
          :key="t.label"
          class="flex items-center gap-3 px-4 py-3 rounded-lg border border-fg/8 hover:border-accent/30 transition-colors"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" class="text-muted shrink-0">
            <path :d="ICON_PATHS[t.icon]" />
          </svg>
          <div>
            <div class="text-fg font-semibold leading-none">{{ formatStat(t.value) }}</div>
            <div class="text-xs font-mono text-muted/90 mt-1">{{ t.label }}</div>
          </div>
        </div>
      </div>

      <div v-if="topLanguages.length && !props.visual" class="flex flex-wrap gap-2 mb-6">
        <span v-for="l in topLanguages" :key="l" class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted">
          {{ l }}
        </span>
      </div>

      <div v-if="contributionDays.length" class="contribution-calendar w-full min-w-0" :style="{ maxWidth: `${weeksCount * 13}px` }">
        <p class="text-xs font-mono text-muted/90 mb-2">
          {{ totalContributions }} {{ localizedContributionRange }}
        </p>
        <div class="grid gap-[2px] mb-2" :style="{ gridTemplateColumns: `repeat(${weeksCount}, minmax(0, 1fr))` }">
          <span v-for="(label, i) in monthLabels" :key="i" class="text-[9px] font-mono text-muted/90 leading-none min-w-0">
            {{ label }}
          </span>
        </div>
        <div
          class="grid gap-[2px]"
          :style="{ gridTemplateColumns: `repeat(${weeksCount}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(7, minmax(0, 1fr))', aspectRatio: `${weeksCount} / 7` }"
        >
          <div
            v-for="day in contributionDays"
            :key="day.date"
            class="w-full h-full min-w-0 min-h-0 rounded-[1px] cursor-default transition-[filter] hover:brightness-125"
            :class="[levelClasses[day.level], day.future && 'opacity-25']"
            :style="{ gridColumn: day.gridColumn, gridRow: day.gridRow }"
            @mouseenter="day.future ? hideTooltip() : showTooltip($event, day)"
            @mouseleave="hideTooltip"
          ></div>
        </div>
      </div>

      <div v-if="props.visual" class="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
        <figure v-if="languageSlices.length" class="rounded-lg border border-fg/10 p-4 min-w-0">
          <figcaption class="text-sm font-semibold mb-2">{{ t('repoLanguages') }}</figcaption>
          <p class="text-xs text-muted mb-3">{{ t('repoLanguageNote') }}</p>
          <svg viewBox="0 0 180 180" role="img" :aria-label="t('repoLanguages')" class="w-40 h-40 mx-auto mb-3">
            <circle v-for="slice in languageSlices" :key="slice.name" cx="90" cy="90" r="60" fill="none" stroke-width="32" :stroke="slice.color" :stroke-dasharray="slice.dash" :stroke-dashoffset="slice.offset" transform="rotate(-90 90 90)"><title>{{ slice.name }}: {{ slice.count }} ({{ slice.percent }}%)</title></circle>
          </svg>
          <ul class="space-y-2 text-xs">
            <li v-for="slice in languageSlices" :key="slice.name" class="flex items-center gap-2"><span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: slice.color }"></span><span class="min-w-0 break-words">{{ slice.name }}</span><span class="ml-auto font-mono whitespace-nowrap">{{ slice.count }} / {{ slice.percent }}%</span></li>
          </ul>
        </figure>
        <figure v-if="months.length" class="rounded-lg border border-fg/10 p-4 min-w-0">
          <figcaption class="text-sm font-semibold mb-2">{{ t('monthlyActivity') }}</figcaption>
          <p class="text-xs text-muted mb-6">{{ t('monthlyActivityNote') }}</p>
          <div class="flex items-end gap-1 h-44" role="img" :aria-label="t('monthlyActivity')">
            <div v-for="month in months" :key="month.key" class="flex-1 h-full min-w-0 flex flex-col justify-end items-center gap-2" :title="`${month.key}: ${month.count}`">
              <span class="text-[9px] text-muted font-mono">{{ month.count }}</span>
              <span class="block w-full bg-accent/70 rounded-t-sm" :style="{ height: `${month.height * 0.75}%`, minHeight: '2px' }"></span>
              <span class="text-[9px] text-muted">{{ month.label }}</span>
            </div>
          </div>
        </figure>
      </div>

      <!-- Only mount this client-side tooltip when it is visible. An empty
           SSR teleport into body can hydrate against the page's own root. -->
      <Teleport v-if="tooltip.visible" to="body">
        <div
          class="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2.5 py-1.5 rounded-md bg-surface border border-fg/10 shadow-lg text-xs font-mono whitespace-nowrap"
          :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        >
          <div class="text-fg font-semibold">{{ t('contribution', { p0: tooltip.count, p1: tooltip.count === 1 ? '' : 's' }) }}</div>
          <div class="text-muted">{{ tooltip.dateLabel }}</div>
        </div>
      </Teleport>
    </section>

</template>
