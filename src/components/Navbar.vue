<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const menuOpen = ref(false)

const navLinks = [
  { label: 'Home',     path: '/' },
  { label: 'About',    path: '/about' },
  { label: 'Projects', path: '/projects' },
  { label: 'Blog',     path: '/blog' },
  { label: 'Contact',  path: '/contact' },
]

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <nav class="sticky top-0 z-50 border-b border-white/5 bg-[#111]">
    <div class="max-w-xl mx-auto px-6 h-14 flex items-center justify-between">

      <RouterLink to="/" class="font-semibold text-white hover:text-accent transition-colors" @click="menuOpen = false">
        leodeng<span class="text-accent">.dev</span>
      </RouterLink>

      <!-- Desktop links -->
      <div class="hidden sm:flex gap-6">
        <RouterLink
          v-for="link in navLinks"
          :key="link.path"
          :to="link.path"
          :class="[
            'text-sm font-mono transition-colors pb-0.5 border-b',
            isActive(link.path)
              ? 'text-white border-accent'
              : 'text-muted hover:text-white border-transparent'
          ]"
        >{{ link.label }}</RouterLink>
      </div>

      <!-- Mobile hamburger -->
      <button
        class="sm:hidden text-muted hover:text-white transition-colors"
        @click="menuOpen = !menuOpen"
        aria-label="Toggle menu"
      >
        <svg v-if="!menuOpen" viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- Mobile menu -->
    <div v-if="menuOpen" class="sm:hidden border-t border-white/5">
      <div class="max-w-xl mx-auto px-6 py-4 flex flex-col gap-1">
        <RouterLink
          v-for="link in navLinks"
          :key="link.path"
          :to="link.path"
          :class="[
            'text-sm font-mono py-2 transition-colors',
            isActive(link.path) ? 'text-white' : 'text-muted'
          ]"
          @click="menuOpen = false"
        >{{ link.label }}</RouterLink>
      </div>
    </div>
  </nav>
</template>
