import { onMounted, readonly, ref } from 'vue'

const isDark = ref(true)
export function useTheme() {
  onMounted(() => { isDark.value = document.documentElement.classList.contains('dark') })
  function setTheme(dark) {
    isDark.value = dark
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch { /* Keep the active theme when storage is unavailable. */ }
  }
  return { isDark: readonly(isDark), setTheme, toggleTheme: () => setTheme(!isDark.value) }
}
