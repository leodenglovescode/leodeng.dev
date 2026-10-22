<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { DAILY_AI_QUESTIONS } from '../../lib/daily-ai-questions.js'
import { useLocale } from '../utils/i18n.js'
import { consumeDailyAiStream } from '../utils/dailyAiStream.js'

const { t, isZh, localePath } = useLocale('daily-ai')
const state = ref(null), error = ref(''), busy = ref(false), loading = ref(true)
const thinking = ref(''), answer = ref(''), sources = ref([]), phase = ref(''), model = ref('qwen3.8:27b')
const selected = computed(() => DAILY_AI_QUESTIONS.find(question => question.id === state.value?.selected))
let controller = null, refreshTimer = null, disposed = false
function failure(response, data) {
  return data?.banned ? t('banned') : response.status === 429 ? t(data?.code === 'traffic_limited' ? 'trafficLimit' : data?.code === 'global_daily_limit' ? 'globalLimit' : 'limit') : t('unavailable')
}
function receive(event) {
  if (event.type === 'snapshot') {
    state.value = { ...state.value, selected: event.id }
    thinking.value = event.thinking || ''; answer.value = event.text || ''
    sources.value = event.sources || []; phase.value = event.status; model.value = event.model
  } else if (event.type === 'delta') {
    if (event.channel === 'thinking') thinking.value += event.text
    if (event.channel === 'answer') answer.value += event.text
  } else if (event.type === 'sources') sources.value = event.sources
  else if (event.type === 'status') phase.value = event.status
}
async function generate(id = null) {
  if (busy.value || disposed) return
  busy.value = true; error.value = ''; phase.value = 'connecting'
  if (id) { thinking.value = ''; answer.value = ''; sources.value = [] }
  controller?.abort(); controller = new AbortController()
  const timeout = setTimeout(() => controller?.abort(), 11 * 60000)
  try {
    const response = await fetch('/api/daily-ai', {
      method: id ? 'POST' : 'GET',
      headers: { accept: 'text/event-stream', ...(id ? { 'content-type': 'application/json', 'x-daily-ai': '1' } : {}) },
      body: id ? JSON.stringify({ id }) : undefined,
      cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok) {
      error.value = failure(response, await response.json().catch(() => null))
      phase.value = 'error'; return
    }
    if (id) state.value = { ...state.value, remaining: Math.max(0, (state.value?.remaining ?? 5) - 1) }
    if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
      await consumeDailyAiStream(response, receive)
      if (!['done', 'error', 'cancelled'].includes(phase.value)) throw new Error('Stream interrupted')
      if (phase.value !== 'done') error.value = t('generationFailed')
    } else { state.value = await response.json(); phase.value = '' }
  } catch (failure) {
    if (!disposed) { phase.value = 'error'; error.value = failure.name === 'AbortError' ? t('timeout') : t('generationFailed') }
  } finally {
    clearTimeout(timeout); busy.value = false
    if (['error', 'cancelled'].includes(phase.value) && !disposed) {
      // Refresh refunds failed jobs server-side and restores the choice buttons.
      void refresh()
    }
  }
}
async function refresh() {
  if (busy.value || disposed) return
  busy.value = true
  let reopen = false
  try {
    const response = await fetch('/api/daily-ai', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    const data = await response.json()
    if (!response.ok) { state.value = null; error.value = failure(response, data); return }
    state.value = data
    reopen = Boolean(data.selected) && !answer.value && !['error', 'cancelled'].includes(phase.value)
    if (!data.selected && ['error', 'cancelled'].includes(phase.value)) phase.value = ''
  } catch {
    state.value = null; error.value = t('unavailable')
  } finally { loading.value = false; busy.value = false }
  if (reopen) void generate()
}
onMounted(() => {
  void refresh()
  refreshTimer = setInterval(() => { if (!document.hidden) void refresh() }, 60000)
})
onBeforeUnmount(() => { disposed = true; clearInterval(refreshTimer); controller?.abort() })
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
      <p v-else-if="state?.globalRemaining === 0" class="text-sm text-muted">{{ t('globalLimit') }}</p>
      <p v-else-if="!state?.ready" class="text-sm text-muted">{{ t('pending') }}</p>
      <p v-else class="text-xs font-mono text-muted">{{ t('batch', { day: state.day, model }) }}</p>
      <p v-if="state" class="text-xs text-muted mt-3">{{ t('remaining', { count: state.remaining }) }}</p>
    </div>
    <ol class="divide-y divide-fg/10 border-y border-fg/10 mb-10">
      <li v-for="(question, index) in DAILY_AI_QUESTIONS" :key="question.id" class="flex items-center justify-between gap-4 py-5">
        <h2 class="text-base font-medium"><span class="text-muted font-mono mr-3">0{{ index + 1 }}</span>{{ isZh ? question.zh : question.en }}</h2>
        <button type="button" data-legacy-hide="true" :disabled="!state?.ready || busy || state.remaining === 0"
          class="shrink-0 text-sm text-accent border border-accent/30 rounded px-3 py-2 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
          @click="generate(question.id)">{{ state?.selected === question.id ? t('askAgain') : t('choose') }}</button>
      </li>
    </ol>
    <article v-if="state?.selected || thinking || answer || busy && !loading" data-legacy-hide="true" class="border-l-2 border-accent pl-5">
      <h2 v-if="selected" class="text-lg font-semibold mb-4">{{ isZh ? selected.zh : selected.en }}</h2>
      <p v-if="phase" role="status" class="text-xs font-mono text-muted mb-5 flex items-center gap-2">
        <span v-if="busy" aria-hidden="true" class="size-1.5 rounded-full bg-accent motion-safe:animate-pulse"></span>
        {{ t(phase === 'done' ? 'complete' : phase === 'queued' ? 'queued' : phase === 'generating' ? (answer ? 'answering' : 'thinking') : phase === 'connecting' ? 'connecting' : 'stopped') }}
      </p>
      <details v-if="thinking" :open="busy && !answer" class="mb-6 border border-fg/10 rounded px-4 py-3">
        <summary class="cursor-pointer text-sm text-muted select-none">{{ t('modelThinking') }}</summary>
        <p class="text-xs text-muted mt-3 mb-3">{{ t('thinkingNotice') }}</p>
        <p lang="en" class="text-sm text-muted leading-relaxed whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{{ thinking }}</p>
      </details>
      <!-- Both output channels are escaped text, never HTML or executable Markdown. -->
      <div :aria-busy="busy" class="text-muted leading-relaxed whitespace-pre-wrap break-words"><p lang="en">{{ answer }}<span v-if="busy && answer" aria-hidden="true" class="inline-block w-1.5 h-4 bg-accent align-middle ml-1 motion-safe:animate-pulse"></span></p></div>
      <p v-if="sources.length" class="text-xs font-mono text-muted mt-6 mb-2">{{ t('sources') }}</p>
      <ul v-if="sources.length" class="text-sm space-y-2"><li v-for="source in sources" :key="source"><RouterLink :to="localePath(source)" class="text-accent underline underline-offset-4">{{ source }}</RouterLink></li></ul>
      <button v-if="phase === 'error' && state?.selected && !busy" type="button" class="mt-4 text-sm text-accent underline" @click="generate()">{{ t('reconnect') }}</button>
    </article>
    <p data-legacy-only="true" hidden><a :href="`https://leodeng.dev${isZh ? '/zh' : ''}/daily?view=modern`" class="hover:text-accent underline underline-offset-4">{{ t('fullSite') }}</a></p>
  </section>
</template>
