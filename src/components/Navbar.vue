<script setup>
import { ref } from 'vue'
import { useTheme } from '../utils/theme.js'
import { useRoute, useRouter } from 'vue-router'
import { useLocale } from '../utils/i18n.js'

const route = useRoute()
const router = useRouter()
const menuOpen = ref(false)
const { isDark, toggleTheme } = useTheme()
const { isZh, t, localePath, setLocale } = useLocale('common')

const navLinks = [
  { key: 'home', path: '/' },
  { key: 'about', path: '/about' },
  { key: 'projects', path: '/projects' },
  { key: 'gallery', path: '/gallery' },
  { key: 'stack', path: '/stack' },
  { key: 'blog', path: '/blog' },
  { key: 'contact', path: '/contact' },
]

function isActive(path) {
  const currentPath = route.path.replace(/^\/zh(?=\/|$)/, '') || '/'
  if (path === '/') return currentPath === '/'
  return currentPath.startsWith(path)
}

function switchLocale() {
  const nextLocale = isZh.value ? 'en' : 'zh'
  setLocale(nextLocale)
  router.push(localePath(route.fullPath))
}

</script>

<template>
  <nav class="sticky top-0 z-50 border-b border-fg/5 bg-bg">
    <div class="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">

      <RouterLink :to="localePath('/')" class="font-semibold text-fg hover:text-accent transition-colors" @click="menuOpen = false">
        leodeng<span class="text-accent">.dev</span>
      </RouterLink>

      <!-- Desktop links -->
      <div class="hidden sm:flex items-center gap-6">
        <RouterLink
          v-for="link in navLinks"
          :key="link.path"
          :to="localePath(link.path)"
          :class="[
            'text-sm font-mono transition-colors pb-0.5 border-b',
            isActive(link.path)
              ? 'text-fg border-accent'
              : 'text-muted hover:text-fg border-transparent'
          ]"
        >{{ t(`nav.${link.key}`) }}</RouterLink>

        <button
          class="h-7 min-w-8 rounded-md border border-fg/10 px-1.5 font-mono text-[11px] text-muted hover:border-accent/30 hover:text-fg transition-colors"
          @click="switchLocale"
          :aria-label="isZh ? t('switchToEnglish') : t('switchToChinese')"
          :title="isZh ? t('switchToEnglish') : t('switchToChinese')"
        >{{ isZh ? 'EN' : '中' }}</button>

        <button
          class="text-muted hover:text-fg transition-colors"
          @click="toggleTheme"
          :aria-label="isDark ? t('switchToLightMode') : t('switchToDarkMode')"
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
          class="h-7 min-w-8 rounded-md border border-fg/10 px-1.5 font-mono text-[11px] text-muted hover:border-accent/30 hover:text-fg transition-colors"
          @click="switchLocale"
          :aria-label="isZh ? t('switchToEnglish') : t('switchToChinese')"
        >{{ isZh ? 'EN' : '中' }}</button>
        <button
          class="text-muted hover:text-fg transition-colors"
          @click="toggleTheme"
          :aria-label="isDark ? t('switchToLightMode') : t('switchToDarkMode')"
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
          :aria-label="t('toggleMenu')"
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
          :to="localePath(link.path)"
          :class="[
            'text-sm font-mono py-2 transition-colors',
            isActive(link.path) ? 'text-fg' : 'text-muted'
          ]"
          @click="menuOpen = false"
        >{{ t(`nav.${link.key}`) }}</RouterLink>
      </div>
    </div>
  </nav>
</template>
