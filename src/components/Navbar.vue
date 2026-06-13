<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const menuOpen = ref(false)
const isDark = ref(true)

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

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
})
</script>

<template>
  <nav class="sticky top-0 z-50 border-b border-fg/5 bg-bg">
    <div class="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">

      <RouterLink to="/" class="font-semibold text-fg hover:text-accent transition-colors" @click="menuOpen = false">
        leodeng<span class="text-accent">.dev</span>
      </RouterLink>

      <!-- Desktop links -->
      <div class="hidden sm:flex items-center gap-6">
        <RouterLink
          v-for="link in navLinks"
          :key="link.path"
          :to="link.path"
          :class="[
            'text-sm font-mono transition-colors pb-0.5 border-b',
            isActive(link.path)
              ? 'text-fg border-accent'
              : 'text-muted hover:text-fg border-transparent'
          ]"
        >{{ link.label }}</RouterLink>

        <button
          class="text-muted hover:text-fg transition-colors"
          @click="toggleTheme"
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <svg v-if="isDark" viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        </button>
      </div>

      <!-- Mobile controls -->
      <div class="sm:hidden flex items-center gap-4">
        <button
          class="text-muted hover:text-fg transition-colors"
          @click="toggleTheme"
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <svg v-if="isDark" viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        </button>

        <!-- Mobile hamburger -->
        <button
          class="text-muted hover:text-fg transition-colors"
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
    </div>

    <!-- Mobile menu -->
    <div v-if="menuOpen" class="sm:hidden border-t border-fg/5">
      <div class="max-w-3xl mx-auto px-6 py-4 flex flex-col gap-1">
        <RouterLink
          v-for="link in navLinks"
          :key="link.path"
          :to="link.path"
          :class="[
            'text-sm font-mono py-2 transition-colors',
            isActive(link.path) ? 'text-fg' : 'text-muted'
          ]"
          @click="menuOpen = false"
        >{{ link.label }}</RouterLink>
      </div>
    </div>
  </nav>
</template>
