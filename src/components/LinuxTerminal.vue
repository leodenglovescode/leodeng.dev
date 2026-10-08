<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLocale } from '../utils/i18n.js'
import wasmUrl from 'v86/build/v86.wasm?url'
import { assetsCached, loadAsset, readAsset } from '../utils/terminal/assets.js'
import { prepareGuest } from '../utils/terminal/guest.js'
import { recordings, recordingDownloads } from '../utils/terminal/recordings.js'
import linuxData from '../content/linux.json'
const assetUrls = [wasmUrl, '/linux/seabios.bin', '/linux/vgabios.bin', '/linux/buildroot-bzimage.bin', linuxData.fastfetch.url, ...Object.values(recordingDownloads)]

const props = defineProps({ files: { type: Object, required: true }, fullscreen: Boolean })
const { t } = useLocale('terminal')
const host = ref(null)
const state = ref('idle')
const message = ref('')
const paused = ref(false)
const checking = ref(true)
const cached = ref(false)
const cacheWarning = ref(false)
const welcomeUrls = ref({})
function saveWelcomePlayers(buffers) {
  for (const [language, bytes] of Object.entries(buffers)) {
    if (!bytes) continue
    if (welcomeUrls.value[language]) URL.revokeObjectURL(welcomeUrls.value[language])
    welcomeUrls.value[language] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
  }
}
let commandAudio, commandAudioUrl
let vm, terminal, fit, observer, timeout, alive = true, epoch = 0
let downloads
const readyMachines = new WeakSet()
let audioEpoch = 0
function stopAudio() {
  audioEpoch++
  if (commandAudio) {
    commandAudio.onended = commandAudio.onerror = null
    commandAudio.pause()
    commandAudio.removeAttribute('src')
    commandAudio.load()
    commandAudio = null
  }
  if (commandAudioUrl) URL.revokeObjectURL(commandAudioUrl)
  commandAudioUrl = null
}
async function handleAudio(data, machine, current) {
  if (!data.startsWith('leo-audio;')) return false
  if (!alive || current !== epoch) return true
  if (data === 'leo-audio;stop') { stopAudio(); return true }
  if (!data.startsWith('leo-audio;play;')) return true
  stopAudio()
  const request = audioEpoch
  let reported = false
  const reportError = key => {
    if (!reported && alive && current === epoch && request === audioEpoch) {
      reported = true
      terminal?.writeln(`\r\nplay: ${t(key)}`)
    }
  }
  try {
    const name = atob(data.slice('leo-audio;play;'.length)).trim().slice(0, 200)
    const bytes = await machine.read_file('.leo-audio')
    if (!alive || current !== epoch || request !== audioEpoch) return true
    if (!bytes?.byteLength || bytes.byteLength > 10485760) throw new Error('Invalid audio')
    const extension = name.split('.').at(-1).toLowerCase()
    const mime = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' }[extension]
    if (!mime) throw new Error('Unsupported audio')
    commandAudioUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
    // Detached audio provides playback without adding any terminal UI.
    const audio = new Audio(commandAudioUrl)
    commandAudio = audio
    audio.onended = () => { if (request === audioEpoch) stopAudio() }
    audio.onerror = () => reportError('audioFailed')
    try { await audio.play() } catch (error) {
      reportError(error.name === 'NotAllowedError' ? 'audioBlocked' : 'audioFailed')
    }
  } catch { reportError('audioFailed') }
  return true
}

