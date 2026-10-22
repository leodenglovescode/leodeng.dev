<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { DAILY_AI_QUESTIONS } from '../../lib/daily-ai-questions.js'
import { useLocale } from '../utils/i18n.js'

const { t, isZh, localePath } = useLocale('daily-ai')
const state = ref(null), error = ref(''), busy = ref(false), loading = ref(true)
const selected = computed(() => DAILY_AI_QUESTIONS.find(question => question.id === state.value?.selected))
let controller = null
let refreshTimer = null

async function load(id = null) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  controller?.abort()
  controller = new AbortController()
  const timeout = setTimeout(() => controller?.abort(), 10000)
  try {
    const response = await fetch('/api/daily-ai', {
      method: id ? 'POST' : 'GET',
      headers: id ? { 'content-type': 'application/json', 'x-daily-ai': '1' } : {},
      body: id ? JSON.stringify({ id }) : undefined,
      cache: 'no-store', signal: controller.signal,
    })
    const data = await response.json()
    if (!response.ok) {
      state.value = null
      error.value = data.banned ? t('banned') : response.status === 429 ? t('limit') : t('unavailable')
      return
    }
    state.value = data
  } catch (failure) {
    state.value = null
    if (failure.name !== 'AbortError') error.value = t('unavailable')
    else error.value = t('timeout')
  } finally {
    clearTimeout(timeout)
    loading.value = false
    busy.value = false
  }
}

onMounted(() => {
  void load()
  // Existing open pages also notice the kill switch, not just new visitors.
  refreshTimer = setInterval(() => { if (!document.hidden) void load() }, 60000)
})
onBeforeUnmount(() => { clearInterval(refreshTimer); controller?.abort() })
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h1 class="text-2xl sm:text-3xl font-semibold mb-4">{{ t('title') }}</h1>
    <p class="text-muted leading-relaxed mb-3">{{ t('intro') }}</p>
    <p class="text-sm text-muted mb-3">{{ t('policy') }}</p>
    <p class="text-sm text-muted mb-8">{{ t('aiNotice') }} <RouterLink :to="localePath('/ai')" class="text-accent underline underline-offset-4">{{ t('aiLink') }}</RouterLink></p>
    <p class="text-xs text-muted mb-8">{{ t('banPolicy') }} <RouterLink :to="localePath('/privacy')" class="text-accent underline underline-offset-4">{{ t('privacy') }}</RouterLink></p>
    <div data-legacy-hide="true" aria-live="polite" class="mb-6">
      <p v-if="loading" class="text-sm font-mono text-muted">{{ t('loading') }}</p>
      <p v-else-if="error" role="status" class="text-sm text-muted">{{ error }}</p>
      <p v-else-if="!state?.ready" class="text-sm text-muted">{{ t('pending') }}</p>
      <p v-else class="text-xs font-mono text-muted">{{ t('batch', { day: state.day, model: state.model }) }}</p>
    </div>
    <ol class="divide-y divide-fg/10 border-y border-fg/10 mb-10">
      <li v-for="(question, index) in DAILY_AI_QUESTIONS" :key="question.id" class="flex items-center justify-between gap-4 py-5">
        <h2 class="text-base font-medium"><span class="text-muted font-mono mr-3">0{{ index + 1 }}</span>{{ isZh ? question.zh : question.en }}</h2>
        <button type="button" data-legacy-hide="true" :disabled="!state?.ready || busy || Boolean(state?.selected)"
          class="shrink-0 text-sm text-accent border border-accent/30 rounded px-3 py-2 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
          @click="load(question.id)">{{ state?.selected === question.id ? t('selected') : t('choose') }}</button>
      </li>
    </ol>
    <article v-if="state?.answer" class="border-l-2 border-accent pl-5" aria-live="polite">
      <h2 class="text-lg font-semibold mb-4">{{ isZh ? selected?.zh : selected?.en }}</h2>
      <!-- Generated content is escaped text, never HTML, Markdown, or commands. -->
      <p lang="en" class="text-muted leading-relaxed whitespace-pre-line break-words">{{ state.answer.text }}</p>
      <p class="text-xs font-mono text-muted mt-6 mb-2">{{ t('sources') }}</p>
      <ul class="text-sm space-y-2"><li v-for="source in state.answer.sources" :key="source"><RouterLink :to="localePath(source)" class="text-accent underline underline-offset-4">{{ source }}</RouterLink></li></ul>
    </article>
    <p class="text-xs text-muted mt-8"><a :href="`https://leodeng.dev${isZh ? '/zh' : ''}/daily?view=modern`" class="hover:text-accent underline underline-offset-4">{{ t('fullSite') }}</a></p>
  </section>
</template>
