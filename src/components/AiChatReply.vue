<script setup>
import { nextTick, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
const props = defineProps({ turn: { type: Object, required: true } })
const { t, localePath } = useLocale('daily-ai')
const open = ref(props.turn.status === 'running' && props.turn.phase !== 'answering'), follow = ref(true), pane = ref(null)
const errors = { provider_auth: 'errorProviderAuth', provider_balance: 'errorProviderBalance', provider_busy: 'errorProviderBusy', provider_error: 'errorProvider',
  stream_incomplete: 'errorStreamIncomplete', output_limit: 'errorOutputLimit', generation_timeout: 'errorGenerationTimeout',
  generation_cancelled: 'errorCancelled', empty_answer: 'errorEmptyAnswer' }
watch(() => props.turn.phase, phase => { if (phase === 'answering') open.value = false })
watch(() => props.turn.status, status => { if (status === 'done') open.value = false })
watch([() => props.turn.thinking, open], async () => {
  await nextTick()
  if (props.turn.status === 'running' && open.value && follow.value && pane.value) pane.value.scrollTop = pane.value.scrollHeight
}, { flush: 'post' })
function track() { if (pane.value) follow.value = pane.value.scrollHeight - pane.value.scrollTop - pane.value.clientHeight < 32 }
</script>
<template>
  <article class="border-l-2 border-accent pl-4 sm:pl-5" :aria-busy="turn.status === 'running'">
    <p class="text-xs font-mono text-muted mb-3">{{ t('assistant') }} · deepseek-flash</p>
    <dl v-if="turn.status === 'done' && turn.stats" class="grid grid-cols-3 gap-2 mb-4" :aria-label="t('statsTitle')">
      <div class="border border-fg/10 rounded p-3" :title="t('durationNote')"><dt class="text-xs text-muted mb-1">{{ t('duration') }}</dt><dd class="font-mono text-sm">{{ (turn.stats.durationMs / 1000).toFixed(1) }} s</dd></div>
      <div class="border border-fg/10 rounded p-3" :title="t('speedNote')"><dt class="text-xs text-muted mb-1">{{ t('speed') }}</dt><dd class="font-mono text-sm">{{ turn.stats.tokensPerSecond == null ? t('notAvailable') : turn.stats.tokensPerSecond.toFixed(1) + ' tok/s' }}</dd></div>
      <div class="border border-fg/10 rounded p-3" :title="t('tokensNote')"><dt class="text-xs text-muted mb-1">{{ t('outputTokens') }}</dt><dd class="font-mono text-sm">{{ turn.stats.tokens ?? t('notAvailable') }}</dd></div>
    </dl>
    <p v-if="turn.status === 'running'" role="status" class="text-xs font-mono text-muted mb-4">{{ t(turn.phase === 'answering' ? 'answering' : turn.thinking ? 'thinking' : 'connecting') }}</p>
    <details v-if="turn.thinking" :open="open" @toggle="open = $event.target.open" class="border border-fg/10 rounded px-4 py-3 mb-4">
      <summary class="text-sm text-muted cursor-pointer">{{ t('modelThinking') }}</summary>
      <p class="text-xs text-muted mt-3 mb-3">{{ t('thinkingNotice') }}</p>
      <p ref="pane" tabindex="0" @scroll="track" class="text-sm text-muted whitespace-pre-wrap break-words leading-relaxed max-h-72 overflow-y-auto">{{ turn.thinking }}</p>
    </details>
    <!-- User messages, answers and reasoning are escaped text, never HTML. -->
    <p class="text-muted whitespace-pre-wrap break-words leading-relaxed">{{ turn.text }}<span v-if="turn.status === 'running' && turn.text" aria-hidden="true" class="inline-block w-1.5 h-4 bg-accent ml-1 align-middle motion-safe:animate-pulse"></span></p>
    <p v-if="turn.status === 'error' || turn.status === 'cancelled'" role="status" class="text-sm text-muted mt-3">{{ t(errors[turn.code] || 'generationFailed') }}</p>
    <p v-if="turn.stats?.finishReason === 'length'" class="text-xs text-muted mt-3">{{ t('outputTruncated') }}</p>
    <ul v-if="turn.sources?.length" class="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs"><li v-for="source in turn.sources" :key="source"><RouterLink :to="localePath(source)" class="text-accent underline underline-offset-4">{{ source }}</RouterLink></li></ul>
  </article>
</template>
