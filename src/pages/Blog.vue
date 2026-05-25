<script setup>
import { getAllPosts } from '../utils/posts.js'
const posts = getAllPosts()
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">Blog</h2>

    <div v-if="posts.length === 0" class="text-sm text-muted/50 italic">
      No posts yet — check back soon.
    </div>

    <div v-else class="flex flex-col">
      <RouterLink
        v-for="post in posts"
        :key="post.slug"
        :to="`/blog/${post.slug}`"
        class="group flex items-start justify-between gap-6 py-5 border-b border-white/5 hover:border-accent/20 transition-colors"
      >
        <div>
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors mb-1">{{ post.title }}</h3>
          <p v-if="post.description" class="text-sm text-muted">{{ post.description }}</p>
        </div>
        <span class="text-xs font-mono text-muted/40 shrink-0 mt-1">{{ post.date }}</span>
      </RouterLink>
    </div>
  </section>
</template>
