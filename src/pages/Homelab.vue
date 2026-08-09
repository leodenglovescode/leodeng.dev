<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

// The endpoint is edge-cached for 30s, so polling faster than that just burns
// requests for the same bytes.
const POLL_MS = 30_000

const data = ref(null)
const error = ref(null)
const loading = ref(true)
// Ticks once a second purely so the "last seen 42s ago" line counts up between
// polls instead of sitting still for half a minute.
const nowMs = ref(Date.now())
// When the payload in `data` was received, so the age it reported can be aged
// forward. Reset on every successful fetch, or the drift only ever grows.
const loadedAt = ref(Date.now())

let pollTimer = null
let clockTimer = null

async function load() {
  try {
    const res = await fetch('/api/homelab', { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json()
    loadedAt.value = Date.now()
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
  clockTimer = setInterval(() => { nowMs.value = Date.now() }, 1000)
})

onBeforeUnmount(() => {
  clearInterval(pollTimer)
  clearInterval(clockTimer)
})

const current = computed(() => data.value?.current ?? null)

// The server reports how old its newest heartbeat was when it answered; this
// ages that forward locally. Comparing lastSeen against the browser's clock
// instead would show nonsense on any device whose time is off.
const age = computed(() => {
  if (!data.value?.seen) return null
  const sinceFetch = Math.floor((nowMs.value - loadedAt.value) / 1000)
  return data.value.ageSeconds + Math.max(0, sinceFetch)
})

const online = computed(() =>
  data.value?.seen && age.value != null && age.value <= (data.value.staleAfterSeconds ?? 180),
)

function formatUptime(seconds) {
  if (seconds == null) return 'N/A'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

function formatAge(seconds) {
  if (seconds == null) return 'N/A'
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Load average is only meaningful against the core count: 4.0 is saturated on
// four cores and idle on ninety-six.
const loadPct = computed(() => {
  if (!current.value?.cpus || current.value.load1 == null) return null
  return Math.min((current.value.load1 / current.value.cpus) * 100, 100)
})

const memPct = computed(() => {
  if (!current.value?.memTotal) return null
  return (current.value.memUsed / current.value.memTotal) * 100
})

// Builds an SVG polyline from a series, scaled to its own range so a flat-ish
// metric still shows its shape instead of a dead line at the bottom.
function sparkline(key, { width = 600, height = 40, pad = 3 } = {}) {
  const points = (data.value?.history ?? [])
    .map(h => h[key])
    .filter(v => v != null)
  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)

  const path = points
    .map((v, i) => {
      const x = i * step
      const y = height - pad - ((v - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return { path, min, max, width, height, points: points.length }
}

const loadSpark = computed(() => sparkline('load1'))
const memSpark = computed(() => sparkline('memPct'))
const tempSpark = computed(() => sparkline('temp'))

const hasHistory = computed(() => (data.value?.history?.length ?? 0) >= 2)
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Homelab</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">
      Pushed from the server every minute
    </p>

    <p v-if="loading" class="text-sm text-muted font-mono">Checking…</p>

    <p v-else-if="error" class="text-sm text-muted">
      Couldn't reach the status endpoint
      <span class="font-mono text-xs text-muted/90">({{ error }})</span>.
    </p>

    <p v-else-if="!data.seen" class="text-sm text-muted">
      No heartbeat recorded yet.
    </p>

    <template v-else>
      <!-- Status -->
      <div class="flex items-center gap-3 mb-10">
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0"
          :class="online ? 'bg-[#15a34a] dark:bg-[#4ade80] animate-pulse' : 'bg-[#dc2626] dark:bg-[#f87171]'"
        />
        <span class="text-lg font-semibold" :class="online ? 'text-fg' : 'text-muted'">
          {{ online ? 'Online' : 'Not responding' }}
        </span>
        <span class="text-xs font-mono text-muted">
          last heartbeat {{ formatAge(age) }}
        </span>
      </div>

      <p v-if="!online" class="text-sm text-muted mb-10">
        The box stopped checking in. Either it's down, or my internet is having a moment.
        From out here those look identical.
      </p>

      <!-- Headline numbers -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-fg/8 border border-fg/8 rounded-lg overflow-hidden mb-12">
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ formatUptime(current.uptime) }}</div>
          <div class="text-xs text-muted mt-1">uptime</div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">{{ current.load1?.toFixed(2) ?? 'N/A' }}</div>
          <div class="text-xs text-muted mt-1">
            load<template v-if="current.cpus"> · {{ current.cpus }} cores</template>
          </div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">
            {{ memPct == null ? 'N/A' : Math.round(memPct) + '%' }}
          </div>
          <div class="text-xs text-muted mt-1">memory</div>
        </div>
        <div class="bg-bg p-4">
          <div class="text-2xl font-semibold text-fg font-mono">
            {{ current.temp == null ? 'N/A' : Math.round(current.temp) + '°C' }}
          </div>
          <div class="text-xs text-muted mt-1">CPU temp</div>
        </div>
      </div>

      <!-- History -->
      <template v-if="hasHistory">
        <h3 class="text-sm font-mono text-fg uppercase tracking-widest mb-1">Last 24 hours</h3>
        <p class="text-xs text-muted mb-6">12-minute averages.</p>

        <div class="space-y-6">
          <div v-for="chart in [
            { spark: loadSpark, label: 'Load', unit: '' },
            { spark: memSpark, label: 'Memory', unit: '%' },
            { spark: tempSpark, label: 'CPU temp', unit: '°C' },
          ]" :key="chart.label">
            <template v-if="chart.spark">
              <div class="flex justify-between items-baseline text-xs font-mono mb-1.5">
                <span class="text-muted uppercase tracking-wider">{{ chart.label }}</span>
                <span class="text-muted/90">
                  {{ chart.spark.min.toFixed(chart.unit === '' ? 2 : 0) }}{{ chart.unit }}
                  to
                  {{ chart.spark.max.toFixed(chart.unit === '' ? 2 : 0) }}{{ chart.unit }}
                </span>
              </div>
              <svg
                class="w-full block"
                :viewBox="`0 0 ${chart.spark.width} ${chart.spark.height}`"
                :height="chart.spark.height"
                preserveAspectRatio="none"
                role="img"
                :aria-label="`${chart.label} over the last 24 hours, ${chart.spark.min} to ${chart.spark.max}${chart.unit}`"
              >
                <polyline
                  :points="chart.spark.path"
                  fill="none"
                  stroke="currentColor"
                  class="text-accent"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </svg>
            </template>
          </div>
        </div>
      </template>

      <p class="text-xs text-muted/90 font-mono mt-12">
        Uptime, load, memory and temperature. Nothing that says what runs on it.
      </p>
    </template>
  </section>
</template>
