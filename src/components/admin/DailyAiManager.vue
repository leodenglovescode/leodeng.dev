<script setup>
import { onMounted, ref } from 'vue'
import { localAdmin } from '../../utils/adminApi.js'

const state = ref(null), error = ref(''), busy = ref(false), offset = ref(0)
async function request(body) {
  const response = await fetch(`/api/admin/daily-ai${body ? '' : `?offset=${offset.value}`}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`)
  return data
}
async function refresh() {
  if (localAdmin.value) return
  busy.value = true; error.value = ''
  try { state.value = await request() } catch (failure) { error.value = failure.message } finally { busy.value = false }
}
async function change(body) {
  busy.value = true; error.value = ''
  try { await request(body); state.value = await request() } catch (failure) { error.value = failure.message } finally { busy.value = false }
}
async function unban(ip) {
  if (confirm(`Remove the permanent Daily AI ban for ${ip}? A new malformed request will ban it again.`)) await change({ unban: ip })
}
function page(next) { offset.value = next; void refresh() }
const date = value => value ? new Date(value).toLocaleString() : 'Never'
onMounted(() => { void refresh() })
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Daily AI controls</h2>
    <p v-if="localAdmin" class="text-sm text-muted">These controls use Cloudflare D1. Open the deployed admin page to manage the live feature. Local file-editor sessions cannot change production controls.</p>
    <template v-else>
      <p class="text-sm text-muted mb-5">Five fixed questions, generated live by the homelab. No visitor text reaches the model.</p>
      <p v-if="error" role="alert" class="text-sm text-red-400 mb-5">{{ error }}</p>
      <div v-if="state" class="border border-fg/10 rounded-lg p-5 mb-8">
        <p class="font-mono text-sm mb-4">{{ state.enabled ? 'Enabled' : 'Disabled' }} · revision {{ state.revision }}</p>
        <button v-if="state.enabled" type="button" :disabled="busy" class="bg-red-700 text-white px-4 py-3 rounded-md font-medium disabled:opacity-50" @click="change({ enabled: false })">Disable AI endpoint now</button>
        <button v-else type="button" :disabled="busy" class="bg-accent-strong text-white px-4 py-3 rounded-md disabled:opacity-50" @click="change({ enabled: true })">Enable Daily AI</button>
        <button type="button" :disabled="busy" class="block mt-4 text-sm border border-accent/40 text-accent rounded px-4 py-2 disabled:opacity-50" @click="change({ resetAll: true })">Clear all AI limits</button>
        <p class="text-xs text-muted mt-2">Resets every IP's daily allowance, removes all AI bans, and resets traffic and compute counters. Active generations are cancelled. The kill switch stays as it is.</p>
        <p class="text-xs text-muted mt-4">Disabling immediately blocks new answer reads and generation. The live relay cancels active work, and the homelab also checks this switch during generation and releases its model. Already downloaded answers cannot be recalled.</p>
        <p class="text-xs text-muted mt-3">Previous batch: {{ state.batch?.day || 'None' }} · {{ state.batch?.model || 'No model yet' }} · received {{ date(state.batch?.received_at) }}</p>
      </div>
      <div class="flex justify-between items-center mb-4 gap-4"><h3 class="font-semibold">Permanent AI bans <span v-if="state" class="text-muted">({{ state.total }})</span></h3><button type="button" :disabled="busy" class="text-sm text-accent disabled:opacity-50" @click="refresh">Refresh</button></div>
      <p class="text-xs text-muted mb-4">Bans apply only to the AI endpoint. Malformed requests and curl/Python user agents are banned immediately. IPs can be shared or reassigned; user-agent strings can be spoofed. Removing a ban does not reset today's question allowance.</p>
      <p v-if="busy && !state" class="text-sm text-muted">Loading controls…</p>
      <p v-else-if="!state?.bans.length" class="text-sm text-muted">No bans on this page.</p>
      <ul v-else class="divide-y divide-fg/10"><li v-for="ban in state.bans" :key="ban.ip" class="py-4 flex justify-between items-start gap-4"><div class="min-w-0"><p class="font-mono text-sm break-all">{{ ban.ip }}</p><p class="text-sm text-muted mt-1">{{ ban.reason }}</p><p class="text-xs text-muted mt-1">{{ date(ban.created_at) }}</p></div><button type="button" :disabled="busy" class="text-sm text-accent shrink-0 disabled:opacity-50" @click="unban(ban.ip)">Remove ban</button></li></ul>
      <div v-if="state" class="flex gap-5 mt-5 text-sm text-accent"><button type="button" :disabled="busy || offset === 0" class="disabled:opacity-30" @click="page(Math.max(0, offset - 50))">Previous</button><button type="button" :disabled="busy || offset + 50 >= state.total" class="disabled:opacity-30" @click="page(offset + 50)">Next</button></div>
    </template>
  </section>
</template>
