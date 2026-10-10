<script setup>
import HomeClock from '../components/HomeClock.vue'
import { useLocale } from '../utils/i18n.js'
const { t } = useLocale('time')
</script>

<template>
  <div class="pt-16 sm:pt-24 pb-20 space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">{{ t('dashboardTitle') }}</h1>
      <span class="text-xs font-mono text-accent rounded border border-accent/20 bg-accent/5 px-3 py-1.5">GPS / PPS · Stratum 1</span>
    </header>
    <HomeClock expanded />
    <section :aria-label="t('sourceTitle')" class="rounded-xl border border-fg/8 p-5">
      <h2 class="text-sm font-semibold mb-4">{{ t('sourceTitle') }}</h2>
      <ol class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <li v-for="(step, index) in t('steps')" :key="step.title" class="font-mono text-xs text-muted">
          <span class="text-accent mr-2">0{{ index + 1 }}</span>{{ step.title }}
        </li>
      </ol>
    </section>
  </div>
</template>
