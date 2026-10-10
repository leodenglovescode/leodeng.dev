<script setup>
import { computed, onMounted } from 'vue'
import { useLocale } from '../utils/i18n.js'
import { countryName, useVisitor } from '../utils/visitor.js'

const { t, locale } = useLocale('ip')
const { visitor, visitorLoading, visitorError, trace, traceLoading, traceError, loadVisitor, loadTrace } = useVisitor()
function protocolStrength(version) {
  if (version === 'TLSv1.3') return 'strong'
  if (version === 'TLSv1.2') return 'modern'
  if (['TLSv1', 'TLSv1.0', 'TLSv1.1', 'SSLv2', 'SSLv3'].includes(version)) return 'weak'
  return 'unknown'
}
const tlsStrength = computed(() => protocolStrength(visitor.value?.connection.tlsVersion))
const exchangeSecurity = computed(() => trace.value?.postQuantum === true ? 'strong'
  : trace.value?.postQuantum === false ? 'classical' : 'unknown')
const location = computed(() => {
  const name = countryName(visitor.value?.countryCode, locale.value)
  return name ? `${name} (${visitor.value.countryCode})` : t('unknown')
})
const networkRows = computed(() => [
  ['country', location.value], ['region', visitor.value?.region], ['city', visitor.value?.city],
  ['network', visitor.value?.network.organization], ['asn', visitor.value?.network.asn ? `AS${visitor.value.network.asn}` : null],
])
const tlsRows = computed(() => [
  ['tls', visitor.value?.connection.tlsVersion], ['cipher', visitor.value?.connection.cipher],
  ['http', visitor.value?.connection.httpProtocol], ['edge', visitor.value?.connection.colo],
])
const probeRows = computed(() => [
  ['tls', trace.value?.tlsVersion], ['keyExchange', trace.value?.keyExchange],
  ['postQuantum', trace.value?.postQuantum === true ? t('hybrid') : trace.value?.postQuantum === false ? t('classical') : t('unknown')],
  ['http', trace.value?.httpProtocol], ['edge', trace.value?.colo],
])
function refresh() { void loadVisitor(true); void loadTrace(true) }
onMounted(() => { void loadVisitor(); void loadTrace() })
</script>

