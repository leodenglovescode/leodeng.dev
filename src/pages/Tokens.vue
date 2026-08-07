<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

// The endpoint is edge-cached for 60s, so polling faster than that just burns
// requests for the same bytes.
const POLL_MS = 60_000

const data = ref(null)
const error = ref(null)
const loading = ref(true)

let pollTimer = null

async function load() {
  try {
    const res = await fetch('/api/tokens', { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json()
    error.value = null
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  pollTimer = setInterval(load, POLL_MS)
})

onBeforeUnmount(() => clearInterval(pollTimer))

const totals = computed(() => data.value?.totals ?? null)
const today = computed(() => data.value?.today ?? null)

// Billions of tokens don't fit in a stat tile, and nobody reads the digits
// anyway — the exact figure goes in the `title` attribute for whoever wants it.
function compact(n) {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

const full = n => (n == null ? '—' : n.toLocaleString())

// The rollup buckets days in the server's timezone, which is not necessarily
// the reader's. Calling a day "today" only when it really is today for whoever
// is looking beats confidently mislabelling it for eight hours a day.
const viewerToday = () => new Date().toLocaleDateString('en-CA')

const todayIsToday = computed(() => today.value?.day === viewerToday())

const todayLabel = computed(() => {
  if (!today.value) return 'latest day'
  if (todayIsToday.value) return 'today'
  return new Date(`${today.value.day}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
})

const headline = computed(() => {
  if (!totals.value) return []
  return [
    { value: compact(totals.value.tokens), exact: full(totals.value.tokens), label: 'tokens, all time' },
    { value: compact(today.value?.tokens ?? 0), exact: full(today.value?.tokens ?? 0), label: `tokens ${todayLabel.value}` },
    { value: full(totals.value.messages), exact: full(totals.value.messages), label: 'API responses' },
    { value: full(totals.value.days), exact: full(totals.value.days), label: 'days with usage' },
  ]
})

// Where the tokens actually went. On a Claude Code workload this is the whole
// story: cache reads dwarf everything else by two orders of magnitude, which
// is what the split is here to show.
const composition = computed(() => {
  const t = totals.value
  if (!t) return []
  const parts = [
    { label: 'Cache read', value: t.cacheRead, class: 'bg-accent' },
    { label: 'Cache write', value: t.cacheWrite5m + t.cacheWrite1h, class: 'bg-accent/55' },
    { label: 'Output', value: t.output, class: 'bg-highlight' },
    { label: 'Input', value: t.input, class: 'bg-fg/40' },
  ]
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1
  return parts.map(p => ({ ...p, pct: (p.value / total) * 100 }))
})

// Bars are sized against the busiest day rather than the total, so a quiet
// week still shows its shape instead of collapsing to nothing.
const dailyMax = computed(() =>
  Math.max(...(data.value?.daily ?? []).map(d => d.tokens), 1),
)

const busiest = computed(() => {
  const days = data.value?.daily ?? []
  if (!days.length) return null
  return days.reduce((best, d) => (d.tokens > best.tokens ? d : best), days[0])
})

function dayTitle(d) {
  return `${d.day} — ${full(d.tokens)} tokens across ${full(d.messages)} responses`
}

const hasDaily = computed(() => (data.value?.daily?.length ?? 0) >= 2)

const modelMax = computed(() =>
  Math.max(...(data.value?.byModel ?? []).map(m => m.tokens), 1),
)

// Kept out of the template on purpose: a bare `<` inside a mustache is asking
// the template compiler to guess whether it starts a tag.
function pctLabel(pct) {
  if (pct > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

const money = n =>
  n == null
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Tokens</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      Claude Code usage, pushed from the
      <RouterLink to="/homelab" class="text-fg hover:text-accent transition-colors">server</RouterLink>
    </p>

    <p v-if="loading" class="text-sm text-muted font-mono">Counting…</p>

    <p v-else-if="error" class="text-sm text-muted">
      Couldn't reach the token endpoint
      <span class="font-mono text-xs text-muted/90">({{ error }})</span>.
    </p>

    <p v-else-if="!data.seen" class="text-sm text-muted">
      Nothing pushed yet — the agent hasn't reported any usage.
    </p>

    <template v-else>
      <!-- Headline numbers -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-6">
        <div v-for="stat in headline" :key="stat.label" class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono" :title="stat.exact">{{ stat.value }}</div>
          <div class="text-xs text-muted mt-1">{{ stat.label }}</div>
        </div>
      </div>

      <p class="text-xs text-muted mb-14">
        {{ totals.firstDay }} — {{ totals.lastDay }}<template v-if="totals.sessions">
        · {{ full(totals.sessions) }} sessions</template>. Counted from the transcripts
        Claude Code writes locally, deduplicated per API response.
      </p>

      <!-- Where the tokens go -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">Where they go</h3>
      <p class="text-xs text-muted mb-5">
        Cache reads are almost all of it. That's the point of the cache — re-sending a
        long conversation costs a tenth of reading it fresh.
      </p>
      <div class="flex h-3 rounded-full overflow-hidden bg-fg/8 mb-3">
        <div
          v-for="part in composition"
          :key="part.label"
          :class="part.class"
          :style="{ width: `${part.pct}%` }"
          :title="`${part.label}: ${full(part.value)}`"
        />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-14">
        <div v-for="part in composition" :key="part.label" class="flex items-baseline gap-2">
          <span class="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" :class="part.class" />
          <span class="text-xs text-muted">{{ part.label }}</span>
          <span class="text-xs font-mono text-fg ml-auto" :title="full(part.value)">
            {{ pctLabel(part.pct) }}
          </span>
        </div>
      </div>

      <!-- Daily -->
      <template v-if="hasDaily">
        <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">Per day</h3>
        <p class="text-xs text-muted mb-5">
          Last {{ data.windowDays }} days.
          <template v-if="busiest">
            Busiest was {{ busiest.day }}, {{ compact(busiest.tokens) }}.
          </template>
        </p>
        <div class="flex items-end gap-[2px] h-32 mb-2">
          <div
            v-for="d in data.daily"
            :key="d.day"
            class="flex-1 rounded-t-[2px] min-h-0"
            :class="d.day === today?.day ? 'bg-highlight' : 'bg-accent/70'"
            :style="{ height: d.tokens > 0 ? `${Math.max((d.tokens / dailyMax) * 100, 2)}%` : '0%' }"
            :title="dayTitle(d)"
          />
        </div>
        <div class="flex justify-between text-xs font-mono text-muted mb-14">
          <span>{{ data.daily[0].day }}</span>
          <span>{{ data.daily[data.daily.length - 1].day }}</span>
        </div>
      </template>

      <!-- Models -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-5">By model</h3>
      <div class="space-y-4 mb-14">
        <div v-for="m in data.byModel" :key="m.model">
          <div class="flex justify-between items-baseline text-xs font-mono mb-1.5">
            <span class="text-fg">{{ m.label }}</span>
            <span class="text-muted" :title="full(m.tokens)">
              {{ compact(m.tokens) }} · {{ full(m.messages) }} responses
            </span>
          </div>
          <div class="h-2 rounded-full bg-fg/8 overflow-hidden">
            <div
              class="h-full bg-accent rounded-full"
              :style="{ width: `${Math.max((m.tokens / modelMax) * 100, 1)}%` }"
            />
          </div>
        </div>
      </div>

      <!-- Cost -->
      <div class="border border-fg/8 rounded-lg p-5">
        <div class="flex items-baseline justify-between gap-4 mb-2">
          <span class="text-xs font-mono text-muted uppercase tracking-widest">List-price equivalent</span>
          <span class="text-2xl font-semibold text-fg font-mono">{{ money(data.cost) }}</span>
        </div>
        <p class="text-xs text-muted">
          What this usage would have cost on the Anthropic API at list price — input and
          output per model, cache reads at a tenth of the input rate, cache writes at
          1.25× or 2× depending on how long they live. It is
          <em class="not-italic text-fg">not a bill</em>: this runs on a subscription, so
          none of it was charged per token.
          <template v-if="data.unpricedTokens > 0">
            {{ compact(data.unpricedTokens) }} tokens came from models with no rate in the
            table and are left out of this figure.
          </template>
        </p>
      </div>

      <p class="text-xs text-muted/90 font-mono mt-12">
        Counts only — no prompts, no file paths, no project names.
      </p>
    </template>
  </section>
</template>
