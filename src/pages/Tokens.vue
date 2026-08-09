<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

// The endpoint is edge-cached for 60s, so polling faster than that just burns
// requests for the same bytes.
const POLL_MS = 60_000

const data = ref(null)
const error = ref(null)
const loading = ref(true)

// Which window the range-scoped sections describe. The all-time total and
// today's number sit outside this and never move: those are the two figures
// worth being able to read without touching anything.
const range = ref('d30')
const RANGES = [
  { key: 'd7', label: '7 days', days: 7 },
  { key: 'd30', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
]

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
const active = computed(() => data.value?.ranges?.[range.value] ?? null)
const activeLabel = computed(() => RANGES.find(r => r.key === range.value)?.label ?? '')

// Billions of tokens don't fit in a stat tile, and nobody reads the digits
// anyway: the exact figure goes in the `title` attribute for whoever wants it.
function compact(n) {
  if (n == null) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

const full = n => (n == null ? 'N/A' : n.toLocaleString())

const pad = n => String(n).padStart(2, '0')
const asDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Counted back from the newest day with data rather than from the browser's
// clock, so the window matches the one the server priced. Formatted by hand
// because toISOString() would convert to UTC first and can land a day early.
const cutoff = computed(() => {
  const spec = RANGES.find(r => r.key === range.value)
  if (!spec?.days || !totals.value) return null
  const from = new Date(`${totals.value.lastDay}T00:00:00`)
  from.setDate(from.getDate() - (spec.days - 1))
  return asDay(from)
})

const chartDays = computed(() => {
  const days = data.value?.daily ?? []
  const from = cutoff.value
  return from ? days.filter(d => d.day >= from) : days
})

// Bars are sized against the busiest day in view rather than the total, so a
// quiet week still shows its shape instead of collapsing to nothing.
const dailyMax = computed(() => Math.max(...chartDays.value.map(d => d.tokens), 1))

const busiest = computed(() => {
  const days = chartDays.value
  if (!days.length) return null
  return days.reduce((best, d) => (d.tokens > best.tokens ? d : best), days[0])
})

// The viewer's timezone need not match the server's, so only call it "today"
// when it really is today for whoever is looking.
const todayIsToday = computed(() => today.value?.day === new Date().toLocaleDateString('en-CA'))

const todayLabel = computed(() => {
  if (!today.value) return 'latest day'
  if (todayIsToday.value) return 'today'
  return new Date(`${today.value.day}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
})

// Where the tokens actually went, for the selected window. On a cache-heavy
// agentic workload this is the whole story: cache reads dwarf everything else
// by two orders of magnitude.
const composition = computed(() => {
  const a = active.value
  if (!a) return []
  const parts = [
    { label: 'Cache read', value: a.cacheRead, class: 'bg-accent' },
    { label: 'Cache write', value: a.cacheWrite5m + a.cacheWrite1h, class: 'bg-accent/55' },
    { label: 'Output', value: a.output, class: 'bg-highlight' },
    { label: 'Input', value: a.input, class: 'bg-fg/40' },
  ]
  const sum = parts.reduce((t, p) => t + p.value, 0) || 1
  return parts.map(p => ({ ...p, pct: (p.value / sum) * 100 }))
})

// Kept out of the template on purpose: a bare `<` inside a mustache is asking
// the template compiler to guess whether it starts a tag.
function pctLabel(pct) {
  if (pct > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

const modelMax = computed(() => Math.max(...(data.value?.byModel ?? []).map(m => m.tokens), 1))

function dayTitle(d) {
  return `${d.day}: ${full(d.tokens)} tokens across ${full(d.messages)} responses`
}

const money = n =>
  n == null
    ? 'N/A'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Tokens</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      LLM token usage, pushed from the
      <RouterLink to="/homelab" class="text-fg hover:text-accent transition-colors">server</RouterLink>
    </p>

    <p v-if="loading" class="text-sm text-muted font-mono">Counting…</p>

    <p v-else-if="error" class="text-sm text-muted">
      Couldn't reach the token endpoint
      <span class="font-mono text-xs text-muted/90">({{ error }})</span>.
    </p>

    <p v-else-if="!data.seen" class="text-sm text-muted">
      Nothing pushed yet. The agent hasn't reported any usage.
    </p>

    <template v-else>
      <!-- The two numbers that never move with the range switcher -->
      <div class="grid grid-cols-2 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-6">
        <div class="bg-bg p-5">
          <div class="text-3xl font-semibold text-fg font-mono" :title="full(totals.tokens)">
            {{ compact(totals.tokens) }}
          </div>
          <div class="text-xs text-muted mt-1">tokens, all time</div>
        </div>
        <div class="bg-bg p-5">
          <div class="text-3xl font-semibold text-fg font-mono" :title="full(today?.tokens ?? 0)">
            {{ compact(today?.tokens ?? 0) }}
          </div>
          <div class="text-xs text-muted mt-1">tokens {{ todayLabel }}</div>
        </div>
      </div>

      <p class="text-xs text-muted mb-12">
        {{ totals.firstDay }} to {{ totals.lastDay }} · {{ full(totals.days) }} days with usage ·
        {{ full(totals.messages) }} API responses<template v-if="totals.sessions">
        · {{ full(totals.sessions) }} sessions</template>. Counted from local session logs,
        deduplicated per response, and archived so the total survives the logs being pruned.
      </p>

      <!-- Range switcher -->
      <div class="flex items-center gap-1 mb-8" role="group" aria-label="Time range">
        <button
          v-for="r in RANGES"
          :key="r.key"
          type="button"
          class="px-3 py-1.5 text-xs font-mono rounded-md border transition-colors"
          :class="range === r.key
            ? 'bg-accent-strong text-white border-transparent'
            : 'border-fg/12 text-muted hover:text-fg hover:border-fg/25'"
          :aria-pressed="range === r.key"
          @click="range = r.key"
        >
          {{ r.label }}
        </button>
      </div>

      <!-- Range-scoped numbers -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-14">
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono" :title="full(active.tokens)">
            {{ compact(active.tokens) }}
          </div>
          <div class="text-xs text-muted mt-1">tokens</div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ full(active.messages) }}</div>
          <div class="text-xs text-muted mt-1">responses</div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ full(active.days) }}</div>
          <div class="text-xs text-muted mt-1">days with usage</div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ money(active.cost) }}</div>
          <div class="text-xs text-muted mt-1">at list price</div>
        </div>
      </div>

      <!-- Per day -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">Per day</h3>
      <p class="text-xs text-muted mb-5">
        {{ activeLabel }}.
        <template v-if="busiest">Busiest was {{ busiest.day }}, {{ compact(busiest.tokens) }}.</template>
      </p>
      <div class="flex items-end gap-[2px] h-32 mb-2">
        <div
          v-for="d in chartDays"
          :key="d.day"
          class="flex-1 rounded-t-[2px] min-h-0"
          :class="d.day === today?.day ? 'bg-highlight' : 'bg-accent/70'"
          :style="{ height: d.tokens > 0 ? `${Math.max((d.tokens / dailyMax) * 100, 2)}%` : '0%' }"
          :title="dayTitle(d)"
        />
      </div>
      <div v-if="chartDays.length" class="flex justify-between text-xs font-mono text-muted mb-14">
        <span>{{ chartDays[0].day }}</span>
        <span>{{ chartDays[chartDays.length - 1].day }}</span>
      </div>

      <!-- Where they go -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">Where they go</h3>
      <p class="text-xs text-muted mb-5">
        Cache reads are almost all of it. That's the point of the cache. Re-sending a
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

      <!-- Models -->
      <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">By model</h3>
      <p class="text-xs text-muted mb-5">All time.</p>
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
          <span class="text-xs font-mono text-muted uppercase tracking-widest">
            List-price equivalent · {{ activeLabel }}
          </span>
          <span class="text-2xl font-semibold text-fg font-mono">{{ money(active.cost) }}</span>
        </div>
        <p class="text-xs text-muted">
          What this usage would have cost on the API at list price. Input and output per
          model, cache reads at a tenth of the input rate, cache writes at 1.25× or 2×
          depending on how long they live. It is
          <em class="not-italic text-fg">not a bill</em>: this runs on a subscription, so
          none of it was charged per token.
          <template v-if="active.unpricedTokens > 0">
            {{ compact(active.unpricedTokens) }} tokens came from models with no rate in the
            table and are left out of this figure.
          </template>
          Copilot VS Code totals are estimates from visible transcript history; its hidden
          system prompts and tool results are not stored locally.
        </p>
      </div>

      <p class="text-xs text-muted/90 font-mono mt-12">
        Counts only. No prompts, no file paths, no project names.
      </p>
    </template>
  </section>
</template>
