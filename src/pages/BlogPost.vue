<script setup>
import { computed, onMounted, onUnmounted, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AiAuthorship from '../components/AiAuthorship.vue'
import { getPost, getAllPosts, refreshPosts } from '../utils/posts.js'
import { applyMeta } from '../utils/useMeta.js'
import { renderMermaid } from '../utils/mermaid.js'
import { useLocale } from '../utils/i18n.js'

const route  = useRoute()
const router = useRouter()
const { locale, t, localePath } = useLocale('blog-post')

const post  = computed(() => getPost(route.params.slug))
const posts = computed(getAllPosts)

const prev = computed(() => {
  const i = posts.value.findIndex(p => p.slug === route.params.slug)
  return i < posts.value.length - 1 ? posts.value[i + 1] : null
})
const next = computed(() => {
  const i = posts.value.findIndex(p => p.slug === route.params.slug)
  return i > 0 ? posts.value[i - 1] : null
})

if (!post.value) router.replace(localePath('/blog'))

// Scroll progress
const scrollProgress = ref(0)
function onScroll() {
  const el = document.documentElement
  scrollProgress.value = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100
}

// Copy buttons + mermaid diagrams. Run after every content swap, not just on
// mount — the prev/next links reuse this component.
async function enhanceContent() {
  await nextTick()
  addCopyButtons()
  renderMermaid(document.querySelector('.prose'))
}

function addCopyButtons() {
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
watch([post, locale], ([p]) => {
  if (p) applyMeta({ title: p.title, description: p.description })
}, { immediate: true })

watch(post, () => enhanceContent())

onMounted(() => {
  refreshPosts()
  window.addEventListener('scroll', onScroll)
  enhanceContent()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <div data-content-blog>
    <!-- Scroll progress bar -->
    <div
      class="fixed top-14 left-0 h-0.5 bg-accent z-40 transition-none"
      :style="{ width: scrollProgress + '%' }"
    />

    <article v-if="post" class="pt-20 sm:pt-32 pb-20">
      <RouterLink :to="localePath('/blog')" class="text-sm font-mono text-muted hover:text-fg transition-colors mb-10 block">
        ← {{ t('backToBlog') }}
      </RouterLink>

      <h1 class="text-2xl sm:text-3xl font-bold text-fg mb-3">{{ post.title }}</h1>
      <p class="text-xs font-mono text-muted/90 mb-12">
        {{ post.displayDate }} · {{ t('minRead', { p0: post.readingTime }) }}
      </p>

      <AiAuthorship :value="post.aiAuthorship" :reason="post.aiReason" />

      <div class="prose" v-html="post.html" />

      <!-- Prev / Next -->
      <div class="flex justify-between gap-6 mt-16 pt-8 border-t border-fg/5">
        <RouterLink
          v-if="prev"
          :to="localePath(`/blog/${prev.slug}`)"
          class="group flex flex-col gap-1 max-w-[45%]"
        >
          <span class="text-xs font-mono text-muted">← {{ t('older') }}</span>
          <span class="text-sm text-muted group-hover:text-fg transition-colors">{{ prev.title }}</span>
        </RouterLink>
        <div v-else />

        <RouterLink
          v-if="next"
          :to="localePath(`/blog/${next.slug}`)"
          class="group flex flex-col gap-1 items-end max-w-[45%]"
        >
          <span class="text-xs font-mono text-muted">{{ t('newer') }} →</span>
          <span class="text-sm text-muted group-hover:text-fg transition-colors text-right">{{ next.title }}</span>
        </RouterLink>
        <div v-else />
      </div>
    </article>
  </div>
</template>
