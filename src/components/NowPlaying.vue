<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
import SyncedLyrics from './SyncedLyrics.vue'
import { playbackSources } from '../utils/nowPlaying.js'

const { t } = useLocale('common')

const IDLE_POLL_INTERVAL_MS = 5_000
const PLAYING_POLL_INTERVAL_MS = 2_000
const REQUEST_TIMEOUT_MS = 5_000
const STALE_AFTER_MS = 35_000

const sources = ref([])
const selectedId = ref('')
const progressClock = ref(0)
const activeSources = computed(() => sources.value.filter(source => source.expiresAt >= progressClock.value))
const nowPlaying = computed(() => activeSources.value.find(source => source.id === selectedId.value) || activeSources.value[0] || null)
const artworkFailed = ref(false)
const artworkUrl = computed(() => {
  try {
    const url = new URL(nowPlaying.value?.artworkUrl || '')
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
})
watch(artworkUrl, () => { artworkFailed.value = false })

let pollTimer = null
let progressTimer = null
let activeRequest = null
let lastSuccessfulFetchAt = 0
let stopped = false

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

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

async function refreshNowPlaying() {
  if (stopped) return
  window.clearTimeout(pollTimer)
  activeRequest?.abort()
  const controller = new AbortController()
  activeRequest = controller
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = performance.now()

  try {
    const response = await fetch('/api/now-playing', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (response.status === 204) {
      lastSuccessfulFetchAt = Date.now()
      sources.value = []
      return
    }

    if (!response.ok) throw new Error(`Now-playing request failed with ${response.status}`)

    const payload = await response.json()
    lastSuccessfulFetchAt = Date.now()
    const responseDate = Date.parse(response.headers.get('date') ?? '')
    const serverNow = Number.isFinite(responseDate)
      ? responseDate
      : Number(payload.serverNow) || payload.observedAt
    const syncedAt = performance.now()
    sources.value = playbackSources(payload, serverNow, syncedAt)
    if (!sources.value.some(source => source.id === selectedId.value)) selectedId.value = sources.value[0]?.id || ''
    progressClock.value = syncedAt
  } catch (error) {
    if (error.name !== 'AbortError' || controller === activeRequest) {
      if (!lastSuccessfulFetchAt || Date.now() - lastSuccessfulFetchAt > STALE_AFTER_MS) {
        sources.value = []
      }
    }
  } finally {
    window.clearTimeout(timeout)
    if (activeRequest === controller) {
      activeRequest = null
      if (!stopped) {
        const interval = nowPlaying.value ? PLAYING_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
        pollTimer = window.setTimeout(refreshNowPlaying, Math.max(0, interval - (performance.now() - startedAt)))
      }
    }
  }
}

onMounted(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  progressClock.value = performance.now()
  void refreshNowPlaying()
  progressTimer = window.setInterval(() => {
    progressClock.value = performance.now()
  }, reduceMotion ? 1000 : 250)
})

onBeforeUnmount(() => {
  stopped = true
  activeRequest?.abort()
  window.clearTimeout(pollTimer)
  window.clearInterval(progressTimer)
})
</script>

<template>
  <Transition name="now-playing">
    <aside
      v-if="nowPlaying"
      class="mx-auto w-full max-w-72 rounded-xl bg-fg/[0.035] p-3 sm:max-w-none"
      :aria-label="nowPlaying.device ? t('deviceIsNowPlaying', { device: nowPlaying.device }) : t('leoIsNowPlaying')"
    >
      <p class="mb-2 flex items-center gap-1.5 font-mono text-[11px] text-accent">
        <span class="now-playing-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ nowPlaying.device ? t('deviceIsNowPlaying', { device: nowPlaying.device }) : t('leoIsNowPlaying') }}</span>
        <span v-if="activeSources.length > 1" class="ml-auto shrink-0 whitespace-nowrap self-start text-muted">{{ t('playingDevices', { count: activeSources.length }) }}</span>
      </p>
      <div v-if="activeSources.length > 1" class="mb-3 flex flex-wrap gap-1.5" role="group" :aria-label="t('choosePlayingDevice')">
        <button
          v-for="source in activeSources" :key="source.id" type="button"
          :aria-pressed="nowPlaying.id === source.id"
          class="max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          :class="nowPlaying.id === source.id ? 'border-accent/40 bg-accent/10 text-accent' : 'border-fg/10 text-muted hover:text-fg'"
          :title="source.device" @click="selectedId = source.id"
        >{{ source.device || t('musicDevice') }}</button>
      </div>
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="now-playing-artwork relative flex h-18 w-18 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent/10 text-2xl text-accent"
          aria-hidden="true"
        >
          <img
            v-if="artworkUrl && !artworkFailed"
            :key="artworkUrl"
            :src="artworkUrl"
            alt=""
            width="72"
            height="72"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="artworkFailed = true"
          />
          <svg v-else class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l11-2v13" />
            <path d="m9 9 11-2" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-snug text-fg" :title="nowPlaying.title">
            {{ nowPlaying.title }}
          </p>
          <p class="mt-0.5 text-xs leading-snug text-muted" :title="nowPlaying.artist">
            {{ nowPlaying.artist }}
          </p>
          <p v-if="nowPlaying.album" class="mt-0.5 text-[12px] leading-snug text-muted/80" :title="nowPlaying.album">
            {{ nowPlaying.album }}
          </p>
        </div>
      </div>

      <div class="mt-3">
        <div
          class="h-1 overflow-hidden rounded-full bg-fg/10"
          role="progressbar"
          :aria-label="t('songProgress')"
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
      <SyncedLyrics :track="nowPlaying" :position-ms="positionMs" />
    </aside>
  </Transition>
</template>

<style scoped>
.now-playing-artwork img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  margin: 0;
  border-radius: 0;
  object-fit: cover;
}

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
