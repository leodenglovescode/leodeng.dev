<script setup>
import { aiAuthorshipLabel, usesAiWriting } from '../utils/aiAuthorship.js'
import { useLocale } from '../utils/i18n.js'

defineProps({
  value: String,
  reason: String,
  compact: Boolean,
})
const { t, localePath } = useLocale('ai-authorship')
</script>

<template>
  <span v-if="compact && aiAuthorshipLabel(value)" :title="value === 'human' ? t('humanDescription') : undefined" class="ai-authorship block text-xs font-mono text-accent mt-2">
    {{ t(value) }}
  </span>
  <aside v-else-if="aiAuthorshipLabel(value)" :aria-label="t('disclosure')" class="ai-authorship border-l-2 border-accent pl-4 mb-10 text-sm text-muted">
    <RouterLink :to="localePath('/ai')" class="font-mono text-accent hover:underline underline-offset-4">
      {{ t(value) }}
    </RouterLink>
    <p v-if="value === 'human'" class="mt-2">{{ t('humanDescription') }}</p>
    <p v-else-if="usesAiWriting(value) && reason?.trim()" class="mt-2 whitespace-pre-line break-words">{{ reason }}</p>
  </aside>
</template>
