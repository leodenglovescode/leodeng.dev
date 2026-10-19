<script setup>
import { computed, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { currentLyricIndex, parseSyncedLyrics } from '../utils/lyrics.js'

const props = defineProps({ track: { type: Object, required: true }, positionMs: { type: Number, required: true } })
const { t } = useLocale('common')
const lines = ref([])
const activeIndex = computed(() => currentLyricIndex(lines.value, props.positionMs))
const signature = computed(() => JSON.stringify([props.track.title, props.track.artist, props.track.album, props.track.durationMs]))

// A component-local cache survives track switches without storing lyrics on disk.
const cache = new Map()
watch(signature, async (_, __, onCleanup) => {
  lines.value = []
  const key = signature.value
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    lines.value = cached.lines
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let cancelled = false
  onCleanup(() => { cancelled = true; controller.abort(); clearTimeout(timeout) })
  const track = props.track
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist, duration: String(track.durationMs / 1000) })
  if (track.album) query.set('album_name', track.album)
  try {
    const response = await fetch(`https://lrclib.net/api/get?${query}`, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok && response.status !== 404) return
    const result = response.ok ? await response.json() : null
    if (cancelled) return
    // Reject different edits of a recording even if their titles match.
    const parsed = result && !result.instrumental && Number.isFinite(result.duration)
      && Math.abs(result.duration * 1000 - track.durationMs) <= 2000
      ? parseSyncedLyrics(result.syncedLyrics) : []
    lines.value = parsed.some(line => line.text) ? parsed : []
    cache.delete(key)
    cache.set(key, { lines: lines.value, expiresAt: Date.now() + (lines.value.length ? 86_400_000 : 600_000) })
    if (cache.size > 20) cache.delete(cache.keys().next().value)
  } catch {
    // Lyrics are optional; playback and artwork continue when lookup fails.
  } finally {
    clearTimeout(timeout)
  }
}, { immediate: true })
</script>

<template>
  <section v-if="lines.length" class="mt-3 border-t border-fg/10 pt-2" :aria-label="t('syncedLyrics')">
    <div class="lyrics-window">
      <div class="lyrics-roll" :style="{ transform: `translateY(${-activeIndex * 2.75}rem)` }">
        <div class="lyric-line" aria-hidden="true" />
        <p v-for="(line, index) in lines" :key="index" class="lyric-line" :class="{ 'lyric-active': index === activeIndex }" :aria-current="index === activeIndex ? 'true' : undefined">
          <span>{{ line.text }}</span>
        </p>
        <div class="lyric-line" aria-hidden="true" />
      </div>
    </div>
    <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer" class="mt-1 block text-right font-mono text-[10px] text-muted hover:text-accent">{{ t('lyricsViaLrclib') }}</a>
  </section>
</template>

<style scoped>
.lyrics-window { height: 8.25rem; overflow: hidden; }
.lyrics-roll { transition: transform 350ms ease; }
.lyric-line { height: 2.75rem; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 0.25rem; color: var(--color-muted); font-size: 0.8125rem; line-height: 1.25; opacity: 0.55; transition: color 250ms ease, opacity 250ms ease; }
.lyric-line span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.lyric-active { color: var(--color-fg); opacity: 1; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .lyrics-roll, .lyric-line { transition: none; } }
</style>
