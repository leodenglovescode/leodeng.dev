<script setup>
import HomeClock from '../components/HomeClock.vue'
import { useLocale } from '../utils/i18n.js'

const { t } = useLocale('time')
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-10">
    <header>
      <p class="text-xs font-mono uppercase tracking-widest text-accent mb-3">{{ t('eyebrow') }}</p>
      <h1 class="text-3xl sm:text-4xl font-bold text-fg mb-4">{{ t('title') }}</h1>
      <p class="text-muted leading-relaxed max-w-xl">{{ t('intro') }}</p>
    </header>

    <HomeClock expanded />

    <section aria-labelledby="time-source-heading" class="border-t border-fg/8 pt-8">
      <h2 id="time-source-heading" class="text-lg font-semibold mb-3">{{ t('sourceTitle') }}</h2>
      <p class="text-muted leading-relaxed mb-5">{{ t('sourceBody') }}</p>
      <ol class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <li v-for="(step, index) in t('steps')" :key="step.title" class="rounded-lg border border-fg/8 p-4">
          <p class="text-xs font-mono text-accent mb-2">0{{ index + 1 }}</p>
          <h3 class="font-medium text-sm mb-2">{{ step.title }}</h3>
          <p class="text-xs text-muted leading-relaxed">{{ step.body }}</p>
        </li>
      </ol>
    </section>

    <section aria-labelledby="time-accuracy-heading" class="space-y-3">
      <h2 id="time-accuracy-heading" class="text-lg font-semibold">{{ t('accuracyTitle') }}</h2>
      <p class="text-muted leading-relaxed">{{ t('accuracyBody') }}</p>
      <p class="text-muted leading-relaxed">{{ t('fallbackBody') }}</p>
    </section>
  </div>
</template>
