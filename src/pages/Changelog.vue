<script setup>
import { ref, computed } from 'vue'
import data from '../generated/changelog.json'
import { useLocale } from '../utils/i18n.js'

const { isZh, t } = useLocale('changelog')

// Generated at build time by scripts/build-changelog.js from the repo's git
// history, so this page can't drift out of date the way a hand-written
// changelog does.
const REPO_URL = `https://github.com/${data.repo}`

const TYPES = {
  feat:    { color: 'var(--color-accent)' },
  fix:     { color: '#fb923c' },
  content: { color: '#4ade80' },
  chore:   { color: 'var(--color-muted)' },
  other:   { color: 'var(--color-muted)' },
}
const typeLabels = computed(() => t('types'))

const filter = ref('all')

const counts = computed(() => {
  const c = { all: data.commits.length }
  for (const commit of data.commits) c[commit.type] = (c[commit.type] ?? 0) + 1
  return c
})

// Only offer filters that would actually return something.
const filters = computed(() => [
  { key: 'all', label: t('everything') },
  ...Object.keys(TYPES)
    .filter(key => counts.value[key])
    .map(key => ({ key, label: typeLabels.value[key] })),
])

const visible = computed(() =>
  filter.value === 'all' ? data.commits : data.commits.filter(c => c.type === filter.value),
)

// Commits already arrive newest-first from git log; grouping preserves that.
const months = computed(() => {
  const groups = []
  for (const commit of visible.value) {
    const key = commit.date.slice(0, 7)
    if (groups.at(-1)?.key !== key) {
      const [year, month] = key.split('-').map(Number)
      const date = new Date(Date.UTC(year, month - 1, 1))
      groups.push({
        key,
        label: new Intl.DateTimeFormat(isZh.value ? 'zh-CN' : 'en-US', {
          month: 'long', year: 'numeric', timeZone: 'UTC',
        }).format(date),
        commits: [],
      })
    }
    groups.at(-1).commits.push(commit)
  }
  return groups
})

function meta(type) {
  const value = TYPES[type] ?? TYPES.other
  return { ...value, label: typeLabels.value[type] ?? typeLabels.value.other }
}

function subjectText(subject) {
  return String(subject || '').replace(/\s*[—–]\s*/g, ': ')
}
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('changelog') }}</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      {{ t('everyCommitToThisSiteStraightFrom') }}
      <a :href="REPO_URL" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">{{ t('theRepo') }}</a>{{ t('period') }}
    </p>

    <div v-if="!data.commits.length" class="text-sm text-muted italic">
      {{ t('noHistoryAvailableTry') }}
      <a :href="REPO_URL" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">GitHub</a>
      {{ t('instead') }}
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-2 mb-10">
        <button
          v-for="f in filters"
          :key="f.key"
          @click="filter = f.key"
          :class="[
            'text-xs font-mono px-2.5 py-1 rounded-full border transition-colors',
            filter === f.key
              ? 'border-accent text-fg'
              : 'border-fg/10 text-muted hover:text-fg hover:border-fg/25',
          ]"
        >
          {{ f.label }}
          <span class="text-muted">{{ counts[f.key] }}</span>
        </button>
      </div>

      <div v-for="group in months" :key="group.key" class="mb-10">
        <h3 class="text-xs font-mono text-muted uppercase tracking-widest mb-4">
          {{ group.label }}
        </h3>

        <ul class="border-l border-fg/10 space-y-4 pl-5">
          <li v-for="commit in group.commits" :key="commit.hash" class="relative">
            <!-- Timeline dot, pulled out onto the rule -->
            <span
              class="absolute -left-[23px] top-[0.45rem] w-[7px] h-[7px] rounded-full ring-3 ring-bg"
              :style="{ background: meta(commit.type).color }"
            />

            <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span
                class="text-xs font-mono uppercase tracking-wider"
                :style="{ color: meta(commit.type).color }"
              >{{ meta(commit.type).label }}</span>

              <span class="text-sm text-fg flex-1 min-w-0">
                <span v-if="commit.scope" class="font-mono text-muted">{{ commit.scope }}: </span>{{ subjectText(commit.subject) }}
              </span>

              <a
                :href="`${REPO_URL}/commit/${commit.hash}`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs font-mono text-muted hover:text-accent transition-colors shrink-0"
                :title="`${commit.date}: ${t('viewOnGithub')}`"
              >{{ commit.hash.slice(0, 7) }}</a>
            </div>
          </li>
        </ul>
      </div>

      <p class="text-xs text-muted/90 font-mono mt-12">
        {{ t('commits', { p0: data.commits.length }) }} · {{ t('indexRebuilt') }} {{ data.generatedAt }}{{ t('period') }}
      </p>
    </template>
  </section>
</template>
