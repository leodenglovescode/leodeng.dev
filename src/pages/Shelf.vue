<script setup>
import { computed, ref } from 'vue'
import { shelfContent } from '../utils/shelfContent.js'
import ShelfArtwork from '../components/ShelfArtwork.vue'
import ShelfCabinet from '../components/ShelfCabinet.vue'
import { useLocale } from '../utils/i18n.js'
import { compareShelfTitles, shelfLink, shelfStatus, wikipediaSourceUrl } from '../utils/shelf.js'

const { t, localized } = useLocale('shelf')
const filter = ref('all')
const query = ref('')
const view = ref('shelf')
const types = ['movie', 'tv', 'album']
const items = computed(() => shelfContent.value.items || [])
const matchingItems = computed(() => items.value.filter(item => (filter.value === 'all' || filter.value === item.type) &&
    `${localized(item.title)} ${item.title?.en || ''} ${item.title?.zh || ''} ${item.artist || ''} ${item.year || ''}`
      .toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())).sort(compareShelfTitles))
const sections = computed(() => [
  { key: 'watching', label: 'inProgress', items: matchingItems.value.filter(item => item.type !== 'album' && shelfStatus(item) === 'watching') },
  ...types.map(type => ({
    key: type,
    label: type === 'album' ? 'album' : type === 'movie' ? 'finishedMovies' : 'finishedTv',
    items: matchingItems.value.filter(item => item.type === type && (type === 'album' || shelfStatus(item) === 'finished')),
  })),
])
const visibleCount = computed(() => sections.value.reduce((count, section) => count + section.items.length, 0))
const usesCaa = computed(() => items.value.some(item => item.type === 'album' && item.musicBrainzId && item.artworkMode !== 'custom'))
const wikipediaSources = computed(() => items.value.filter(item => item.artworkMode !== 'custom' && item.posterUrl && wikipediaSourceUrl(item.posterSourceUrl)))
const usesTmdb = computed(() => items.value.some(item => {
  if (item.artworkMode === 'custom') return false
  try { return new URL(item.posterUrl).hostname === 'image.tmdb.org' } catch { return false }
}))
const usesTvmaze = computed(() => items.value.some(item => {
  if (item.artworkMode === 'custom') return false
  try { return new URL(item.posterUrl).hostname === 'static.tvmaze.com' } catch { return false }
}))
</script>

