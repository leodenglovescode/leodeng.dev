<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { useTheme } from '../utils/theme.js'
import { loadXWidgets } from '../utils/xWidgets.js'

const { isZh, t } = useLocale('home')
const { isDark } = useTheme()
const container = ref(null)
const state = ref('loading')
let generation = 0
let timeout

async function renderTimeline() {
  if (!container.value) return
  const current = ++generation
  clearTimeout(timeout)
  state.value = 'loading'
  // Give each render its own host so late iframe responses cannot replace a
  // newer theme or locale, or put a widget back after navigating away.
  const host = document.createElement('div')
  container.value.replaceChildren(host)
  timeout = setTimeout(() => {
    if (current !== generation) return
    generation++
    host.remove()
    state.value = 'error'
  }, 15000)

  try {
    const widgets = await loadXWidgets()
    if (current !== generation) return
    const iframe = await widgets.createTimeline(
      { sourceType: 'profile', screenName: 'Leodeng14' },
      host,
      {
        height: 280,
        theme: isDark.value ? 'dark' : 'light',
        lang: isZh.value ? 'zh-cn' : 'en',
        chrome: 'noheader nofooter noborders transparent',
        dnt: true,
      },
    )
    if (current !== generation) return
    clearTimeout(timeout)
    if (!iframe) throw new Error('X timeline unavailable')
    iframe.title = t('xTimelineTitle')
    state.value = 'ready'
  } catch {
    if (current !== generation) return
    clearTimeout(timeout)
    host.remove()
    state.value = 'error'
  }
}

onMounted(() => {
  // useTheme reads the stored theme on mount. Subscribe afterwards so that
  // initial synchronization and the first render create only one timeline.
  watch([isDark, isZh], renderTimeline, { immediate: true, flush: 'post' })
})
onBeforeUnmount(() => {
  generation++
  clearTimeout(timeout)
})
</script>

<template>
  <section class="mx-auto w-full min-w-0 max-w-72 overflow-hidden rounded-xl bg-fg/[0.035] p-3 sm:max-w-none" aria-labelledby="x-posts-heading" data-legacy-hide="true">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono text-[11px]">
      <h2 id="x-posts-heading" class="text-accent">{{ t('xRecentPosts') }}</h2>
      <a href="https://x.com/Leodeng14" target="_blank" rel="noopener noreferrer" class="text-muted hover:text-fg transition-colors">
        @Leodeng14 ↗
      </a>
    </div>
    <div class="relative overflow-hidden" :class="state === 'error' ? 'min-h-32' : 'h-[280px]'">
      <div ref="container" :class="{ invisible: state !== 'ready' }" />
      <div v-if="state !== 'ready'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
        <p role="status" class="text-xs text-muted">{{ t(state === 'error' ? 'xUnavailable' : 'xLoading') }}</p>
        <a href="https://x.com/Leodeng14" target="_blank" rel="noopener noreferrer" class="text-xs text-accent hover:underline">{{ t('xViewProfile') }} ↗</a>
        <button v-if="state === 'error'" type="button" class="text-xs font-mono text-muted hover:text-fg" @click="renderTimeline">{{ t('xRetry') }}</button>
      </div>
    </div>
  </section>
</template>
