<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import GitHubActivity from '../components/GitHubActivity.vue'
import { useLocale } from '../utils/i18n.js'
import { statsJson } from '../../lib/monkeyStats.js'

const { t, isZh, localePath } = useLocale('stats')
const commits = ref([]), commitCount = ref(null), commitsState = ref('loading')
const monkey = ref(null), monkeyState = ref('loading'), mode = ref('all')
let mounted = true
onBeforeUnmount(() => { mounted = false })
const history = computed(() => (monkey.value?.history?.results || []).filter(r => mode.value === 'all' || `${r.mode}:${r.mode2}` === mode.value))
const recent = computed(() => history.value.slice(-12).reverse())
const best60 = computed(() => monkey.value?.profile?.bests.find(b => b.seconds === 60)?.wpm)
const format = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(isZh.value ? 'zh-CN' : 'en', { maximumFractionDigits: 1 }).format(value) : '…'
const date = value => new Date(value).toLocaleDateString(isZh.value ? 'zh-CN' : 'en', { year: 'numeric', month: 'short', day: 'numeric' })
const chart = computed(() => {
  const values = history.value
  if (!values.length) return { points: '', maximum: 0 }
  const maximum = Math.max(10, Math.ceil(Math.max(...values.map(r => r.wpm)) / 10) * 10)
  const first = values[0].timestamp, span = values[values.length - 1].timestamp - first
  return { maximum, points: values.map(r => `${24 + (span ? (r.timestamp - first) / span : 0.5) * 552},${155 - r.wpm / maximum * 130}`).join(' ') }
})
const modes = ['all', 'time:15', 'time:30', 'time:60', 'time:120', 'words:10', 'words:25', 'words:50', 'words:100']
const modeLabel = value => value === 'all' ? t('allTests') : value.startsWith('time:') ? `${value.split(':')[1]} ${t('seconds')}` : `${value.split(':')[1]} ${t('words')}`

onMounted(() => {
  void statsJson('https://api.github.com/search/commits?q=author%3Aleodenglovescode&sort=committer-date&order=desc&per_page=3', { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } })
    .then(data => {
      if (!mounted) return
      if (!Array.isArray(data.items)) throw new Error('Unavailable')
      commits.value = data.items.slice(0, 3).filter(c => typeof c.html_url === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-f0-9]{40}$/.test(c.html_url))
        .map(c => ({ url: c.html_url, sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0], repo: c.repository.full_name, date: c.commit.committer.date }))
      commitCount.value = data.incomplete_results ? null : data.total_count
      commitsState.value = 'ready'
    }).catch(() => { if (mounted) commitsState.value = 'unavailable' })
  void statsJson('/api/stats/monkeytype')
    .then(data => { if (mounted) { monkey.value = data; monkeyState.value = 'ready' } })
    .catch(() => { if (mounted) monkeyState.value = 'unavailable' })
})
</script>

