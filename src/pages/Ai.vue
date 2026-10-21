<script setup>
import source from '../content/ai.md?raw'
import { renderMarkdown } from '../utils/posts.js'

// Keep the writing in one Markdown file, like the English-language blog posts.
const html = renderMarkdown(source)
</script>

<template>
  <article class="pt-20 sm:pt-32 pb-20">
    <div lang="en" class="prose" v-html="html" />
  </article>
</template>
