<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'
import LinuxTerminal from '../components/LinuxTerminal.vue'
import { terminalFiles } from '../utils/terminal/files.js'

const { t, localePath, localized } = useLocale('terminal')
const { t: aboutText } = useLocale('about')
const siteFiles = computed(() => terminalFiles({ t, aboutText, localized }))
const terminalWindow = ref(null)
const fullscreen = ref(false)
const expanded = ref(false)
let previousOverflow = ''
function setExpanded(value) {
  if (value === expanded.value) return
  if (value) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else document.body.style.overflow = previousOverflow
  expanded.value = value
  fullscreen.value = value
}
function syncFullscreen() {
  fullscreen.value = expanded.value || document.fullscreenElement === terminalWindow.value
}
async function toggleFullscreen() {
  if (expanded.value) { setExpanded(false); return }
  if (document.fullscreenElement === terminalWindow.value) {
    await document.exitFullscreen().catch(() => {})
    return
  }
  if (terminalWindow.value?.requestFullscreen) {
    try { await terminalWindow.value.requestFullscreen(); syncFullscreen(); return } catch { /* Expand within the page when fullscreen is unavailable. */ }
  }
  setExpanded(true)
}
function escapeExpanded(event) {
  if (event.key === 'Escape' && expanded.value) setExpanded(false)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
  document.addEventListener('keydown', escapeExpanded)
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  document.removeEventListener('keydown', escapeExpanded)
  if (expanded.value) setExpanded(false)
  if (document.fullscreenElement === terminalWindow.value) void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <section class="pt-16 sm:pt-24 pb-16">
    <div class="flex items-end justify-between gap-4 mb-5">
      <div>
        <p class="text-xs font-mono uppercase tracking-widest text-muted mb-2">{{ t('eyebrow') }}</p>
        <h1 class="text-2xl font-semibold">{{ t('title') }}</h1>
      </div>
      <RouterLink :to="localePath('/')" class="text-xs text-muted hover:text-accent font-mono">{{ t('back') }} ↗</RouterLink>
    </div>
    <div ref="terminalWindow" class="terminal-window rounded-lg overflow-hidden border shadow-xl" :class="{ 'terminal-expanded': expanded }">
      <div class="terminal-titlebar flex items-center justify-between gap-3 px-4 py-3 border-b">
        <span class="text-xs font-mono text-[#a0a49d]">Buildroot Linux</span>
        <button type="button" class="terminal-fullscreen text-xs font-mono px-2 py-1 rounded border" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? t('exitFullscreen') : t('fullscreen') }}</button>
      </div>
      <LinuxTerminal :files="siteFiles" :fullscreen="fullscreen" />
    </div>
    <p class="text-xs text-muted leading-relaxed mt-4">{{ t('linuxHint') }}</p>
  </section>
</template>

<style scoped>
.terminal-window { background: #0c0e11; border-color: #34383d; color: #d1d5cb; }
.terminal-titlebar { background: #171a1e; border-color: #34383d; }
.terminal-fullscreen { border-color: #484e53; color: #bdc7b3; }
.terminal-fullscreen:hover { background: #293026; }
.terminal-window:fullscreen, .terminal-expanded { display: flex; flex-direction: column; width: 100%; height: 100%; border: 0; border-radius: 0; box-shadow: none; }
.terminal-expanded { position: fixed; inset: 0; z-index: 100; height: 100dvh; }
.terminal-window:fullscreen .terminal-titlebar, .terminal-expanded .terminal-titlebar { flex-shrink: 0; border: 0; background: #0c0e11; }
.terminal-window:fullscreen .terminal-fullscreen, .terminal-expanded .terminal-fullscreen { border: 0; }
.terminal-window:fullscreen :deep(.linux-terminal), .terminal-expanded :deep(.linux-terminal) { min-height: 0; }
.terminal-window:fullscreen .terminal-titlebar, .terminal-expanded .terminal-titlebar { position: absolute; top: 8px; right: 8px; z-index: 1; padding: 0; background: transparent; }
.terminal-window:fullscreen .terminal-titlebar > span, .terminal-expanded .terminal-titlebar > span { display: none; }
.terminal-window:fullscreen .terminal-fullscreen, .terminal-expanded .terminal-fullscreen { opacity: .3; }
.terminal-window:fullscreen .terminal-fullscreen:hover, .terminal-expanded .terminal-fullscreen:hover,
.terminal-window:fullscreen .terminal-fullscreen:focus-visible, .terminal-expanded .terminal-fullscreen:focus-visible { opacity: 1; }
</style>