async function dispose() {
  stopAudio()
  clearTimeout(timeout)
  downloads?.abort()
  downloads = null
  observer?.disconnect()
  observer = null
  const old = vm
  vm = null
  terminal?.dispose()
  terminal = null
  if (old) {
    if (readyMachines.has(old)) await old.destroy()
    else old.add_listener('emulator-ready', () => { void old.destroy() })
  }
}
async function boot(allowDownload = false) {
  const current = ++epoch
  await dispose()
  if (!alive || current !== epoch) return
  state.value = 'loading'
  message.value = t('linuxLoading')
  paused.value = false
  await nextTick()
  downloads = new AbortController()
  const signal = downloads.signal
  const load = url => loadAsset(url, { allowDownload, signal })
  timeout = setTimeout(() => { void fail(current) }, 90000)
  try {
    const [{ V86 }, { Terminal }, { FitAddon }, , wasm, bios, vgaBios, kernel, fastfetch, englishAudio, chineseAudio] = await Promise.all([
      import('v86'), import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css'),
      load(wasmUrl), load('/linux/seabios.bin'), load('/linux/vgabios.bin'), load('/linux/buildroot-bzimage.bin'),
      load(linuxData.fastfetch.url), load(recordingDownloads.en), load(recordingDownloads.zh),
    ])
    if (!alive || current !== epoch) return
    saveWelcomePlayers({ en: englishAudio, zh: chineseAudio })
    cached.value = await assetsCached(assetUrls)
    cacheWarning.value = !cached.value
    if (!alive || current !== epoch) return
    terminal = new Terminal({ cursorBlink: true, cursorStyle: 'block', fontFamily: '"JetBrains Mono", monospace', fontSize: 14, scrollback: 2000, allowProposedApi: false, theme: { background: '#0c0e11', foreground: '#d1d5cb', cursor: '#bdd398', selectionBackground: '#374337', red: '#e0867f', green: '#bdd398', blue: '#9bc2d6' } })
    fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.value)
    fit.fit()
    const machine = new V86({
      wasm_fn: async imports => (await WebAssembly.instantiate(wasm, imports)).instance.exports,
      memory_size: 64 * 1024 * 1024,
      vga_memory_size: 1024 * 1024,
      bios: { buffer: bios },
      vga_bios: { buffer: vgaBios },
      bzimage: { buffer: kernel },
      filesystem: {},
      // No network backend or relay: guest traffic never reaches the network.
      net_device: { type: 'ne2k' },
      cmdline: 'console=ttyS0 tsc=reliable random.trust_cpu=on',
      disable_keyboard: true, disable_mouse: true, disable_speaker: true,
      autostart: false,
    })
    vm = machine
    terminal.parser.registerOscHandler(777, data => handleAudio(data, machine, current))
    terminal.onData(data => { if (!paused.value) machine.serial0_send(data) })
    let tail = '', prepared = false
    machine.add_listener('serial0-output-byte', byte => {
      if (!alive || current !== epoch) return
      terminal?.write(Uint8Array.of(byte))
      tail = (tail + String.fromCharCode(byte)).slice(-80)
      if (!prepared && tail.endsWith('~% ')) {
        prepared = true
        clearTimeout(timeout)
        state.value = 'running'
        message.value = t('linuxRunning')
        // Site files are copied from the emulated 9p disk into the guest's RAM.
        machine.serial0_send(`stty cols ${terminal.cols} rows ${terminal.rows}; . /mnt/init-site.sh\n`)
        terminal.focus()
      }
    })
    machine.add_listener('emulator-ready', async () => {
      readyMachines.add(machine)
      if (!alive || current !== epoch) return
      try {
        await prepareGuest(machine, props.files, { welcome: t('linuxWelcome'), missingAudio: t('audioMissing'), fastfetch, voiceRecordings: { en: englishAudio, zh: chineseAudio } })
        if (!alive || current !== epoch) return
        message.value = t('linuxBooting')
        machine.run()
      } catch { await fail(current) }
    })
    observer = new ResizeObserver(() => {
      fit?.fit()
      // Resizing the renderer does not inject commands into an active shell/editor.
    })
    observer.observe(host.value)
  } catch { await fail(current) }
}
async function fail(current) {
  if (!alive || current !== epoch) return
  epoch++
  await dispose()
  state.value = 'error'
  cached.value = await assetsCached(assetUrls)
  message.value = t('linuxFailed')
}
function togglePause() {
  if (!vm || state.value !== 'running') return
  paused.value = !paused.value
  if (paused.value) vm.stop()
  else { vm.run(); terminal?.focus() }
}
async function stop() {
  epoch++
  await dispose()
  state.value = 'idle'
  message.value = ''
}
function sendKey(value) { if (vm && !paused.value) { vm.serial0_send(value); terminal?.focus() } }
onMounted(async () => {
  const savedAudio = await Promise.all(Object.values(recordingDownloads).map(readAsset))
  if (!alive) return
  saveWelcomePlayers({ en: savedAudio[0], zh: savedAudio[1] })
  cached.value = await assetsCached(assetUrls)
  if (!alive) return
  checking.value = false
  if (cached.value) void boot(false)
})
onBeforeUnmount(() => {
  alive = false; epoch++; void dispose()
  for (const url of Object.values(welcomeUrls.value)) URL.revokeObjectURL(url)
})
</script>

