<script setup>
import { computed, onMounted } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { countryName, useVisitor } from '../utils/visitor.js'

const { t, locale, localePath } = useLocale('ip')
const { visitor, loadVisitor } = useVisitor()
const summary = computed(() => [visitor.value?.ip, countryName(visitor.value?.countryCode, locale.value),
  visitor.value?.network.organization, visitor.value?.connection.tlsVersion].filter(Boolean).join(' · '))
onMounted(() => { void loadVisitor() })
</script>

<template>
  <RouterLink :to="localePath('/ip')" class="basis-full text-xs font-mono text-muted/90 hover:text-fg transition-colors break-words">
    <span>{{ t('footerLabel') }}</span><span v-if="summary"> · {{ summary }}</span><span aria-hidden="true"> ↗</span>
  </RouterLink>
</template>
