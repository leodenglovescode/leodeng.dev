<script setup>
import Navbar from './components/Navbar.vue'

const socialLinks = [
  {
    label: 'RSS',
    url: '/feed',
    external: false,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>`,
  },
  {
    label: 'GitHub',
    url: 'https://github.com/leodenglovescode',
    external: true,
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  },
  {
    label: 'YouTube',
    url: 'https://www.youtube.com/@leodaviation',
    external: true,
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  },
  {
    label: 'X',
    url: 'https://x.com/@Leodeng14',
    external: true,
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  },
]
</script>

<template>
  <Navbar />
  <main class="max-w-3xl mx-auto px-6">
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>
  <footer class="max-w-3xl mx-auto px-6 py-8 border-t border-fg/5 flex flex-wrap items-center justify-between gap-4">
    <p class="text-xs text-muted/30 font-mono">
      2026 © Leo Deng — Built with Vue, Vite, Tailwind.
    </p>
    <div class="flex items-center gap-5">
      <RouterLink to="/now" class="text-xs font-mono text-muted/50 hover:text-fg transition-colors">Now</RouterLink>
      <div class="flex items-center gap-4">
        <template v-for="link in socialLinks" :key="link.label">
          <RouterLink
            v-if="!link.external"
            :to="link.url"
            :aria-label="link.label"
            class="text-muted/40 hover:text-accent transition-colors"
          >
            <span class="w-4 h-4 block" v-html="link.icon" />
          </RouterLink>
          <a
            v-else
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="link.label"
            class="text-muted/40 hover:text-accent transition-colors"
          >
            <span class="w-4 h-4 block" v-html="link.icon" />
          </a>
        </template>
      </div>
    </div>
  </footer>
</template>
