let widgetsPromise

// Keep one script across route visits. A failed load can be retried.
export function loadXWidgets() {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr.widgets)
  if (widgetsPromise) return widgetsPromise

  widgetsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = setTimeout(() => finish(new Error('X widgets timed out')), 12000)

    function finish(error) {
      clearTimeout(timeout)
      script.onload = null
      script.onerror = null
      if (error) {
        script.remove()
        reject(error)
      } else {
        resolve(window.twttr.widgets)
      }
    }

    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    script.onload = () => finish(window.twttr?.widgets ? null : new Error('X widgets unavailable'))
    script.onerror = () => finish(new Error('X widgets failed to load'))
    document.head.appendChild(script)
  }).catch(error => {
    widgetsPromise = null
    throw error
  })

  return widgetsPromise
}
