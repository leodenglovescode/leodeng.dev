<script setup>
import { collections } from '../utils/gallery.js'
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">Gallery</h2>

    <p class="text-sm text-muted leading-relaxed mb-10">
      Photo collections. Pick one to browse.
    </p>

    <div v-if="collections.length" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <RouterLink
        v-for="c in collections"
        :key="c.slug"
        :to="`/gallery/${c.slug}`"
        class="group block rounded-lg border border-fg/8 overflow-hidden hover:border-accent/30 transition-colors"
      >
        <div class="aspect-[16/9] overflow-hidden bg-surface">
          <img
            v-if="c.cover"
            :src="c.cover"
            :alt="c.title"
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
        <div class="p-4">
          <div class="text-fg font-semibold">{{ c.title }}</div>
          <div class="text-sm text-muted mt-1">{{ c.description }}</div>
          <div class="text-[11px] font-mono text-muted/50 mt-2">{{ c.photos.length }} photo{{ c.photos.length === 1 ? '' : 's' }}</div>
        </div>
      </RouterLink>
    </div>

    <p v-else class="text-sm text-muted/50 italic">
      Photos coming soon.
    </p>
  </section>
</template>
