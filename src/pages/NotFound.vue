<script setup>
import { useLocale } from '../utils/i18n.js'
const { t, localePath } = useLocale('not-found')
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 flex flex-col items-start">
    <p class="text-8xl font-mono font-bold text-fg/5 mb-6 select-none">404</p>
    <p class="text-muted mb-8">{{ t('thisPageDoesnTExist') }}</p>
    <RouterLink :to="localePath('/')" class="text-sm font-mono text-accent hover:underline underline-offset-4">
      ← {{ t('goHome') }}
    </RouterLink>
  </div>
</template>
