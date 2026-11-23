<script setup>
import { onUnmounted, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'
import qrCode from '../assets/dogecoin-qr.svg'

const address = 'D63M2FebE8vwgei2UtxvU6PoJns2fJscFe'
const walletUrl = `dogecoin:${address}`
const { t } = useLocale('donations')
const copyState = ref('')
let resetTimer

async function copyAddress() {
  clearTimeout(resetTimer)
  try {
    await navigator.clipboard.writeText(address)
    copyState.value = 'copied'
    resetTimer = setTimeout(() => { copyState.value = '' }, 2500)
  } catch {
    copyState.value = 'copyFailed'
  }
}

onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <p class="text-xs font-mono text-muted uppercase tracking-widest mb-3">{{ t('eyebrow') }}</p>
    <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight text-fg mb-5">{{ t('title') }}</h1>
    <p class="text-base leading-relaxed text-muted max-w-xl mb-10">{{ t('intro') }}</p>

    <div class="rounded-xl border border-fg/10 bg-fg/2 p-5 sm:p-8">
      <div class="flex items-center gap-3 mb-7">
        <span aria-hidden="true" class="flex h-11 w-11 items-center justify-center rounded-full border border-highlight/30 bg-highlight/10 text-highlight text-2xl font-mono">Ð</span>
        <span class="font-medium text-fg">{{ t('network') }}</span>
      </div>
      <div class="grid sm:grid-cols-[180px_minmax(0,1fr)] gap-7 items-center">
        <figure class="flex flex-col items-center gap-3">
          <img :src="qrCode" :alt="t('qrAlt')" width="180" height="180" class="rounded-lg bg-white" />
          <figcaption class="text-sm text-muted text-center">{{ t('scan') }}</figcaption>
        </figure>
        <div class="min-w-0">
          <h2 class="text-sm text-muted mb-2">{{ t('addressLabel') }}</h2>
          <code class="block select-all break-all rounded-lg border border-fg/8 bg-bg p-4 text-base font-mono leading-relaxed text-fg">{{ address }}</code>
          <div class="flex flex-wrap gap-3 mt-5">
            <button type="button" @click="copyAddress" class="rounded-lg bg-accent-strong px-4 py-3 text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
              {{ copyState === 'copied' ? t('copied') : t('copy') }}
            </button>
            <a :href="walletUrl" class="rounded-lg border border-fg/15 px-4 py-3 text-sm text-fg hover:border-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">{{ t('openWallet') }}</a>
          </div>
          <p role="status" aria-live="polite" class="text-sm text-muted mt-3 min-h-5">{{ copyState ? t(copyState) : '' }}</p>
        </div>
      </div>
    </div>
    <p class="mt-7 text-sm text-muted">{{ t('thanks') }}</p>
  </section>
</template>
