<script setup>
import stack from '../content/stack.json'
import { STACK_ICONS as ICONS, stackText } from '../utils/stack.js'
import { useLocale } from '../utils/i18n.js'

const { t, locale } = useLocale('stack')
const label = value => stackText(value, locale.value)
const devices = stack.hardware
const software = stack.software
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-16">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('stack') }}</h2>
      <p class="text-[15px] text-muted leading-relaxed mb-10">
        {{ t('myTechStackIsAMixOf') }}
      </p>

      <h3 class="text-xs font-mono text-muted/90 uppercase tracking-widest mb-4">{{ t('hardware') }}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div
          v-for="(d, index) in devices"
          :key="index"
          class="rounded-lg border border-fg/8 p-5 hover:border-accent/30 transition-colors"
        >
          <div class="flex items-center gap-3 mb-4">
            <div class="shrink-0 p-2 rounded-md bg-fg/5 text-accent">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[d.icon]" />
              </svg>
            </div>
            <div>
              <div class="text-xs font-mono text-muted/90 uppercase tracking-widest">{{ label(d.name) }}</div>
              <div class="text-fg font-semibold leading-tight">{{ d.model }}</div>
            </div>
          </div>

          <p v-if="label(d.description)" class="text-sm text-muted mb-4">{{ label(d.description) }}</p>
          <dl v-if="d.rows.length" class="text-sm">
            <div
              v-for="(s, rowIndex) in d.rows"
              :key="rowIndex"
              class="flex items-baseline justify-between gap-4 py-1.5 border-t border-fg/5 first:border-t-0 first:pt-0"
            >
              <dt class="text-muted/90 font-mono text-xs uppercase tracking-wide shrink-0">{{ label(s.label) }}</dt>
              <dd class="text-muted text-right font-mono text-xs">{{ label(s.value) }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section>
      <h3 class="text-xs font-mono text-muted/90 uppercase tracking-widest mb-4">{{ t('software') }}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div
          v-for="(s, index) in software"
          :key="index"
          class="rounded-lg border border-fg/8 p-5 hover:border-accent/30 transition-colors"
        >
          <div class="flex items-center gap-3 mb-4">
            <div class="shrink-0 p-2 rounded-md bg-fg/5 text-accent">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[s.icon]" />
              </svg>
            </div>
            <div class="text-fg font-semibold leading-tight">{{ label(s.name) }}</div>
          </div>

          <p v-if="label(s.description)" class="text-sm text-muted mb-4">{{ label(s.description) }}</p>
          <dl v-if="s.rows.length" class="text-sm">
            <div
              v-for="(r, rowIndex) in s.rows"
              :key="rowIndex"
              class="flex items-baseline justify-between gap-4 py-1.5 border-t border-fg/5 first:border-t-0 first:pt-0"
            >
              <dt class="text-muted/90 font-mono text-xs uppercase tracking-wide shrink-0">{{ label(r.label) }}</dt>
              <dd class="text-muted text-right font-mono text-xs">{{ label(r.value) }}</dd>
            </div>
          </dl>

          <div v-if="s.tags.length" class="flex flex-wrap gap-2 mt-3">
            <span
              v-for="t in s.tags"
              :key="t"
              class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted"
            >{{ t }}</span>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>
