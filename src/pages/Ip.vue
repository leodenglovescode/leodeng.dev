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
  ['country', location.value],
  ['location', [...new Set([visitor.value?.city, visitor.value?.region].filter(Boolean))].join(', ') || null],
])
const securityRows = computed(() => {
  const api = visitor.value?.connection
  const rows = [
    ['tls', api?.tlsVersion], ['http', api?.httpProtocol],
    ['cipher', api?.cipher], ['keyExchange', trace.value?.keyExchange],
  ]
  // The probe is a separate request. Only add its TLS version when it differs.
  if (trace.value?.tlsVersion && trace.value.tlsVersion !== api?.tlsVersion) rows.push(['probeTls', trace.value.tlsVersion])
  return rows
})
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
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-mono text-muted mt-4">
        <p class="break-words">{{ visitor?.network.organization || t('unknown') }}</p>
        <span v-if="visitor?.network.asn" class="text-xs border border-fg/10 rounded px-2 py-1">AS{{ visitor.network.asn }}</span>
      </div>
    </section>

    <p v-if="visitorLoading || visitorError" role="status" class="text-xs text-muted">{{ t(visitorLoading ? 'loading' : 'unavailable') }}</p>

    <section class="ip-card">
      <div class="card-title flex flex-wrap justify-between items-center gap-3">
        <h2>{{ t('securityTitle') }}</h2>
        <span class="text-xs font-mono text-muted font-normal">{{ t('apiAndProbe') }}</span>
      </div>
      <p v-if="traceLoading || traceError" role="status" class="text-xs text-muted px-5 pt-4">{{ t(traceLoading ? 'loading' : 'probeUnavailable') }}</p>
      <div v-if="trace?.postQuantum === true" class="quantum-highlight mx-5 mt-5 rounded-lg p-4" role="status">
        <p class="text-sm font-semibold">✦ {{ t('quantumWelcome') }}</p>
      </div>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 px-5">
        <div v-for="[label, value] in securityRows" :key="label" class="data-row">
          <dt class="data-label">{{ t(label) }}<span v-if="label === 'keyExchange'" class="ml-2 text-[10px] font-mono">{{ t('probeConnection') }}</span></dt>
          <dd class="text-sm font-mono break-words">
            <span v-if="label === 'tls' || label === 'probeTls'" class="security-badge" :class="`security-${protocolStrength(value)}`">{{ value || t('unknown') }}<template v-if="value"> · {{ t(protocolStrength(value)) }}</template></span>
            <span v-else-if="label === 'keyExchange'" class="security-badge" :class="`security-${exchangeSecurity}`">{{ value || t('unknown') }}<template v-if="value && exchangeSecurity !== 'strong'"> · {{ t(exchangeSecurity) }}</template></span>
            <template v-else>{{ value || t('unknown') }}</template>
          </dd>
        </div>
      </dl>
    </section>

    <section class="ip-card" aria-labelledby="connection-route-title">
      <div class="card-title flex flex-wrap items-center justify-between gap-3">
        <h2 id="connection-route-title">{{ t('routeTitle') }}</h2>
        <span class="text-xs font-mono text-muted font-normal">/api/ip</span>
      </div>
      <ol class="route-nodes p-5">
        <li v-for="(node, index) in [[t('browser'), null], [t('cloudflareEdge'), visitor?.connection.colo || t('unknown')], [t('website'), 'leodeng.dev']]" :key="index" class="route-node">
          <p class="data-label mb-3"><span class="text-accent mr-2">0{{ index + 1 }}</span>{{ node[0] }}</p>
          <p v-if="node[1]" class="font-mono text-sm break-words">{{ node[1] }}</p>
          <span v-if="index < 2" class="route-arrow text-muted" aria-hidden="true">→</span>
        </li>
      </ol>
    </section>

    <section class="ip-card">
      <h2 class="card-title">{{ t('networkTitle') }}</h2>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-5">
        <div v-for="[label, value] in networkRows" :key="label" class="data-row">
          <dt class="data-label">{{ t(label) }}</dt>
          <dd class="text-sm font-mono break-words">{{ value || t('unknown') }}</dd>
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
.route-nodes { display: grid; grid-template-columns: 1fr; gap: 24px; }
.route-node { position: relative; min-width: 0; padding: 16px; border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent); border-radius: 8px; }
.route-arrow { position: absolute; left: 50%; bottom: -23px; transform: translateX(-50%) rotate(90deg); }
@media (min-width: 640px) {
  .route-nodes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .route-arrow { left: auto; bottom: auto; right: -20px; top: 50%; transform: translateY(-50%); }
}
</style>
