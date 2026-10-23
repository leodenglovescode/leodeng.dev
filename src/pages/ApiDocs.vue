<script setup>
import { computed } from 'vue'
import nowData from '../content/now.json'
import { nowPayload, NOW_API_URL } from '../../lib/now-api.js'
import { useLocale } from '../utils/i18n.js'

const { t, isZh, localePath } = useLocale('api-docs')
const endpoint = computed(() => NOW_API_URL + (isZh.value ? '?lang=zh' : ''))
const example = computed(() => {
  const payload = nowPayload(nowData, isZh.value ? 'zh' : 'en')
  return JSON.stringify({ ...payload, events: payload.events.slice(0, 1) }, null, 2)
})
const curl = computed(() => `curl --fail --silent --show-error '${endpoint.value}'`)
const agentExample = computed(() => `${curl.value} \\\n  | jq '.events[] | select(.status == "active") | {id, title, details}'`)
const fields = [
  ['schemaVersion', 'schema'], ['url', 'url'], ['language', 'languageField'],
  ['updatedAt', 'updatedAt'], ['detailsFormat', 'detailsFormat'], ['events[]', 'events'],
  ['events[].id', 'id'], ['events[].status', 'status'],
  ['events[].startedAt / updatedAt / finishedAt', 'dates'],
]
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-8">{{ t('title') }}</h2>
    <p class="text-sm text-muted leading-relaxed mb-10">{{ t('intro') }}</p>
    <article class="api-docs prose">
      <h3>{{ t('nowTitle') }}</h3>
      <p>{{ t('nowDescription') }}</p>
      <p class="flex flex-wrap gap-5"><RouterLink :to="localePath('/now')">{{ t('viewPage') }} →</RouterLink><a :href="endpoint">{{ t('openEndpoint') }} ↗</a></p>
      <h4>{{ t('request') }}</h4>
      <pre><code>GET /api/now</code></pre>
      <p>{{ t('language') }}</p>
      <pre><code>{{ curl }}</code></pre>
      <h4>{{ t('example') }}</h4>
      <p>{{ t('exampleNote') }}</p>
      <pre><code>{{ example }}</code></pre>
      <h4>{{ t('fields') }}</h4>
      <div class="overflow-x-auto"><table>
        <thead><tr><th scope="col">{{ t('field') }}</th><th scope="col">{{ t('meaning') }}</th></tr></thead>
        <tbody><tr v-for="[field, description] in fields" :key="field"><td><code>{{ field }}</code></td><td>{{ t(description) }}</td></tr></tbody>
      </table></div>
      <h4>{{ t('agentTitle') }}</h4>
      <p>{{ t('agentIntro') }}</p>
      <pre><code>{{ agentExample }}</code></pre>
      <h4>{{ t('httpTitle') }}</h4>
      <p>{{ t('http') }}</p>
      <p>{{ t('errors') }}</p>
    </article>
  </section>
</template>

<style scoped>
.api-docs pre { max-width: 100%; overflow-x: auto; font-size: 13px; }
.api-docs td:first-child { min-width: 10rem; overflow-wrap: anywhere; }
.api-docs td code { white-space: normal; }
</style>
