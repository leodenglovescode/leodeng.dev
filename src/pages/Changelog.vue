<script setup>
import { ref, computed } from 'vue'
import data from '../generated/changelog.json'

// Generated at build time by scripts/build-changelog.js from the repo's git
// history, so this page can't drift out of date the way a hand-written
// changelog does.
const REPO_URL = `https://github.com/${data.repo}`

const TYPES = {
  feat:    { label: 'Feature', color: 'var(--color-accent)' },
  fix:     { label: 'Fix',     color: '#fb923c' },
  content: { label: 'Post',    color: '#4ade80' },
  chore:   { label: 'Chore',   color: 'var(--color-muted)' },
  other:   { label: 'Change',  color: 'var(--color-muted)' },
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const filter = ref('all')

const counts = computed(() => {
  const c = { all: data.commits.length }
  for (const commit of data.commits) c[commit.type] = (c[commit.type] ?? 0) + 1
  return c
})

// Only offer filters that would actually return something.
const filters = computed(() => [
  { key: 'all', label: 'Everything' },
  ...Object.keys(TYPES)
    .filter(key => counts.value[key])
    .map(key => ({ key, label: TYPES[key].label })),
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
      groups.push({ key, label: `${MONTHS[month - 1]} ${year}`, commits: [] })
    }
    groups.at(-1).commits.push(commit)
  }
  return groups
})

function meta(type) {
  return TYPES[type] ?? TYPES.other
}

function subjectText(subject) {
  return String(subject || '').replace(/\s*[—–]\s*/g, ': ')
}
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Changelog</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      Every commit to this site, straight from
      <a :href="REPO_URL" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">the repo</a>.
    </p>

    <div v-if="!data.commits.length" class="text-sm text-muted italic">
      No history available. Try
      <a :href="REPO_URL" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">GitHub</a>
      instead.
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
                :title="`${commit.date}: view on GitHub`"
              >{{ commit.hash.slice(0, 7) }}</a>
            </div>
          </li>
        </ul>
      </div>

      <p class="text-xs text-muted/90 font-mono mt-12">
        {{ data.commits.length }} commits · index rebuilt {{ data.generatedAt }}.
      </p>
    </template>
  </section>
</template>