<template>
  <div class="linux-terminal flex flex-col flex-1 min-h-0" :class="{ 'is-fullscreen': fullscreen, 'is-immersive': fullscreen && state === 'running' }">
    <div class="terminal-welcome shrink-0 px-4 py-4 border-b border-[#34383d]">
      <h2 class="text-sm font-mono mb-2">{{ t('voiceTitle') }}</h2>
      <p class="text-xs text-[#a0a49d] mb-3">{{ t('voiceIntro') }}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        <label v-for="language in ['en', 'zh']" :key="language" class="block text-xs text-[#b9bfb1]">
          {{ language === 'zh' ? '中文' : 'English' }}
          <audio :src="welcomeUrls[language] || recordings[language]" :data-welcome="language" preload="none" controls class="w-full h-9 mt-2" />
        </label>
      </div>
    </div>
    <div v-if="state === 'idle' || state === 'error'" class="p-6 sm:p-8 leading-relaxed">
      <h2 class="font-mono text-lg mb-3">Buildroot Linux</h2>
      <p class="text-sm text-[#b9bfb1] max-w-xl mb-5">{{ t('linuxIntro') }}</p>
      <p class="text-sm text-[#b9bfb1] max-w-xl mb-4">{{ t(cached ? 'linuxCached' : 'linuxConsent') }}</p>
      <button type="button" :disabled="checking" class="linux-button px-3 py-2 font-mono text-sm" @click="boot(!cached)">{{ t(checking ? 'linuxChecking' : cached ? 'linuxBoot' : 'linuxDownload') }}</button>
      <RouterLink v-if="!cached" to="/" class="ml-4 text-sm text-[#a0a49d]">{{ t('linuxDecline') }}</RouterLink>
      <p v-if="state === 'error'" role="alert" class="mt-4 text-sm text-[#f0a29a]">{{ message }}</p>
      <p class="mt-5 text-xs text-[#a0a49d]">{{ t('linuxSize') }}</p>
    </div>
    <div v-show="state === 'loading' || state === 'running'" class="flex flex-col flex-1 min-h-0">
      <div class="terminal-chrome flex items-center justify-between flex-wrap gap-3 px-4 py-2 font-mono text-xs">
        <span role="status" class="text-[#a0a49d]">{{ paused ? t('linuxPaused') : message }}</span>
        <div class="flex gap-3">
          <button v-if="state === 'running'" type="button" @click="togglePause">{{ paused ? t('linuxResume') : t('linuxPause') }}</button>
          <button type="button" @click="stop">{{ t('linuxStop') }}</button>
        </div>
      </div>
      <p v-if="cacheWarning" role="status" class="terminal-chrome px-4 pb-2 text-xs text-[#e0867f]">{{ t('linuxCacheUnavailable') }}</p>
      <div ref="host" class="linux-console flex-1 min-h-0 px-4 pb-4" :aria-label="t('linuxConsole')" />
      <div class="terminal-chrome flex gap-4 px-4 pb-3 font-mono text-xs">
        <button v-for="[label, key] in [['Tab', '\t'], ['Ctrl+C', '\x03'], ['Esc', '\x1b'], ['↑', '\x1b[A'], ['↓', '\x1b[B']]" :key="label" type="button" :disabled="state !== 'running' || paused" @click="sendKey(key)">{{ label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.linux-terminal { min-height: 420px; background: #0c0e11; color: #d1d5cb; }
.linux-console { height: 420px; }
.is-fullscreen .terminal-welcome, .is-immersive .terminal-chrome { display: none; }
.is-immersive .linux-console { padding-top: 12px; }
.linux-button { color: #bdd398; background: #263024; border-radius: 3px; }
button:focus-visible { outline: 2px solid #bdd398; outline-offset: 3px; }
button:disabled { opacity: .4; }
</style>
