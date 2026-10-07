<script setup>
import { collections } from '../utils/gallery.js'
import { useLocale } from '../utils/i18n.js'
const { t, localePath } = useLocale('gallery')
const collectionTitle = (collection) => collection.slug === 'planespotting' ? t('planespotting') : collection.title
const collectionDescription = (collection) => collection.slug === 'planespotting' ? t('shotsFromPlanespottingTrips') : collection.description
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">{{ t('gallery') }}</h2>

    <p class="text-sm text-muted leading-relaxed mb-10">
      {{ t('photoCollectionsPickOneToBrowseOr') }}
      <RouterLink :to="localePath('/spotting')" class="text-fg hover:text-accent transition-colors">{{ t('exifSaysAboutHowTheyWereShot') }}</RouterLink>{{ t('period') }}
    </p>

    <div v-if="collections.length" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <RouterLink
        v-for="c in collections"
        :key="c.slug"
        :to="localePath(`/gallery/${c.slug}`)"
        class="group block rounded-lg border border-fg/8 overflow-hidden hover:border-accent/30 transition-colors"
      >
        <div class="aspect-[16/9] overflow-hidden bg-surface">
          <img
            v-if="c.cover"
            :src="c.cover"
            :alt="collectionTitle(c)"
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
        <div class="p-4">
          <div class="text-fg font-semibold">{{ collectionTitle(c) }}</div>
          <div class="text-sm text-muted mt-1">{{ collectionDescription(c) }}</div>
          <div class="text-xs font-mono text-muted/90 mt-2">{{ t('photo', { p0: c.photos.length, p1: c.photos.length === 1 ? '' : 's' }) }}</div>
        </div>
      </RouterLink>
    </div>

    <p v-else class="text-sm text-muted/90 italic">
      {{ t('photosComingSoon') }}
    </p>
  </section>
</template>
