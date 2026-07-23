<script setup>
import Navbar from './components/Navbar.vue'
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
    <div class="flex gap-4 text-xs font-mono text-muted/30">
      <RouterLink to="/now" class="hover:text-muted transition-colors">now</RouterLink>
      <a href="/rss.xml" class="hover:text-muted transition-colors">rss</a>
    </div>
  </footer>
</template>
