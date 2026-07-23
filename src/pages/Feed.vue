<script setup>
import { ref } from 'vue'

const FEED_URL = 'https://leodeng.dev/rss.xml'
const copied = ref(false)

async function copyUrl() {
  await navigator.clipboard.writeText(FEED_URL)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">RSS Feed</h2>

    <div class="space-y-4 text-[15px] leading-relaxed text-muted mb-10">
      <p>
        This is a web feed, also known as an RSS feed. It lets you follow new blog posts
        from this site in a feed reader app, without an algorithm, an account, or any tracking —
        just new posts, in order, the moment they're published.
      </p>
      <p>
        Paste the URL below into a reader like Feedly, NetNewsWire, Reeder, or Inoreader, and
        you'll get new posts automatically.
      </p>
    </div>

    <div class="flex items-center gap-2 mb-10">
      <code class="flex-1 text-xs sm:text-sm font-mono text-fg bg-fg/5 border border-fg/8 rounded-lg px-4 py-3 overflow-x-auto whitespace-nowrap">{{ FEED_URL }}</code>
      <button
        class="shrink-0 text-xs font-mono px-3 py-3 rounded-lg border border-fg/8 text-muted hover:text-fg hover:border-accent/30 transition-colors"
        @click="copyUrl"
      >{{ copied ? 'copied!' : 'copy' }}</button>
    </div>

    <a
      href="/rss.xml"
      class="text-sm font-mono text-accent hover:underline"
    >View the raw feed ↗</a>
  </section>
</template>
