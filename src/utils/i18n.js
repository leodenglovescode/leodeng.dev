import { computed, readonly, ref } from 'vue'
import { message } from './messages.js'
import { localeFromPath, localePath } from './localePath.js'

const STORAGE_KEY = 'leodeng:locale'
const locale = ref('en')

function browserLocale() {
  if (typeof navigator === 'undefined') return 'en'
  const primaryLanguage = navigator.languages?.[0] || navigator.language || ''
  return String(primaryLanguage).toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en'
}

export function initLocale(path = '/') {
  if (typeof window === 'undefined') {
    locale.value = localeFromPath(path)
    return { preferredLocale: locale.value, hasStoredPreference: false }
  }

  let stored = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private browsing and strict storage policies can make localStorage throw.
  }
  const hasStoredPreference = stored === 'zh' || stored === 'en'
  const preferredLocale = hasStoredPreference ? stored : browserLocale()
  locale.value = localeFromPath(path)
  applyDocumentLanguage()

  return { preferredLocale, hasStoredPreference }
}

export function setLocale(next, { remember = true } = {}) {
  locale.value = next === 'zh' ? 'zh' : 'en'
  if (typeof localStorage !== 'undefined' && remember) {
    try {
      localStorage.setItem(STORAGE_KEY, locale.value)
    } catch {
      // The active tab still switches even when the preference cannot persist.
    }
  }
  applyDocumentLanguage()
}

export function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh')
}

function interpolate(value, params) {
  if (typeof value !== 'string' || !params) return value
  return value.replace(/\{([\w]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ))
}

export function useLocale(namespace = 'common') {
  const isZh = computed(() => locale.value === 'zh')
  const t = (key, params) => interpolate(message(locale.value, namespace, key), params)
  const localized = (value) => {
    if (value && typeof value === 'object') return value[locale.value] || value.en || value.zh || ''
    return value ?? ''
  }
  const localizePath = (path) => localePath(path, locale.value)

  return {
    locale: readonly(locale),
    isZh,
    t,
    localized,
    localePath: localizePath,
    setLocale,
    toggleLocale,
  }
}

export { browserLocale, locale }