<template>
  <section data-content-shelf class="pt-20 sm:pt-32 pb-20">
    <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">{{ t('eyebrow') }}</p>
    <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight text-fg mb-4">{{ t('title') }}</h1>
    <p class="text-[15px] text-muted leading-relaxed max-w-lg">{{ t('intro') }}</p>

    <div class="mt-7 flex gap-1 w-fit rounded-md border border-fg/10 p-1" role="group" :aria-label="t('viewMode')">
      <button v-for="mode in ['shelf', 'simple']" :key="mode" type="button" :aria-pressed="view === mode" class="px-3 py-2 rounded text-xs font-mono focus-visible:outline-2 focus-visible:outline-accent" :class="view === mode ? 'bg-fg/8 text-fg' : 'text-muted hover:text-fg'" @click="view = mode">{{ t(mode === 'shelf' ? 'shelfView' : 'simpleView') }}</button>
    </div>
    <div class="mt-5 mb-7 flex flex-wrap items-center gap-2" role="group" :aria-label="t('filter')">
      <button v-for="type in ['all', ...types]" :key="type" type="button" :aria-pressed="filter === type"
        class="px-3 py-2 rounded-md text-xs font-mono transition-colors border focus-visible:outline-2 focus-visible:outline-accent"
        :class="filter === type ? 'border-accent/30 bg-accent/10 text-accent' : 'border-fg/10 text-muted hover:text-fg hover:border-fg/25'"
        @click="filter = type">
        {{ t(type) }} <span class="ml-1 opacity-70">{{ type === 'all' ? items.length : items.filter(item => item.type === type).length }}</span>
      </button>
      <input v-if="items.length > 12" v-model="query" type="search" :aria-label="t('search')" :placeholder="t('search')"
        class="w-full sm:w-44 sm:ml-auto mt-2 sm:mt-0 bg-transparent border-b border-fg/15 px-1 py-2 text-sm text-fg focus:outline-none focus:border-accent" />
    </div>

    <p class="sr-only" role="status">{{ t('count', { count: visibleCount }) }}</p>
    <div v-if="!items.length" class="py-16 border-y border-fg/10 text-center">
      <svg viewBox="0 0 80 64" fill="none" stroke="currentColor" class="w-20 h-16 mx-auto mb-5 text-muted/40" aria-hidden="true">
        <path d="M8 52h64M14 48V18h10v30m5 0V10h12v38m6 0 4-27 12 2-4 27" stroke-width="2" />
      </svg>
      <h2 class="text-lg text-fg mb-2">{{ t('emptyTitle') }}</h2>
      <p class="text-sm text-muted">{{ t('empty') }}</p>
    </div>
    <p v-else-if="!visibleCount" class="py-12 text-sm text-muted border-y border-fg/10">{{ query ? t('noMatches') : t('emptyCategory') }}</p>
    <ShelfCabinet v-else-if="view === 'shelf'" :sections="sections.filter(section => section.items.length)" @unsupported="view = 'simple'" />
    <div v-else class="space-y-12">
      <section v-for="section in sections.filter(section => section.items.length)" :key="section.key" :aria-labelledby="`shelf-${section.key}`">
        <div class="flex items-center gap-3 mb-6">
          <h2 :id="`shelf-${section.key}`" class="text-xs font-mono text-muted uppercase tracking-widest">{{ t(section.label) }}</h2>
          <span class="h-px flex-1 bg-fg/10" aria-hidden="true" />
          <span class="text-xs font-mono text-muted">{{ section.items.length }}</span>
        </div>
        <ul class="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 gap-x-5 gap-y-8">
          <li v-for="item in section.items" :key="item.id" class="min-w-0">
            <component :is="shelfLink(item) ? 'a' : 'div'" :href="shelfLink(item)" :target="shelfLink(item) ? '_blank' : undefined"
              :rel="shelfLink(item) ? 'noopener noreferrer' : undefined" class="shelf-item group block rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
              <ShelfArtwork :item="item" :title="localized(item.title)" />
              <h3 class="mt-3 text-sm font-medium text-fg leading-snug" :class="{ 'group-hover:text-accent': shelfLink(item) }">
                {{ localized(item.title) }}<span v-if="shelfLink(item)" class="text-muted text-xs ml-1" aria-hidden="true">↗</span>
              </h3>
              <p v-if="item.artist || item.year" class="mt-1 text-xs text-muted leading-relaxed">{{ [item.artist, item.year].filter(Boolean).join(' · ') }}</p>
              <p v-if="item.watchedAt && item.type !== 'album' && shelfStatus(item) === 'finished'" class="mt-1 text-[11px] font-mono text-muted">{{ t('watched') }} {{ item.watchedAt }}</p>
              <span v-if="shelfLink(item)" class="sr-only">{{ t('opensImdb') }}</span>
            </component>
          </li>
        </ul>
      </section>
    </div>

    <section v-if="usesCaa || usesTmdb || usesTvmaze || wikipediaSources.length" class="mt-14 border-t border-fg/10 pt-4 text-xs text-muted leading-relaxed" aria-labelledby="shelf-credits">
      <h2 id="shelf-credits" class="font-mono uppercase tracking-widest">{{ t('credits') }}</h2>
      <p v-if="usesCaa" class="mt-3">{{ t('albumArt') }} <a href="https://coverartarchive.org/" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4">Cover Art Archive</a> / MusicBrainz.</p>
      <p v-if="wikipediaSources.length" class="mt-3">{{ t('wikipediaArt') }} <span v-for="(item, index) in wikipediaSources" :key="item.id"><span v-if="index">, </span><a :href="wikipediaSourceUrl(item.posterSourceUrl)" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4">{{ localized(item.title) }}</a></span>.</p>
      <p v-if="usesTvmaze" class="mt-3">{{ t('posters') }} <a href="https://www.tvmaze.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4">TVmaze</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4">CC BY-SA 4.0</a>.</p>
      <a v-if="usesTmdb" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" class="inline-block mt-4">
        <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB" width="100" class="h-auto" loading="lazy" />
      </a>
      <p v-if="usesTmdb" class="mt-3">{{ t('posters') }} <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4">TMDB</a>. {{ t('tmdbNotice') }}</p>
    </section>
    <footer class="shelf-note mt-8 space-y-2 text-sm text-muted leading-relaxed">
      <p>{{ t('watchedNote') }}</p>
      <p>{{ t('seriesNote') }}</p>
    </footer>
  </section>
</template>

<style scoped>
.shelf-item :deep(.shelf-artwork) { transition: transform 180ms ease, box-shadow 180ms ease; }
a.shelf-item:hover :deep(.shelf-artwork) { transform: translateY(-3px); box-shadow: 0 9px 20px #0003; }
@media (prefers-reduced-motion: reduce) { .shelf-item :deep(.shelf-artwork) { transition: none; } a.shelf-item:hover :deep(.shelf-artwork) { transform: none; } }
</style>
