<script setup>
import { ref } from 'vue'
import { useLocale } from '../utils/i18n.js'

const FEED_URL = 'https://leodeng.dev/rss.xml'
const copied = ref(false)
const { t } = useLocale('feed')

async function copyUrl() {
  await navigator.clipboard.writeText(FEED_URL)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">{{ t('rssFeed') }}</h2>

    <div class="space-y-4 text-[15px] leading-relaxed text-muted mb-10">
      <p>
        {{ t('thisIsAWebFeedAlsoKnown') }}
      </p>
      <p>
        {{ t('pasteTheUrlBelowIntoAReader') }}
      </p>
    </div>

    <div class="flex items-center gap-2 mb-10">
      <code class="flex-1 text-xs sm:text-sm font-mono text-fg bg-fg/5 border border-fg/8 rounded-lg px-4 py-3 overflow-x-auto whitespace-nowrap">{{ FEED_URL }}</code>
      <button
        class="shrink-0 text-xs font-mono px-3 py-3 rounded-lg border border-fg/8 text-muted hover:text-fg hover:border-accent/30 transition-colors"
        @click="copyUrl"
      >{{ copied ? t('copied') : t('copy') }}</button>
    </div>

    <a
      href="/rss.xml"
      class="text-sm font-mono text-accent hover:underline"
    >{{ t('viewTheRawFeed') }} ↗</a>
  </section>
</template>
