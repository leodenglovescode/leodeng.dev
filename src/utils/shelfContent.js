import { shallowRef } from 'vue'
import initialShelf from '../content/shelf.json'

export const shelfContent = shallowRef(initialShelf)

// Accept local content changes here instead of reloading the whole app and
// throwing the admin back to its initial tab. Public shelves still update live.
if (import.meta.hot) {
  import.meta.hot.accept('../content/shelf.json', module => {
    if (module) shelfContent.value = module.default
  })
}

export async function refreshShelf() {
  if (typeof window === 'undefined' || import.meta.env.DEV) return
  try {
    const response = await fetch('/api/content/public/shelf', {cache:'no-store',signal:AbortSignal.timeout(5000)})
    if (response.ok) {
      const data = await response.json()
      if (Array.isArray(data.items)) shelfContent.value = data
    }
  } catch { /* Static snapshot remains usable during an outage. */ }
}
