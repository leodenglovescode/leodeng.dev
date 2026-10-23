<script setup>
import { computed } from 'vue'
import stack from '../content/stack.json'
import { STACK_ICONS as ICONS, stackText } from '../utils/stack.js'
import { useLocale } from '../utils/i18n.js'

const { t, locale } = useLocale('stack')
const label = value => stackText(value, locale.value)
const isComputer = item => (item.group || (['desktop', 'laptop', 'phone', 'cpu'].includes(item.icon) ? 'computers' : 'gear')) === 'computers'
const computers = computed(() => stack.hardware.filter(isComputer))
const gear = computed(() => stack.hardware.filter(item => !isComputer(item)))
const software = stack.software
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-14">
    <header>
      <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">{{ t('stack') }}</p>
      <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight text-fg mb-4">{{ t('pageTitle') }}</h1>
      <p class="text-[15px] text-muted leading-relaxed max-w-xl">{{ t('myTechStackIsAMixOf') }}</p>
      <nav :aria-label="t('sections')" class="flex flex-wrap gap-x-6 gap-y-3 mt-7 text-sm">
        <a v-if="computers.length" href="#computers" class="section-link">{{ t('computers') }} <span class="text-muted/70 font-mono text-xs">{{ computers.length }}</span></a>
        <a v-if="gear.length" href="#gear" class="section-link">{{ t('gear') }} <span class="text-muted/70 font-mono text-xs">{{ gear.length }}</span></a>
        <a v-if="software.length" href="#software" class="section-link">{{ t('software') }} <span class="text-muted/70 font-mono text-xs">{{ software.length }}</span></a>
      </nav>
    </header>

    <section v-if="computers.length" id="computers" class="scroll-mt-24" aria-labelledby="computers-title">
      <div class="section-heading">
        <h2 id="computers-title">{{ t('computers') }}</h2>
        <p>{{ t('computersDescription') }}</p>
      </div>
      <div class="border-y border-fg/10 divide-y divide-fg/10">
        <article v-for="(device, index) in computers" :key="index" class="device-row">
          <header class="min-w-0">
            <div class="flex items-center gap-2 text-accent mb-2">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[device.icon]" /></svg>
              <p class="text-xs font-mono">{{ label(device.name) }}</p>
            </div>
            <h3 class="font-semibold text-fg leading-snug">{{ device.model }}</h3>
            <p v-if="label(device.description)" class="text-sm text-muted leading-relaxed mt-2">{{ label(device.description) }}</p>
          </header>
          <dl v-if="device.rows.length" class="details-list">
            <div v-for="(row, rowIndex) in device.rows" :key="rowIndex" class="detail-row">
              <dt>{{ label(row.label) }}</dt>
              <dd>{{ label(row.value) }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>

    <section v-if="gear.length" id="gear" class="scroll-mt-24" aria-labelledby="gear-title">
      <div class="section-heading">
        <h2 id="gear-title">{{ t('gear') }}</h2>
        <p>{{ t('gearDescription') }}</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        <article v-for="(device, index) in gear" :key="index" class="stack-card">
          <header class="mb-4">
            <div class="flex items-center gap-2 text-accent mb-2">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[device.icon]" /></svg>
              <p class="text-xs font-mono">{{ label(device.name) }}</p>
            </div>
            <h3 class="font-semibold text-fg leading-snug">{{ device.model }}</h3>
          </header>
          <p v-if="label(device.description)" class="text-sm text-muted leading-relaxed mb-4">{{ label(device.description) }}</p>
          <dl v-if="device.rows.length" class="details-list">
            <div v-for="(row, rowIndex) in device.rows" :key="rowIndex" class="detail-row">
              <dt>{{ label(row.label) }}</dt>
              <dd>{{ label(row.value) }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>

    <section v-if="software.length" id="software" class="scroll-mt-24" aria-labelledby="software-title">
      <div class="section-heading">
        <h2 id="software-title">{{ t('software') }}</h2>
        <p>{{ t('softwareDescription') }}</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        <article v-for="(group, index) in software" :key="index" class="stack-card" :class="{ 'sm:col-span-2': group.rows.length > 3 }">
          <header class="flex items-center gap-2 mb-4">
            <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 text-accent" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[group.icon]" /></svg>
            <h3 class="font-semibold text-fg">{{ label(group.name) }}</h3>
          </header>
          <p v-if="label(group.description)" class="text-sm text-muted leading-relaxed mb-4">{{ label(group.description) }}</p>
          <dl v-if="group.rows.length" class="details-list software-details">
            <div v-for="(row, rowIndex) in group.rows" :key="rowIndex" class="detail-row">
              <dt>{{ label(row.label) }}</dt>
              <dd>{{ label(row.value) }}</dd>
            </div>
          </dl>
          <ul v-if="group.tags.length" class="flex flex-wrap gap-2" :class="{ 'mt-4': group.rows.length }">
            <li v-for="(tag, tagIndex) in group.tags" :key="tagIndex" class="text-sm px-2.5 py-1 rounded-md bg-fg/5 text-fg/80">{{ tag }}</li>
          </ul>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
@reference '../style.css';
.section-link { @apply inline-flex items-center gap-2 text-muted hover:text-accent transition-colors; }
.section-link:focus-visible { @apply outline-2 outline-accent outline-offset-4 rounded-sm; }
.section-heading { @apply mb-5; }
.section-heading h2 { @apply text-lg font-semibold text-fg tracking-tight; }
.section-heading p { @apply text-sm text-muted leading-relaxed mt-1; }
.device-row { @apply grid gap-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8; }
.stack-card { @apply min-w-0 rounded-lg border border-fg/10 p-5; }
.details-list { @apply min-w-0 space-y-2.5; }
.detail-row { @apply grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm leading-relaxed; }
.detail-row dt { @apply text-muted break-words; }
.detail-row dd { @apply text-fg/80 min-w-0; overflow-wrap: anywhere; }
.software-details .detail-row { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
</style>
