<script setup>
import projectData from '../content/projects.json'
import { useLocale } from '../utils/i18n.js'

const { t, localized } = useLocale('projects')
const projects = projectData.projects || []
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">
      {{ t('projects') }}
    </h2>

    <div class="space-y-10">
      <component
        :is="project.url ? 'a' : 'div'"
        v-for="project in projects"
        :key="project.id"
        :href="project.url || undefined"
        :target="project.url ? '_blank' : undefined"
        :rel="project.url ? 'noopener noreferrer' : undefined"
        class="group block"
      >
        <div
          v-if="project.images?.length"
          class="grid gap-2 mb-4"
          :class="project.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'"
        >
          <img
            v-for="(image, index) in project.images"
            :key="image.url"
            :src="image.url"
            :alt="localized(image.alt) || `${localized(project.title)} screenshot ${index + 1}`"
            loading="lazy"
            class="w-full rounded-lg border border-fg/8 transition-colors object-cover"
            :class="[
              project.url ? 'group-hover:border-accent/20' : 'opacity-80',
              project.images.length > 1 ? 'aspect-video' : '',
            ]"
          />
        </div>

        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-fg font-semibold transition-colors" :class="project.url && 'group-hover:text-accent'">
            {{ localized(project.title) }}
          </h3>
          <span v-if="localized(project.linkLabel)" class="text-xs font-mono text-muted/90 shrink-0">
            <template v-if="project.url">↗ </template>{{ localized(project.linkLabel) }}
          </span>
        </div>

        <p class="text-sm text-muted leading-relaxed">{{ localized(project.description) }}</p>

        <div v-if="project.tags?.length" class="flex flex-wrap gap-2 mt-3">
          <span
            v-for="tag in project.tags"
            :key="tag"
            class="text-xs font-mono px-2 py-0.5 rounded bg-fg/5 text-muted"
          >{{ tag }}</span>
        </div>
      </component>

      <p class="text-sm text-muted/90 italic pt-2">
        {{ t('activelyBuildingNewStuffCheckBackLater') }}
      </p>
    </div>
  </section>
</template>
