<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const email = 'leodeng@leodeng.dev'
const copied = ref(false)

const statuses = [
  'Coding...',
  'Debugging...',
  'Breaking things...',
  'Fixing what I broke...',
  'Drinking coffee...',
  'Staring at error logs...',
  'Shipping features...',
  'Probably procrastinating...',
]
const statusIndex = ref(0)
let statusTimer

onMounted(() => {
  statusTimer = setInterval(() => {
    statusIndex.value = (statusIndex.value + 1) % statuses.length
  }, 1000)
})

onUnmounted(() => {
  clearInterval(statusTimer)
})

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(email)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    // clipboard API unavailable/blocked — mailto link below still works
    window.location.href = `mailto:${email}`
  }
}

const links = [
  {
    label: 'GitHub',
    url: 'https://github.com/leodenglovescode',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  },
  {
    label: 'X',
    url: 'https://x.com/@Leodeng14',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  },
  {
    label: 'YouTube',
    url: 'https://www.youtube.com/@leodavicode',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  },
  {
    label: 'ShutterWingPhotos',
    url: 'https://shutterwingphotos.com',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  },
]
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-xs font-mono text-muted uppercase tracking-widest mb-3">Get In Touch</h2>

    <div class="flex items-center gap-2 mb-10">
      <span class="relative flex w-2 h-2">
        <span class="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping"></span>
        <span class="relative inline-flex w-2 h-2 rounded-full bg-accent"></span>
      </span>
      <span class="text-xs font-mono text-muted/70 w-44">{{ statuses[statusIndex] }}</span>
    </div>

    <button
      type="button"
      @click="copyEmail"
      class="group w-full flex items-center justify-between gap-4 px-5 py-5 mb-8 rounded-lg border border-fg/8 hover:border-accent/30 transition-colors text-left cursor-pointer"
    >
      <div class="min-w-0">
        <div class="text-[11px] font-mono text-muted/50 uppercase tracking-widest mb-1">Email</div>
        <div class="text-lg sm:text-xl text-fg font-medium truncate">{{ email }}</div>
      </div>
      <span
        class="shrink-0 text-xs font-mono px-3 py-1.5 rounded-full border transition-colors"
        :class="copied ? 'border-accent/40 text-accent' : 'border-fg/10 text-muted group-hover:text-accent group-hover:border-accent/30'"
      >
        {{ copied ? 'copied ✓' : 'copy' }}
      </span>
    </button>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <a
        v-for="link in links"
        :key="link.label"
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        class="group flex flex-col items-center gap-3 px-4 py-6 rounded-lg border border-fg/8 hover:border-accent/30 transition-colors text-center"
      >
        <span class="w-6 h-6 text-muted/60 group-hover:text-accent transition-colors" v-html="link.icon" />
        <span class="text-sm text-muted group-hover:text-fg transition-colors">{{ link.label }}</span>
      </a>
    </div>
  </section>
</template>
