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
  <footer class="max-w-3xl mx-auto px-6 py-8 border-t border-fg/5">
    <p class="text-xs text-muted/30 font-mono">
      2026 © Leo Deng — Built with Vue, Vite, Tailwind.
    </p>
  </footer>
</template>