<template>
  <div class="pt-16 sm:pt-24 pb-20 space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4 mb-7">
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">{{ t('title') }}</h1>
      <div class="flex gap-2 items-center text-xs font-mono">
        <button class="dashboard-action disabled:opacity-50" :disabled="visitorLoading || traceLoading" @click="refresh">{{ t('refresh') }}</button>
        <a href="/api/ip" class="dashboard-action">{{ t('json') }} ↗</a>
      </div>
    </header>

    <section class="ip-card ip-address" :aria-label="t('ip')">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h2 class="data-label">{{ t('ip') }}</h2>
        <span v-if="visitor?.ipVersion" class="text-xs font-mono text-accent bg-accent/10 rounded px-2 py-1">IPv{{ visitor.ipVersion }}</span>
      </div>
      <p class="font-mono text-3xl sm:text-4xl font-medium tracking-tight break-all">{{ visitor?.ip || t('unknown') }}</p>
      <p class="text-sm font-mono text-muted mt-4 break-words">{{ visitor?.network.organization || t('unknown') }}</p>
    </section>

    <p v-if="visitorLoading || visitorError" role="status" class="text-xs text-muted">{{ t(visitorLoading ? 'loading' : 'unavailable') }}</p>

    <div class="grid grid-cols-1 min-[400px]:grid-cols-3 gap-3">
      <section v-for="[label, value] in [['asn', visitor?.network.asn ? `AS${visitor.network.asn}` : null], ['tls', visitor?.connection.tlsVersion], ['edge', visitor?.connection.colo]]" :key="label" class="ip-card p-4 sm:p-5">
        <h2 class="data-label mb-3">{{ t(label) }}</h2>
        <p class="font-mono text-lg sm:text-xl break-all">{{ value || t('unknown') }}</p>
        <span v-if="label === 'tls'" class="security-badge mt-3" :class="`security-${tlsStrength}`">{{ t('strength') }}: {{ t(tlsStrength) }}</span>
      </section>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <section v-for="[heading, rows] in [['networkTitle', networkRows], ['tlsTitle', tlsRows]]" :key="heading" class="ip-card min-w-0">
        <h2 class="card-title">{{ t(heading) }}</h2>
        <dl class="px-5">
          <div v-for="[label, value] in rows" :key="label" class="data-row">
            <dt class="data-label">{{ t(label) }}</dt>
            <dd class="text-sm font-mono break-words">
              <span v-if="label === 'tls'" class="security-badge" :class="`security-${protocolStrength(value)}`">{{ value || t('unknown') }}<template v-if="value"> · {{ t(protocolStrength(value)) }}</template></span>
              <template v-else>{{ value || t('unknown') }}</template>
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="ip-card">
      <div class="card-title flex flex-wrap justify-between items-center gap-3">
        <h2>{{ t('probeTitle') }}</h2>
        <span class="text-xs font-mono text-muted font-normal">/cdn-cgi/trace</span>
      </div>
      <p v-if="traceLoading || traceError" role="status" class="text-xs text-muted px-5 pt-4">{{ t(traceLoading ? 'loading' : 'probeUnavailable') }}</p>
      <div v-if="trace?.postQuantum === true" class="quantum-highlight mx-5 mt-5 rounded-lg p-4" role="status">
        <p class="text-sm font-semibold">✦ {{ t('quantumWelcome') }}</p>
        <p class="text-xs font-mono mt-2 opacity-80">{{ t('hybrid') }} · {{ trace.keyExchange }} · {{ t('probeConnection') }}</p>
      </div>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 px-5">
        <div v-for="[label, value] in probeRows" :key="label" class="data-row">
          <dt class="data-label">{{ t(label) }}</dt>
          <dd class="text-sm font-mono break-words">
            <span v-if="label === 'tls'" class="security-badge" :class="`security-${protocolStrength(value)}`">{{ value || t('unknown') }}<template v-if="value"> · {{ t(protocolStrength(value)) }}</template></span>
            <span v-else-if="label === 'keyExchange' || label === 'postQuantum'" class="security-badge" :class="`security-${exchangeSecurity}`">{{ value || t('unknown') }}<template v-if="label === 'keyExchange' && value"> · {{ t(exchangeSecurity === 'strong' ? 'hybrid' : exchangeSecurity) }}</template></span>
            <template v-else>{{ value || t('unknown') }}</template>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.ip-card {
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  background: color-mix(in srgb, var(--color-fg) 2%, transparent);
  border-radius: 12px;
  overflow: hidden;
}
.ip-address {
  padding: 24px;
  background: linear-gradient(120deg, color-mix(in srgb, var(--color-accent) 9%, transparent), color-mix(in srgb, var(--color-fg) 2%, transparent));
}
.data-label {
  font-size: 12px;
  color: var(--color-muted);
}
.card-title {
  padding: 16px 20px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
}
.data-row {
  display: grid;
  gap: 6px;
  padding: 15px 0;
}
.data-row + .data-row {
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 6%, transparent);
}
.dashboard-action {
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);
  border-radius: 6px;
  color: var(--color-muted);
}
.dashboard-action:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.security-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  font-size: 12px;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  color: var(--color-muted);
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.security-strong, .quantum-highlight {
  color: #157347;
  background: color-mix(in srgb, #157347 10%, transparent);
}
:global(.dark .security-strong), :global(.dark .quantum-highlight) {
  color: #6ee7a0;
  background: color-mix(in srgb, #6ee7a0 10%, transparent);
}
.security-classical {
  color: var(--color-accent);
}
.security-modern {
  color: var(--color-highlight);
}
.security-weak {
  color: #b42318;
}
:global(.dark .security-weak) {
  color: #ff938a;
}
.quantum-highlight {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
}
</style>
