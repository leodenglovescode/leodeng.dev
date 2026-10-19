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
