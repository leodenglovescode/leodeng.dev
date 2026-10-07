<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCollection } from '../utils/gallery.js'
import { useLocale } from '../utils/i18n.js'

const PAGE_SIZE = 10

const route = useRoute()
const router = useRouter()
const { isZh, t, localePath } = useLocale('gallery-collection')

const collection = computed(() => getCollection(route.params.slug))
const collectionTitle = computed(() => collection.value?.slug === 'planespotting' ? t('planespotting') : collection.value?.title)
const collectionDescription = computed(() => collection.value?.slug === 'planespotting' ? t('shotsFromPlanespottingTrips') : collection.value?.description)

function photoCaption(photo) {
  const match = photo.sortKey.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-\d+)?$/)
  if (!match) return photo.caption
  const [, year, month, day, hour, minute, second] = match
  const when = isZh.value
    ? `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}:${second}`
    : `${year} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${Number(day)} ${hour}:${minute}:${second}`
  return t('shotAt', { p0: when })
}

const page = computed(() => {
  const p = Number(route.query.page)
  return Number.isInteger(p) && p > 0 ? p : 1
})

const pageCount = computed(() => {
  if (!collection.value) return 1
  return Math.max(1, Math.ceil(collection.value.photos.length / PAGE_SIZE))
})

const pagePhotos = computed(() => {
  if (!collection.value) return []
  const start = (page.value - 1) * PAGE_SIZE
  return collection.value.photos.slice(start, start + PAGE_SIZE)
})

function goToPage(p) {
  const clamped = Math.min(Math.max(1, p), pageCount.value)
  router.push({ query: { ...route.query, page: clamped === 1 ? undefined : clamped } })
}

const activeIndex = ref(null)

function open(i) {
  activeIndex.value = i
}

function close() {
  activeIndex.value = null
}

function next() {
  activeIndex.value = (activeIndex.value + 1) % pagePhotos.value.length
}

function prev() {
  activeIndex.value = (activeIndex.value - 1 + pagePhotos.value.length) % pagePhotos.value.length
}

function onKeydown(e) {
  if (activeIndex.value === null) return
  if (e.key === 'Escape') close()
  if (e.key === 'ArrowRight') next()
  if (e.key === 'ArrowLeft') prev()
}

// A page/collection navigation can leave a stale index pointing at a photo
// that's no longer on screen, so close the lightbox whenever the route changes.
watch(() => route.fullPath, () => { activeIndex.value = null })

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <RouterLink :to="localePath('/gallery')" class="text-sm font-mono text-muted hover:text-fg transition-colors">← {{ t('gallery') }}</RouterLink>

    <template v-if="collection">
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mt-4 mb-2">{{ collectionTitle }}</h2>
      <p class="text-sm text-muted leading-relaxed mb-10">{{ collectionDescription }}</p>

      <div v-if="pagePhotos.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          v-for="(photo, i) in pagePhotos"
          :key="photo.sortKey"
          class="group block aspect-square overflow-hidden rounded-lg border border-fg/8 hover:border-accent/20 transition-colors"
          @click="open(i)"
        >
          <img
            :src="photo.thumbSrc"
            :alt="photoCaption(photo)"
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </button>
      </div>

      <p v-else class="text-sm text-muted/90 italic">
        {{ t('photosComingSoon') }}
      </p>

      <div v-if="pageCount > 1" class="flex items-center justify-center gap-6 mt-10 font-mono">
        <button
          class="text-sm text-muted hover:text-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >← {{ t('prev') }}</button>
        <span class="text-xs text-muted/90">{{ t('pageOf', { p0: page, p1: pageCount }) }}</span>
        <button
          class="text-sm text-muted hover:text-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
          :disabled="page >= pageCount"
          @click="goToPage(page + 1)"
        >{{ t('next') }} →</button>
      </div>

      <div
        v-if="activeIndex !== null"
        class="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 sm:p-10"
        @click.self="close"
      >
        <button
          class="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          :aria-label="t('close')"
          @click="close"
        >
          <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        <button
          v-if="pagePhotos.length > 1"
          class="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
          :aria-label="t('previousPhoto')"
          @click.stop="prev"
        >
          <svg viewBox="0 0 24 24" class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>

        <figure class="max-w-full max-h-full flex flex-col items-center">
          <img :src="pagePhotos[activeIndex].fullSrc" :alt="photoCaption(pagePhotos[activeIndex])" class="max-w-full max-h-[80vh] rounded-lg object-contain" />
          <figcaption class="text-sm text-white/60 font-mono mt-3">{{ photoCaption(pagePhotos[activeIndex]) }}</figcaption>
        </figure>

        <button
          v-if="pagePhotos.length > 1"
          class="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
          :aria-label="t('nextPhoto')"
          @click.stop="next"
        >
          <svg viewBox="0 0 24 24" class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    </template>

    <p v-else class="text-sm text-muted/90 italic mt-6">
      {{ t('collectionNotFound') }} <RouterLink :to="localePath('/gallery')" class="text-fg hover:text-accent transition-colors">{{ t('backToTheGallery') }}</RouterLink>{{ t('period') }}
    </p>
  </section>
</template>
