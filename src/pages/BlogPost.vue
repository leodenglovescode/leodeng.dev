<script setup>
import { computed, onMounted, onUnmounted, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPost, getAllPosts } from '../utils/posts.js'
import { applyMeta, resetMeta } from '../utils/useMeta.js'

const route  = useRoute()
const router = useRouter()

const post  = computed(() => getPost(route.params.slug))
const posts = getAllPosts()

const prev = computed(() => {
  const i = posts.findIndex(p => p.slug === route.params.slug)
  return i < posts.length - 1 ? posts[i + 1] : null
})
const next = computed(() => {
  const i = posts.findIndex(p => p.slug === route.params.slug)
  return i > 0 ? posts[i - 1] : null
})

if (!post.value) router.replace('/blog')

// Scroll progress
const scrollProgress = ref(0)
function onScroll() {
  const el = document.documentElement
  scrollProgress.value = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100
}

// Copy buttons
async function addCopyButtons() {
  await nextTick()
  document.querySelectorAll('.prose pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.textContent = 'copy'
    btn.onclick = async () => {
      const code = pre.querySelector('code')?.innerText || ''
      await navigator.clipboard.writeText(code)
      btn.textContent = 'copied!'
      setTimeout(() => { btn.textContent = 'copy' }, 2000)
    }
    pre.appendChild(btn)
  })
}

// OG tags
watch(post, (p) => {
  if (p) applyMeta({ title: p.title, description: p.description })
}, { immediate: true })

onMounted(() => {
  window.addEventListener('scroll', onScroll)
  addCopyButtons()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  resetMeta()
})
</script>

<template>
  <!-- Scroll progress bar -->
  <div
    class="fixed top-14 left-0 h-0.5 bg-accent z-40 transition-none"
    :style="{ width: scrollProgress + '%' }"
  />

  <article v-if="post" class="pt-20 sm:pt-32 pb-20">
    <RouterLink to="/blog" class="text-xs font-mono text-muted/50 hover:text-muted transition-colors mb-10 block">
      ← Back to blog
    </RouterLink>

    <h1 class="text-2xl sm:text-3xl font-bold text-fg mb-3">{{ post.title }}</h1>
    <p class="text-xs font-mono text-muted/50 mb-12">
      {{ post.date }} · {{ post.readingTime }} min read
    </p>

    <div class="prose" v-html="post.html" />

    <!-- Prev / Next -->
    <div class="flex justify-between gap-6 mt-16 pt-8 border-t border-fg/5">
      <RouterLink
        v-if="prev"
        :to="`/blog/${prev.slug}`"
        class="group flex flex-col gap-1 max-w-[45%]"
      >
        <span class="text-xs font-mono text-muted/40">← Older</span>
        <span class="text-sm text-muted group-hover:text-fg transition-colors">{{ prev.title }}</span>
      </RouterLink>
      <div v-else />

      <RouterLink
        v-if="next"
        :to="`/blog/${next.slug}`"
        class="group flex flex-col gap-1 items-end max-w-[45%]"
      >
        <span class="text-xs font-mono text-muted/40">Newer →</span>
        <span class="text-sm text-muted group-hover:text-fg transition-colors text-right">{{ next.title }}</span>
      </RouterLink>
      <div v-else />
    </div>
  </article>
</template>
