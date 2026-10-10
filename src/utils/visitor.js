import { readonly, ref } from 'vue'

const visitor = ref(null)
const visitorLoading = ref(false)
const visitorError = ref(false)
const trace = ref(null)
const traceLoading = ref(false)
const traceError = ref(false)
let visitorRequest, traceRequest

async function getText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  let reader
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
    if (!response.ok || !response.body) throw new Error('Unavailable')
    reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) throw new Error('Oversized response')
      chunks.push(value)
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer())
  } finally {
    clearTimeout(timer)
    controller.abort()
    await reader?.cancel().catch(() => {})
  }
}

export function parseConnectionTrace(source) {
  const fields = Object.create(null)
  for (const line of source.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1).trim().slice(0, 200)
  }
  if (!fields.tls && !fields.kex) throw new Error('No connection details')
  const kex = fields.kex || null
  // TLS 1.3 and cipher names alone do not establish post-quantum key exchange.
  const postQuantum = fields.tls === 'TLSv1.3' && kex === 'X25519MLKEM768' ? true
    : ['X25519', 'P-256', 'P-384', 'P-521'].includes(kex) ? false : null
  return { tlsVersion: fields.tls || null, keyExchange: kex, postQuantum,
    httpProtocol: fields.http || null, colo: fields.colo || null }
}

export function countryName(code, locale = 'en') {
  if (!code || ['XX', 'T1'].includes(code)) return null
  try { return new Intl.DisplayNames([locale === 'zh' ? 'zh-CN' : 'en'], { type: 'region' }).of(code) }
  catch { return code }
}

export function useVisitor() {
  function loadVisitor(refresh = false) {
    if (visitorLoading.value || (visitorRequest && !refresh)) return visitorRequest
    visitorLoading.value = true
    visitorError.value = false
    visitorRequest = (async () => {
      try {
        const data = JSON.parse(await getText('/api/ip'))
        if (!data || !data.network || !data.connection || (data.ip !== null && typeof data.ip !== 'string')) throw new Error('Invalid metadata')
        visitor.value = data
      } catch { visitorError.value = true; visitor.value = null }
      finally { visitorLoading.value = false }
    })()
    return visitorRequest
  }
  function loadTrace(refresh = false) {
    if (traceLoading.value || (traceRequest && !refresh)) return traceRequest
    traceLoading.value = true
    traceError.value = false
    traceRequest = (async () => {
      try { trace.value = parseConnectionTrace(await getText('/cdn-cgi/trace')) }
      catch { traceError.value = true; trace.value = null }
      finally { traceLoading.value = false }
    })()
    return traceRequest
  }
  return { visitor: readonly(visitor), visitorLoading: readonly(visitorLoading), visitorError: readonly(visitorError),
    trace: readonly(trace), traceLoading: readonly(traceLoading), traceError: readonly(traceError), loadVisitor, loadTrace }
}
