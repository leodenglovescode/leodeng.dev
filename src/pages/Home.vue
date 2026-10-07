<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { calcAge } from '../utils/age'
import NowPlaying from '../components/NowPlaying.vue'
import HomeClock from '../components/HomeClock.vue'
import { useLocale } from '../utils/i18n.js'

// Fast enough to feel alive. Most phrases need a beat longer than this to
// actually read, so hovering pauses it.
const STATUS_INTERVAL = 1000

const age = calcAge()
const currentStatus = ref('')
const { isZh, t, localePath } = useLocale('home')
const statuses = computed(() => t('statuses'))

let statusTimer = null

function pickStatus() {
  // Never land on the line already showing — at a one-second cadence a random
  // repeat just reads as the ticker having frozen.
  let next = currentStatus.value
  while (next === currentStatus.value) {
    next = statuses.value[Math.floor(Math.random() * statuses.value.length)]
  }
  currentStatus.value = next
}

function startTicker() {
  clearInterval(statusTimer)
  statusTimer = setInterval(pickStatus, STATUS_INTERVAL)
}

function stopTicker() {
  clearInterval(statusTimer)
  statusTimer = null
}

// Clicking still rerolls, and restarts the clock so the line you asked for
// doesn't get replaced a few milliseconds later.
function rerollStatus() {
  pickStatus()
  if (statusTimer) startTicker()
}

onMounted(() => {
  pickStatus()

  // Text that rewrites itself every second is exactly what "reduce motion"
  // asks you not to do (WCAG 2.2.2). Those visitors get one status and the
  // click-to-reroll, which is the whole joke anyway.
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) startTicker()
})

watch(isZh, () => {
  pickStatus()
})

// The ticker must not outlive the page — this is a route component, so
// navigating away left them running.
onBeforeUnmount(() => {
  clearInterval(statusTimer)
})
</script>

<template>
  <header class="pt-20 sm:pt-32 pb-20 flex flex-col-reverse sm:flex-row items-center sm:items-start gap-10 sm:gap-12">
    <div class="flex-1">
      <HomeClock />

      <h1 class="text-3xl sm:text-4xl font-bold text-fg leading-tight mb-4">
        {{ t('heyIMLeo') }}<span class="text-highlight">{{ isZh ? '。' : '.' }}</span>
      </h1>

      <p class="text-lg text-muted leading-relaxed mb-3">
        {{ t('yearOldAiAssistedFullStackDev', { p0: age }) }}
      </p>
      <br/>
      <p class="text-lg text-muted leading-relaxed mb-3">{{ t('whatIMUpToMaybe') }}</p>
      <p
        class="text-sm text-muted/90 font-mono cursor-pointer hover:text-accent transition-colors"
        :title="t('hoverToPauseClickToReroll')"
        @click="rerollStatus"
        @mouseenter="stopTicker"
        @mouseleave="startTicker"
      >
        > {{ currentStatus }} <span class="text-highlight animate-pulse">▊</span>
      </p>

      <div class="flex gap-8 mt-12">
        <RouterLink :to="localePath('/projects')" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → {{ t('projects') }}
        </RouterLink>
        <RouterLink :to="localePath('/blog')" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → {{ t('blog') }}
        </RouterLink>
        <RouterLink :to="localePath('/about')" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → {{ t('about') }}
        </RouterLink>
      </div>
    </div>

    <div class="flex w-full shrink-0 flex-col items-center gap-4 sm:w-64">
      <img
        src="/leo_profilepic.webp"
        alt="Leo Deng"
        class="h-32 w-32 rounded-full border-2 border-accent object-cover sm:h-48 sm:w-48"
      />
      <NowPlaying />
    </div>
  </header>
</template>
