<script setup>
import { computed } from 'vue'

const ICONS = {
  desktop: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm5 15h6M12 16v4',
  laptop: 'M5 4a2 2 0 0 0-2 2v9h18V6a2 2 0 0 0-2-2ZM2 17h20l-1.5 3a1 1 0 0 1-.9.6H4.4a1 1 0 0 1-.9-.6Z',
  phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 15h2',
  watch: 'M9 6.5h6l.8 3a5.5 5.5 0 0 1 0 5l-.8 3H9l-.8-3a5.5 5.5 0 0 1 0-5ZM9 6.5 8.4 3h7.2l-.6 3.5M9 17.5l-.6 3.5h7.2l-.6-3.5',
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  layers: 'M12 2 2 7l10 5 10-5-10-5Zm-10 10 10 5 10-5M2 12l10 5 10-5',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  cpu: 'M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 9h6v6H9Z',
  database: 'M3 5c0-1.66 4-3 9-3s9 1.34 9 3-4 3-9 3-9-1.34-9-3ZM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  globe: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2Z',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10Z',
}

const devices = [
  {
    category: 'Microphone',
    model: 'Audio-Technica AT2035',
    icon: 'mic',
    specs: [
      { label: 'Type', value: 'Condenser' },
    ],
  },
  {
    category: 'Camera',
    model: 'Canon EOS R6 Mark II',
    icon: 'camera',
    specs: [
      { label: 'Sensor', value: '24.2MP Full-Frame CMOS' },
      { label: 'Processor', value: 'DIGIC X' },
      { label: 'Autofocus', value: 'Dual Pixel CMOS AF II' },
      { label: 'Stabilization', value: 'Up to 8-stop IBIS' },
      { label: 'Lens', value: 'RF 70-200mm f/2.8' },
      { label: 'Lens', value: 'EF 24-105mm f/4' },
      { label: 'Adapter', value: 'RF-EF Connector Ring' },
    ],
  },
  {
    category: 'Watch',
    model: 'Apple Watch Series 11',
    icon: 'watch',
    specs: [],
  },
  {
    category: 'Desktop',
    model: 'Custom Build',
    icon: 'desktop',
    specs: [
      { label: 'CPU', value: 'Intel Core i7-14700K' },
      { label: 'GPU', value: 'NVIDIA GeForce RTX 4070 SUPER · 12GB VRAM' },
      { label: 'RAM', value: '32GB Kingston HyperX DDR5 (2x16GB)' },
      { label: 'Storage', value: '1TB Kingston KC3000 M.2 + 2TB WD M.2' },
      { label: 'Cooling', value: 'Thermalright 360mm AIO' },
    ],
  },
  {
    category: 'Phone',
    model: 'Google Pixel 9 Pro XL',
    icon: 'phone',
    specs: [
      { label: 'Chip', value: 'Google Tensor G4' },
      { label: 'RAM', value: '16GB' },
      { label: 'Storage', value: '256GB' },
      { label: 'Display', value: '6.8" Super Actua LTPO OLED · 120Hz' },
      { label: 'Resolution', value: '2992 x 1344 · 486 PPI' },
      { label: 'Rear Camera', value: '50MP main + 48MP UW + 48MP 5x tele' },
      { label: 'Front Camera', value: '42MP' },
    ],
  },
  {
    category: 'Laptop',
    model: 'MacBook Pro (Mid-2015)',
    icon: 'laptop',
    specs: [
      { label: 'CPU', value: 'Intel Core i7-4870HQ' },
      { label: 'GPU', value: 'AMD Radeon R9 M370X · 2GB VRAM' },
      { label: 'RAM', value: '16GB' },
    ],
  },
]

// Sorted by spec count so items paired in the 2-col grid are close in
// length — avoids lopsided rows like a 7-spec card next to a 1-spec card.
const sortedDevices = computed(() => [...devices].sort((a, b) => a.specs.length - b.specs.length))

const software = [
  {
    name: 'Operating Systems',
    icon: 'layers',
    rows: [
      { label: 'Desktop', value: 'Windows 11' },
      { label: 'Server', value: 'Ubuntu 24.04 LTS' },
      { label: 'Mac', value: 'macOS Sequoia (15) via OCLP' },
      { label: 'Phone', value: 'Android 16 (CP1A.260305.018)' },
    ],
  },
  {
    name: 'Coding',
    icon: 'code',
    rows: [
      { label: 'IDE', value: 'Visual Studio Code' },
      { label: 'Terminal Editor', value: 'Nano' },
    ],
  },
  {
    name: 'Backend',
    icon: 'cpu',
    tags: ['Node.js', 'Python (FastAPI)'],
  },
  {
    name: 'Databases',
    icon: 'database',
    tags: ['PostgreSQL', 'MySQL'],
  },
  {
    name: 'Browsers',
    icon: 'globe',
    tags: ['Chrome', 'Firefox'],
  },
  {
    name: 'Services',
    icon: 'cloud',
    rows: [
      { label: 'Cloudflare', value: 'Static hosting for leodeng.dev' },
    ],
  },
]
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-16">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Stack</h2>
      <p class="text-[15px] text-muted leading-relaxed mb-10">
        What I'm actually typing, shooting, and shipping code on.
      </p>

      <h3 class="text-[11px] font-mono text-muted/50 uppercase tracking-widest mb-4">Hardware</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div
          v-for="d in sortedDevices"
          :key="d.model"
          class="rounded-lg border border-fg/8 p-5 hover:border-accent/30 transition-colors"
        >
          <div class="flex items-center gap-3 mb-4">
            <div class="shrink-0 p-2 rounded-md bg-fg/5 text-accent">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[d.icon]" />
              </svg>
            </div>
            <div>
              <div class="text-[11px] font-mono text-muted/60 uppercase tracking-widest">{{ d.category }}</div>
              <div class="text-fg font-semibold leading-tight">{{ d.model }}</div>
            </div>
          </div>

          <dl v-if="d.specs.length" class="text-sm">
            <div
              v-for="s in d.specs"
              :key="`${s.label}-${s.value}`"
              class="flex items-baseline justify-between gap-4 py-1.5 border-t border-fg/5 first:border-t-0 first:pt-0"
            >
              <dt class="text-muted/50 font-mono text-[11px] uppercase tracking-wide shrink-0">{{ s.label }}</dt>
              <dd class="text-muted text-right font-mono text-xs">{{ s.value }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section>
      <h3 class="text-[11px] font-mono text-muted/50 uppercase tracking-widest mb-4">Software</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div
          v-for="s in software"
          :key="s.name"
          class="rounded-lg border border-fg/8 p-5 hover:border-accent/30 transition-colors"
        >
          <div class="flex items-center gap-3 mb-4">
            <div class="shrink-0 p-2 rounded-md bg-fg/5 text-accent">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[s.icon]" />
              </svg>
            </div>
            <div class="text-fg font-semibold leading-tight">{{ s.name }}</div>
          </div>

          <dl v-if="s.rows" class="text-sm">
            <div
              v-for="r in s.rows"
              :key="r.label"
              class="flex items-baseline justify-between gap-4 py-1.5 border-t border-fg/5 first:border-t-0 first:pt-0"
            >
              <dt class="text-muted/50 font-mono text-[11px] uppercase tracking-wide shrink-0">{{ r.label }}</dt>
              <dd class="text-muted text-right font-mono text-xs">{{ r.value }}</dd>
            </div>
          </dl>

          <div v-else class="flex flex-wrap gap-2">
            <span
              v-for="t in s.tags"
              :key="t"
              class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted/80"
            >{{ t }}</span>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>
