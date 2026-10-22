<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AiChatReply from '../components/AiChatReply.vue'
import { DAILY_AI_QUESTIONS } from '../../lib/daily-ai-questions.js'
import { consumeDailyAiStream } from '../utils/dailyAiStream.js'
import { useLocale } from '../utils/i18n.js'
const { t, isZh, localePath } = useLocale('daily-ai')
const state = ref(null), turns = ref([]), input = ref(''), useThinking = ref(true), busy = ref(false), loading = ref(true), error = ref(''), composer = ref(null)
let controller, timer, disposed = false
function responseError(response, data) {
  return t(data?.banned ? 'banned' : data?.code === 'traffic_limited' ? 'trafficLimit' : data?.code === 'global_daily_limit' ? 'globalLimit' : data?.code === 'personal_daily_limit' ? 'limit' : data?.code === 'chat_busy' ? 'chatBusy' : 'unavailable')
}
async function refresh(replaceHistory = false) {
  if (disposed || busy.value) return
  try {
    const response = await fetch('/api/daily-ai', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    const data = await response.json()
    if (!response.ok) { error.value = responseError(response, data); state.value = null; return }
    state.value = data
    if (replaceHistory) turns.value = data.turns || []
  } catch { error.value = t('unavailable'); state.value = null }
  finally { loading.value = false }
}
async function suggest(question) { input.value = isZh.value ? question.zh : question.en; await nextTick(); composer.value?.focus() }
async function send() {
  if (busy.value || !state.value?.ready || !input.value.trim() || !state.value.whitelisted && state.value.remaining === 0) return
  const message = input.value.trim()
  input.value = ''; error.value = ''; busy.value = true
  turns.value.push({ id: crypto.randomUUID(), message, thinking: '', text: '', status: 'running', phase: 'thinking', sources: [], stats: null })
  const turn = turns.value.at(-1)
  controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 125000)
  try {
    const response = await fetch('/api/daily-ai', { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-daily-ai': '1', accept: 'text/event-stream' },
      body: JSON.stringify({ message, thinking: useThinking.value }), signal: controller.signal })
    if (!response.ok) {
      error.value = responseError(response, await response.json().catch(() => null)); turns.value.pop(); input.value = message; return
    }
    await consumeDailyAiStream(response, event => {
      if (event.type === 'start') turn.id = event.id
      if (event.type === 'phase') turn.phase = event.phase
      if (event.type === 'delta' && event.channel === 'thinking') turn.thinking += event.text
      if (event.type === 'delta' && event.channel === 'answer') { turn.phase = 'answering'; turn.text += event.text }
      if (event.type === 'sources') turn.sources = event.sources
      if (event.type === 'stats') turn.stats = event.stats
      if (event.type === 'status') { turn.status = event.status; turn.code = event.code }
    })
    if (turn.status === 'running') { turn.status = 'error'; turn.code = 'stream_incomplete' }
  } catch { turn.status = 'error'; turn.code = 'stream_incomplete' }
  finally {
    clearTimeout(deadline); busy.value = false
    if (!disposed) { await refresh(); await nextTick(); composer.value?.focus() }
  }
}
onMounted(() => { void refresh(true); timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); controller?.abort() })
</script>
<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h1 class="text-2xl sm:text-3xl font-semibold mb-4">{{ t('title') }}</h1>
    <p class="text-muted leading-relaxed mb-3">{{ t('intro') }}</p>
    <p class="text-sm text-muted mb-3">{{ t('policy') }}</p>
    <p class="text-xs text-muted mb-6">{{ t('privacyNotice') }} <RouterLink :to="localePath('/privacy')" class="text-accent underline underline-offset-4">{{ t('privacy') }}</RouterLink></p>
    <div data-legacy-hide="true">
      <p v-if="loading" role="status" class="text-sm text-muted mb-5">{{ t('loading') }}</p>
      <p v-else-if="error" role="status" class="text-sm text-muted mb-5">{{ error }}</p>
      <p v-else-if="state && !state.configured" class="text-sm text-muted mb-5">{{ t('pending') }}</p>
      <p v-if="state" class="text-xs font-mono text-muted mb-6">{{ state.whitelisted ? t('unlimited') : t('remaining', { count: state.remaining }) }}</p>
      <div class="flex flex-wrap gap-2 mb-8" :aria-label="t('suggestions')">
        <button v-for="question in DAILY_AI_QUESTIONS" :key="question.id" type="button" :disabled="busy" class="text-xs text-accent border border-accent/20 rounded px-3 py-2 hover:bg-accent/10 disabled:opacity-40" @click="suggest(question)">{{ isZh ? question.zh : question.en }}</button>
      </div>
      <ol class="space-y-8 mb-8" :aria-label="t('conversation')"><li v-for="turn in turns" :key="turn.id" class="space-y-4">
        <div class="rounded border border-fg/10 bg-fg/[0.02] p-4"><p class="text-xs font-mono text-muted mb-2">{{ t('you') }}</p><p class="whitespace-pre-wrap break-words leading-relaxed">{{ turn.message }}</p></div>
        <AiChatReply :turn="turn" />
      </li></ol>
      <form class="border-t border-fg/10 pt-5" @submit.prevent="send">
        <label for="ai-chat-message" class="block text-sm font-medium mb-3">{{ t('messageLabel') }}</label>
        <textarea id="ai-chat-message" ref="composer" v-model="input" rows="3" maxlength="2000" required :disabled="busy || !state?.ready || !state?.whitelisted && state?.remaining === 0" :placeholder="t('placeholder')" class="w-full resize-y rounded border border-fg/15 bg-transparent px-4 py-3 leading-relaxed focus:border-accent focus:outline-none disabled:opacity-40"></textarea>
        <div class="flex items-center justify-between gap-4 mt-3">
          <label class="flex items-center gap-2 text-sm text-muted"><input v-model="useThinking" type="checkbox" :disabled="busy">{{ t('enableThinking') }}</label>
          <button type="submit" :disabled="busy || !input.trim() || !state?.ready || !state?.whitelisted && state?.remaining === 0" class="bg-accent-strong text-white rounded px-4 py-2 text-sm disabled:opacity-40">{{ t(busy ? 'sending' : 'send') }}</button>
        </div>
      </form>
    </div>
    <p data-legacy-only="true" hidden><a :href="`https://leodeng.dev${isZh ? '/zh' : ''}/daily?view=modern`">{{ t('fullSite') }}</a></p>
  </section>
</template>
