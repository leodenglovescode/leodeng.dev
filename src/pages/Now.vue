<script setup>
import { ref } from 'vue'
import SplitFlap from '../components/SplitFlap.vue'

const lastUpdated = 'August 7, 2026'

// A departure board, because of course it is. Every row is one thing I'm
// actually on right now; the remark is the honest status of it.
const rows = [
  {
    since: 'JUL 26',
    flight: 'LD 001',
    dest: 'PLANESPOTTING GALLERY',
    remark: 'LANDED',
    tone: 'ok',
  },
  {
    since: 'MAY 25',
    flight: 'LD 002',
    dest: 'SHUTTERWINGPHOTOS',
    remark: 'ON TIME',
    tone: 'ok',
  },
  {
    since: 'JUN 26',
    flight: 'LD 003',
    dest: 'LLMGPS',
    remark: 'BOARDING',
    tone: 'go',
  },
  {
    since: 'MAR 26',
    flight: 'LD 004',
    dest: 'ESP32 IOT',
    remark: 'DELAYED',
    tone: 'warn',
  },
  {
    since: 'FEB 26',
    flight: 'LD 005',
    dest: 'HEADSCALE MESH',
    remark: 'CRUISING',
    tone: 'go',
  },
  {
    since: 'ALWAYS',
    flight: 'LD 006',
    dest: 'PLANESPOTTING',
    remark: 'WEATHER',
    tone: 'warn',
  },
]

const TONES = {
  ok:   'text-[#15a34a] dark:text-[#4ade80]',
  go:   'text-accent',
  warn: 'text-highlight',
}

// Bumping the key remounts every flap, which re-runs the settle animation —
// the board reboots the way the real ones do when the schedule changes.
const boardKey = ref(0)
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Now</h2>
    <p class="text-xs font-mono text-muted/90 mb-10">Board last updated {{ lastUpdated }}</p>

    <div class="space-y-4 text-[15px] leading-relaxed text-muted mb-10">
      <p>What I'm currently focused on.</p>
    </div>

    <!-- Departure board -->
    <div
      class="border border-fg/10 rounded-lg overflow-hidden bg-surface cursor-pointer select-none"
      title="Click to re-flip the board"
      @click="boardKey++"
    >
      <div
        class="grid grid-cols-[1fr_auto] sm:grid-cols-[5rem_5rem_1fr_auto] gap-x-4 px-4 py-2
               border-b border-fg/10 text-xs font-mono text-muted uppercase tracking-widest"
      >
        <span class="hidden sm:block">Since</span>
        <span class="hidden sm:block">Flight</span>
        <span>Destination</span>
        <span class="text-right">Remarks</span>
      </div>

      <div
        v-for="(row, i) in rows"
        :key="row.flight"
        class="grid grid-cols-[1fr_auto] sm:grid-cols-[5rem_5rem_1fr_auto] gap-x-4 items-center
               px-4 py-3 border-b border-fg/5 last:border-b-0"
      >
        <SplitFlap
          :key="`since-${boardKey}`"
          :text="row.since"
          :delay="i * 90"
          class="hidden sm:block text-xs font-mono text-muted"
        />
        <SplitFlap
          :key="`flight-${boardKey}`"
          :text="row.flight"
          :delay="i * 90 + 40"
          cells
          class="hidden sm:block"
        />
        <SplitFlap
          :key="`dest-${boardKey}`"
          :text="row.dest"
          :delay="i * 90 + 80"
          class="text-xs sm:text-sm font-mono text-fg tracking-wide break-words"
        />
        <SplitFlap
          :key="`remark-${boardKey}`"
          :text="row.remark"
          :delay="i * 90 + 140"
          :class="['text-xs font-mono tracking-widest text-right', TONES[row.tone]]"
        />
      </div>
    </div>

    <!-- The board is the fun part; this is the part that's actually useful. -->
    <ul class="space-y-4 text-sm mt-10">
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 001</span> — Shipped the planespotting <RouterLink to="/gallery" class="text-fg hover:text-accent transition-colors">gallery</RouterLink>, with build-time photo compression and a <RouterLink to="/spotting" class="text-fg hover:text-accent transition-colors">stats page</RouterLink> built from its EXIF.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 002</span> — Continuously iterating on <a href="https://shutterwingphotos.com" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">ShutterWingPhotos</a>.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 003</span> — Building <a href="https://github.com/leodenglovescode/llmgps" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">llmgps</a>, a multi-LLM chat workspace with a debate mode.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 004</span> — Tinkering with ESP32-based IoT for Home Assistant.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 005</span> — Running a self-hosted Headscale mesh for remote access to my home server (wrote it up on the <RouterLink to="/blog" class="text-fg hover:text-accent transition-colors">blog</RouterLink>).</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted"><span class="font-mono text-xs text-muted/90">LD 006</span> — Planespotting whenever the weather and the schedule line up.</span>
      </li>
    </ul>

    <p class="text-xs text-muted/90 font-mono mt-12">
      Inspired by the <a href="https://nownownow.com" target="_blank" rel="noopener noreferrer" class="hover:text-muted transition-colors">/now page movement</a>.
    </p>
  </section>
</template>