<template>
  <article class="pt-16 sm:pt-24 pb-20 space-y-12">
    <header>
      <h1 class="text-2xl sm:text-3xl font-semibold">{{ t('title') }}</h1>
      <p class="mt-3 text-sm text-muted leading-relaxed">{{ t('intro') }}</p>
      <nav class="flex flex-wrap gap-4 mt-5 text-sm text-accent" :aria-label="t('sections')">
        <a href="#coding" class="underline">GitHub</a><a href="#typing" class="underline">Monkeytype</a>
        <RouterLink :to="localePath('/gallery/planespotting')" class="underline">{{ t('photos') }} ↗</RouterLink>
      </nav>
    </header>

    <section id="coding" class="stats-section">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p class="text-xs font-mono text-muted">01 / {{ t('coding') }}</p>
        <a href="https://github.com/leodenglovescode" class="text-xs font-mono text-accent">@leodenglovescode ↗</a>
      </div>
      <GitHubActivity visual />
      <div class="mt-8 border-t border-fg/10 pt-6">
        <div class="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 class="text-base font-semibold">{{ t('commits') }}</h2>
          <span v-if="commitCount !== null" class="text-xs font-mono text-muted">{{ format(commitCount) }} {{ t('indexed') }}</span>
        </div>
        <p class="text-xs text-muted mb-5">{{ t('commitNote') }}</p>
        <p v-if="commitsState !== 'ready'" role="status" class="text-sm text-muted">{{ t(commitsState) }}</p>
        <p v-else-if="!commits.length" class="text-sm text-muted">{{ t('noCommits') }}</p>
        <ol v-else class="divide-y divide-fg/8">
          <li v-for="commit in commits" :key="commit.url" class="py-3">
            <a :href="commit.url" class="text-sm hover:text-accent break-words">{{ commit.message }}</a>
            <p class="text-xs font-mono text-muted mt-1 break-words">{{ commit.repo }} · {{ commit.sha }} · {{ date(commit.date) }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section id="typing" class="stats-section">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p class="text-xs font-mono text-muted">02 / {{ t('typing') }}</p>
        <a href="https://monkeytype.com/profile/leodeng" class="text-xs font-mono text-accent">@leodeng ↗</a>
      </div>
      <h2 class="text-lg font-semibold mb-5">Monkeytype</h2>
      <p v-if="monkeyState === 'loading'" role="status" class="text-sm text-muted">{{ t('loading') }}</p>
      <p v-else-if="!monkey?.profile" role="status" class="text-sm text-muted">{{ t('unavailable') }}</p>
      <template v-else>
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-7">
          <div class="stats-metric"><dt>{{ t('completed') }}</dt><dd>{{ format(monkey.profile.completedTests) }}</dd></div>
          <div class="stats-metric"><dt>{{ t('typingTime') }}</dt><dd>{{ format(monkey.profile.timeTyping == null ? null : monkey.profile.timeTyping / 3600) }} h</dd></div>
          <div class="stats-metric"><dt>{{ t('best60') }}</dt><dd>{{ format(best60) }} <small>WPM</small></dd></div>
        </dl>
        <h3 class="text-sm font-semibold mb-2">{{ t('bests') }}</h3>
        <p class="text-xs text-muted mb-4">{{ t('bestNote') }}</p>
        <ul v-if="monkey.profile.bests.length" class="flex flex-wrap gap-3">
          <li v-for="best in monkey.profile.bests" :key="best.seconds" class="border border-fg/10 rounded-md px-4 py-3 text-sm font-mono">
            <span class="text-muted">{{ best.seconds }}s</span> <strong>{{ format(best.wpm) }} WPM</strong>
            <span class="block text-xs text-muted mt-1">{{ format(best.accuracy) }}% {{ t('accuracy') }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">{{ t('noBests') }}</p>
      </template>

      <div class="mt-8 border-t border-fg/10 pt-6">
        <h3 class="text-base font-semibold mb-3">{{ t('history') }}</h3>
        <p v-if="monkey?.history?.state === 'not-connected'" class="stats-empty">{{ t('notConnected') }}</p>
        <p v-else-if="monkeyState !== 'loading' && monkey?.history?.state !== 'ready'" role="status" class="stats-empty">{{ t('unavailable') }}</p>
        <template v-else-if="monkey?.history?.state === 'ready'">
          <p class="text-xs text-muted mb-4">{{ t('historyNote') }} <span v-if="monkey.history.stale">{{ t('stale') }}</span></p>
          <label class="text-xs text-muted block mb-4">{{ t('filter') }}
            <select v-model="mode" class="ml-3 bg-bg border border-fg/20 rounded px-2 py-2 text-fg">
              <option v-for="value in modes" :key="value" :value="value">{{ modeLabel(value) }}</option>
            </select>
          </label>
          <p v-if="!history.length" class="text-sm text-muted">{{ t('noTests') }}</p>
          <template v-else>
            <figure v-if="history.length > 1" class="mb-5">
              <svg viewBox="0 0 600 180" role="img" :aria-label="t('chart')" class="w-full h-auto text-accent">
                <path d="M24 25V155H576" fill="none" stroke="currentColor" opacity="0.25" />
                <text x="26" y="17" fill="currentColor" font-size="11">{{ chart.maximum }} WPM</text>
                <polyline :points="chart.points" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
              </svg>
              <figcaption class="text-xs text-muted flex justify-between"><span>{{ date(history[0].timestamp) }}</span><span>{{ date(history[history.length - 1].timestamp) }}</span></figcaption>
            </figure>
            <div class="overflow-x-auto">
              <table class="w-full text-sm text-left whitespace-nowrap">
                <caption class="text-left text-xs text-muted pb-3">{{ t('latest') }}</caption>
                <thead class="text-xs text-muted"><tr><th>{{ t('date') }}</th><th>WPM</th><th>{{ t('accuracy') }}</th><th>{{ t('mode') }}</th></tr></thead>
                <tbody><tr v-for="(result, index) in recent" :key="index" class="border-t border-fg/8"><td class="py-3 pr-4">{{ date(result.timestamp) }}</td><td class="pr-4 font-mono">{{ format(result.wpm) }}</td><td class="pr-4 font-mono">{{ format(result.accuracy) }}%</td><td>{{ result.mode }} {{ result.mode2 }} · {{ result.language }}</td></tr></tbody>
              </table>
            </div>
          </template>
          <p v-if="monkey.history.fetchedAt" class="text-xs text-muted mt-4">{{ t('updated') }} {{ date(monkey.history.fetchedAt) }}</p>
        </template>
      </div>
    </section>
  </article>
</template>

<style scoped>
.stats-section { padding: 24px; border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent); border-radius: 12px; min-width: 0; }
.stats-metric dt { font-size: 12px; color: var(--color-muted); }
.stats-metric dd { margin-top: 8px; font: 500 26px var(--font-mono); }
.stats-metric small { font-size: 12px; color: var(--color-muted); }
.stats-empty { padding: 16px; border: 1px dashed color-mix(in srgb, var(--color-fg) 15%, transparent); color: var(--color-muted); font-size: 14px; }
@media (max-width: 480px) { .stats-section { padding: 16px; } }
</style>
