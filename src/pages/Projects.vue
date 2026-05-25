<script setup>
import { ref, onMounted } from 'vue'

const hoveredProject = ref(null)
const swUsers = ref('1.5k+')
const swPhotos = ref('14k+')

function formatK(n) {
  return n >= 1000 ? (Math.floor(n / 100) / 10) + 'k+' : n + '+'
}

async function fetchSwStats() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://api.shutterwingphotos.com/api/stats', { signal: controller.signal })
    clearTimeout(timeout)
    const data = await res.json()
    if (data.registeredUsers) swUsers.value = formatK(data.registeredUsers)
    if (data.photoCount) swPhotos.value = formatK(data.photoCount)
  } catch {
    // fallback values already set
  }
}

onMounted(() => {
  fetchSwStats()
})
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-10">Projects</h2>

    <div class="space-y-10">
      <a
        href="https://shutterwingphotos.com"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
        @mouseenter="hoveredProject = 'ShutterWingPhotos'"
        @mouseleave="hoveredProject = null"
      >
        <img src="/projects_screenshots/shutterwingphotos_screenshot.png" alt="ShutterWingPhotos screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">ShutterWingPhotos</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ website</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Aviation and railway photography platform built with React, Vite, and Node.js.
          A fairly active community — {{ swUsers }} users and {{ swPhotos }} photos.
          Self-hosted on a home server. Worth a visit if you like planes, trains, or good photos.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['react', 'javascript', 'self-hosting', 'aviation', 'railway', 'photography']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <a
        href="https://github.com/leodenglovescode/llmgps"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
        @mouseenter="hoveredProject = 'llmgps'"
        @mouseleave="hoveredProject = null"
      >
        <img src="/projects_screenshots/llmgps_screenshot.png" alt="llmgps screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">llmgps</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Multi-LLM chat workspace. Debate mode makes models argue and synthesize answers.
          Self-hosted, Docker, Ollama, streaming, auth and more.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['next.js', 'typescript', 'ollama', 'docker']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <a
        href="https://github.com/leodenglovescode/leodeng.dev"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
      >
        <img src="/projects_screenshots/leodeng_dev_website.png" alt="leodeng.dev screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">This website</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          You're looking at it right now.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['vue', 'vite', 'tailwind']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <a
        href="https://github.com/leodenglovescode/CarbonPanel"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
      >
        <img src="/projects_screenshots/carbonpanel_screenshot.png" alt="CarbonPanel screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">CarbonPanel</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Lightweight self-hosted server monitoring panel. Real-time metrics and 2FA security.
          Built because I needed something simple to keep an eye on my home server.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['python', 'self-hosting', 'monitoring', 'docker']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <a
        href="https://github.com/leodenglovescode/pm2-webmanager"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
      >
        <img src="/projects_screenshots/pm2webmanager_screenshot.png" alt="pm2-webmanager screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">pm2-webmanager</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Web UI for managing PM2 processes. Start, stop, restart, and monitor Node.js apps from a browser instead of a terminal.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['node.js', 'pm2', 'self-hosting']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <a
        href="https://github.com/leodenglovescode/esp32s3-microphone-satellite"
        target="_blank"
        rel="noopener noreferrer"
        class="group block"
      >
        <img src="/projects_screenshots/esp32s3_voice_screenshot.png" alt="ESP32-S3 Assist Satellite screenshot" class="w-full rounded-lg mb-4 border border-white/8 group-hover:border-accent/20 transition-colors" />
        <div class="flex items-baseline justify-between gap-4 mb-1">
          <h3 class="text-white font-semibold group-hover:text-accent transition-colors">ESP32-S3 Assist Satellite</h3>
          <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Voice assistant satellite for HomeAssistant built on an ESP32-S3 with a microphone.
          Part of my home automation setup.
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="t in ['esp32', 'homeassistant', 'iot', 'c++']" :key="t"
            class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
          >{{ t }}</span>
        </div>
      </a>

      <p class="text-sm text-muted/50 italic pt-2">
        Actively building new stuff — check back later or browse my GitHub.
      </p>
    </div>
  </section>
</template>
