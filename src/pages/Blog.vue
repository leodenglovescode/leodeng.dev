<script setup>
import { getAllPosts } from '../utils/posts.js'
import { useLocale } from '../utils/i18n.js'
const posts = getAllPosts()
const { t, localePath } = useLocale('blog')
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('blog') }}</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">{{ t('postsAreWrittenInEnglish') }}</p>

    <div v-if="posts.length === 0" class="text-sm text-muted/90 italic">
      {{ t('noPostsYetCheckBackSoon') }}
    </div>

    <div v-else class="flex flex-col">
      <RouterLink
        v-for="post in posts"
        :key="post.slug"
        :to="localePath(`/blog/${post.slug}`)"
        class="group flex items-start justify-between gap-6 py-5 border-b border-fg/5 hover:border-accent/20 transition-colors"
      >
        <div>
          <h3 class="text-fg font-semibold group-hover:text-accent transition-colors mb-1">{{ post.title }}</h3>
          <p v-if="post.description" class="text-sm text-muted">{{ post.description }}</p>
        </div>
        <span class="text-xs font-mono text-muted/90 shrink-0 mt-1">{{ post.displayDate }}</span>
      </RouterLink>
    </div>
  </section>
</template>
