<script setup>
import { onUnmounted, ref } from 'vue'

const fingerprint = 'E094 528D 309A 2FF1 944C CD16 F125 FF88 CB72 9CCC'
const publicKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEao703RYJKwYBBAHaRw8BAQdA/dCjqV/k11lf0gQDfjMDbLY9BOq89TblV7wx
k1FezAm0HkxlbyBEZW5nIDxsZW9kZW5nQGxlb2RlbmcuZGV2PoiZBBMWCgBBFiEE
4JRSjTCaL/GUTM0W8SX/iMtynMwFAmqO9N0CGwEFCQlmAYAFCwkIBwICIgIGFQoJ
CAsCBBYCAwECHgcCF4AACgkQ8SX/iMtynMzjsAEAtC1Zq7d0CwMqQ+sr136DjsYx
iw+dYNITA8Q0lo4jYMgBAIP5qOSw441pRZml2yDx50F1Gl5diWcDyS/W8U0o9yoA
uDMEao71VBYJKwYBBAHaRw8BAQdA/Mn4EXXS3+XNHLUC6Ud4EvrpMTuEwT3J3EJ1
GTXeocCI9QQYFgoAJhYhBOCUUo0wmi/xlEzNFvEl/4jLcpzMBQJqjvVUAhsCBQkJ
ZgGAAIEJEPEl/4jLcpzMdiAEGRYKAB0WIQQifeuMA16wxlkgYEzuqJyBfOISPAUC
ao71VAAKCRDuqJyBfOISPCsGAQCX+YV3eRH+UHSfFOY51Y2xeXYTtP8QSlr+fy/T
tZVD8wEAk4g3en45HJ74qPI3/UF+QQTx9cbKiKtX31+nwWbpEQW/VwEArM1QCU9r
N10iANFWYz9OgBGRKjzAOuI7s9/7bvMuprYBAO7PbpL7ZZv2PtpvIs9vsQBgE8H6
oUMKbPvx0dfIUt0IuDgEao71XhIKKwYBBAGXVQEFAQEHQMzVqRUtANHQDl54AuMO
CPHpVMXHn6JYF82mnz3sZKYiAwEIB4h+BBgWCgAmFiEE4JRSjTCaL/GUTM0W8SX/
iMtynMwFAmqO9V4CGwwFCQlmAYAACgkQ8SX/iMtynMz5bwD/WqKV0wLUtIkKTJYF
a785DBXEevXOo83je292iVtKPAcBAKn1NqCWW3Tum9JOBp2W5Qssfa+at7uAHM0i
stVvwtEI
=IUSk
-----END PGP PUBLIC KEY BLOCK-----
`

const copied = ref(null)
let resetTimer

async function writeToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const succeeded = document.execCommand('copy')
  textarea.remove()

  if (!succeeded) throw new Error('Clipboard copy failed')
}

async function copy(text, target) {
  clearTimeout(resetTimer)

  try {
    await writeToClipboard(text)
    copied.value = target
    resetTimer = setTimeout(() => { copied.value = null }, 1800)
  } catch {
    copied.value = 'error'
    resetTimer = setTimeout(() => { copied.value = null }, 2500)
  }
}

onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <div class="flex items-center gap-3 mb-3">
      <div class="shrink-0 p-2 rounded-md bg-fg/5 text-accent" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 8-8m-3 3 3 3m-6 0 3 3" />
        </svg>
      </div>
      <h1 class="text-xs font-mono text-muted uppercase tracking-widest">OpenPGP</h1>
    </div>

    <p class="text-[15px] text-muted leading-relaxed mb-10 max-w-2xl">
      This is my public OpenPGP key for verifying signed email and encrypting mail to me.
    </p>

    <div class="rounded-lg border border-fg/8 divide-y divide-fg/5 mb-8">
      <div class="p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div class="text-xs font-mono text-muted/90 uppercase tracking-widest mb-2 sm:mb-0">Identity</div>
        <div class="text-sm text-fg sm:text-right">
          Leo Deng ·
          <a class="text-accent hover:underline" href="mailto:leodeng@leodeng.dev">leodeng@leodeng.dev</a>
        </div>
      </div>

      <div class="p-5">
        <div class="flex items-center justify-between gap-4 mb-3">
          <div class="text-xs font-mono text-muted/90 uppercase tracking-widest">Fingerprint</div>
          <button
            type="button"
            class="shrink-0 text-xs font-mono px-3 py-1.5 rounded-full border border-fg/10 text-muted hover:text-accent hover:border-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors cursor-pointer"
            aria-label="Copy OpenPGP fingerprint"
            @click="copy(fingerprint, 'fingerprint')"
          >{{ copied === 'fingerprint' ? 'copied ✓' : 'copy' }}</button>
        </div>
        <div>
          <code class="block font-mono text-sm sm:text-base leading-loose text-fg break-words">{{ fingerprint }}</code>
        </div>
      </div>
    </div>

    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xs font-mono text-muted/90 uppercase tracking-widest">Public key</h2>
      <button
        type="button"
        class="text-xs font-mono px-3 py-2 rounded-lg border border-fg/10 text-muted hover:text-accent hover:border-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors cursor-pointer"
        aria-label="Copy complete ASCII-armored OpenPGP public key"
        @click="copy(publicKey, 'key')"
      >{{ copied === 'key' ? 'copied ✓' : 'Copy public key' }}</button>
    </div>

    <pre class="max-h-[360px] overflow-auto whitespace-pre rounded-lg border border-fg/8 bg-fg/5 p-4 text-[11px] sm:text-xs leading-relaxed text-muted font-mono mb-5" tabindex="0" aria-label="ASCII-armored OpenPGP public key"><code>{{ publicKey }}</code></pre>

    <p class="sr-only" role="status" aria-live="polite">
      {{ copied === 'fingerprint' ? 'Fingerprint copied.' : copied === 'key' ? 'Public key copied.' : copied === 'error' ? 'Copy failed. Please select and copy the text manually.' : '' }}
    </p>

    <div class="flex flex-wrap gap-x-6 gap-y-3 text-sm font-mono">
      <a
        href="/pgp-public.asc"
        download
        class="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent rounded-sm"
      >Download public key (.asc)</a>
      <a
        href="https://keys.openpgp.org/search?q=E094528D309A2FF1944CCD16F125FF88CB729CCC"
        target="_blank"
        rel="noopener noreferrer"
        class="text-muted hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent rounded-sm transition-colors"
      >View on keys.openpgp.org ↗</a>
    </div>
  </section>
</template>
