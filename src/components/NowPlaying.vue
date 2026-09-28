<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const POLL_INTERVAL_MS = 10_000
const REQUEST_TIMEOUT_MS = 5_000
const STALE_AFTER_MS = 35_000

const nowPlaying = ref(null)
const progressClock = ref(0)

let pollTimer = null
let progressTimer = null
let activeRequest = null
let lastSuccessfulFetchAt = 0

const positionMs = computed(() => {
  const track = nowPlaying.value
  if (!track) return 0

  const elapsed = Math.max(0, progressClock.value - track.syncedAt)
  return Math.min(track.durationMs, track.syncedPositionMs + elapsed)
})

const progressPercent = computed(() => {
  const duration = nowPlaying.value?.durationMs ?? 0
  if (duration <= 0) return 0
  return Math.min(100, (positionMs.value / duration) * 100)
})

const byline = computed(() => {
  const track = nowPlaying.value
  if (!track) return ''
  return track.album ? `${track.artist} · ${track.album}` : track.artist
})

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function validPayload(payload) {
  return payload?.playing === true
    && typeof payload.title === 'string'
    && payload.title.length > 0
    && typeof payload.artist === 'string'
    && payload.artist.length > 0
    && Number.isFinite(payload.durationMs)
    && payload.durationMs > 0
    && Number.isFinite(payload.positionMs)
    && Number.isFinite(payload.observedAt)
}

async function refreshNowPlaying() {
  activeRequest?.abort()
  const controller = new AbortController()
  activeRequest = controller
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('/api/now-playing', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (response.status === 204) {
      lastSuccessfulFetchAt = Date.now()
      nowPlaying.value = null
      return
    }

    if (!response.ok) throw new Error(`Now-playing request failed with ${response.status}`)

    const payload = await response.json()
    lastSuccessfulFetchAt = Date.now()
    if (!validPayload(payload)) {
      nowPlaying.value = null
      return
    }

    const responseDate = Date.parse(response.headers.get('date') ?? '')
    const serverNow = Number.isFinite(responseDate)
      ? responseDate
      : Number(payload.serverNow) || payload.observedAt
    const ageAtResponse = Math.min(STALE_AFTER_MS, Math.max(0, serverNow - payload.observedAt))
    const syncedAt = performance.now()

    nowPlaying.value = {
      title: payload.title,
      artist: payload.artist,
      album: typeof payload.album === 'string' ? payload.album : '',
      durationMs: payload.durationMs,
      syncedPositionMs: Math.min(payload.durationMs, Math.max(0, payload.positionMs + ageAtResponse)),
      syncedAt,
    }
    progressClock.value = syncedAt
  } catch (error) {
    if (error.name !== 'AbortError' || controller === activeRequest) {
      if (!lastSuccessfulFetchAt || Date.now() - lastSuccessfulFetchAt > STALE_AFTER_MS) {
        nowPlaying.value = null
      }
    }
  } finally {
    window.clearTimeout(timeout)
    if (activeRequest === controller) activeRequest = null
  }
}

onMounted(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  progressClock.value = performance.now()
  void refreshNowPlaying()
  pollTimer = window.setInterval(refreshNowPlaying, POLL_INTERVAL_MS)
  progressTimer = window.setInterval(() => {
    progressClock.value = performance.now()
  }, reduceMotion ? 1000 : 250)
})

onBeforeUnmount(() => {
  activeRequest?.abort()
  window.clearInterval(pollTimer)
  window.clearInterval(progressTimer)
})
</script>

<template>
  <Transition name="now-playing">
    <aside
      v-if="nowPlaying"
      class="mx-auto w-full max-w-72 rounded-xl bg-fg/[0.035] p-3 sm:max-w-none"
      aria-label="Leo is now playing"
    >
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-2xl text-accent"
          aria-hidden="true"
        >
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l11-2v13" />
            <path d="m9 9 11-2" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-1.5 font-mono text-[11px] text-accent">
            <span class="now-playing-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            Leo is now playing
          </p>
          <p class="mt-1 text-sm font-semibold leading-snug text-fg" :title="nowPlaying.title">
            {{ nowPlaying.title }}
          </p>
          <p class="mt-0.5 text-xs leading-snug text-muted" :title="byline">
            {{ byline }}
          </p>
        </div>
      </div>

      <div class="mt-3">
        <div
          class="h-1 overflow-hidden rounded-full bg-fg/10"
          role="progressbar"
          aria-label="Song progress"
          aria-valuemin="0"
          :aria-valuemax="Math.round(nowPlaying.durationMs / 1000)"
          :aria-valuenow="Math.round(positionMs / 1000)"
        >
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-300 ease-linear"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <div class="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-muted">
          <span>{{ formatTime(positionMs) }}</span>
          <span>{{ formatTime(nowPlaying.durationMs) }}</span>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.now-playing-enter-active,
.now-playing-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.now-playing-enter-from,
.now-playing-leave-to {
  opacity: 0;
  transform: translateY(-0.375rem);
}

.now-playing-pulse {
  animation: now-playing-pulse 1.5s ease-in-out infinite;
}

@keyframes now-playing-pulse {
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .now-playing-enter-active,
  .now-playing-leave-active {
    transition: none;
  }

  .now-playing-pulse {
    animation: none;
  }
}
</style>
