// Explicit application storage, independent of the browser's HTTP cache.
// Versioned firmware/kernel keys and Vite's hashed WASM URL prevent stale reuse.
const VERSION = 'buildroot-7befbaea-bios-73e3f359-a4bc0d80-v1'
let connection
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('leo-linux-assets', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('assets')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Storage blocked'))
  }).catch(() => null)
  return connection
}
export async function readAsset(url) {
  const db = await database()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const request = db.transaction('assets', 'readonly').objectStore('assets').get(`${VERSION}:${url}`)
      request.onsuccess = () => resolve(request.result instanceof ArrayBuffer && request.result.byteLength ? request.result : null)
      request.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function saveAsset(url, buffer) {
  const db = await database()
  if (!db) return false
  return new Promise(resolve => {
    try {
      const transaction = db.transaction('assets', 'readwrite')
      transaction.objectStore('assets').put(buffer, `${VERSION}:${url}`)
      transaction.oncomplete = () => resolve(true)
      transaction.onerror = transaction.onabort = () => resolve(false)
    } catch { resolve(false) }
  })
}
export async function assetsCached(urls) {
  return (await Promise.all(urls.map(readAsset))).every(Boolean)
}
export async function loadAsset(url, { allowDownload, signal }) {
  const cached = await readAsset(url)
  signal?.throwIfAborted()
  if (cached) return cached
  if (!allowDownload) throw new Error('Download consent required')
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error('Asset unavailable')
  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) throw new Error('Empty asset')
  signal?.throwIfAborted()
  await saveAsset(url, buffer)
  return buffer
}
