<script setup>
import { ref } from 'vue'
import { marked } from 'marked'
import SplitFlap from '../components/SplitFlap.vue'
import nowData from '../content/now.json'

const TONES = {
  ok:   'text-[#15a34a] dark:text-[#4ade80]',
  go:   'text-accent',
  warn: 'text-highlight',
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function sinceLabel(event) {
  if (event.sinceLabel?.trim()) return event.sinceLabel.trim().toUpperCase()
  const match = String(event.startedAt || '').match(/^(\d{4})-(\d{2})/)
  if (!match) return 'NOW'
  return `${MONTHS[Number(match[2]) - 1]} ${match[1].slice(2)}`
}

function longDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return 'recently'
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' })
    .format(new Date(Date.UTC(2000, Number(match[2]) - 1, 1)))
  return `${month} ${Number(match[3])}, ${match[1]}`
}

// A departure board, because of course it is. Content lives in one JSON file
// shared with /admin, while the presentation stays exactly the same here.
const rows = (nowData.events || []).map((event) => ({
  ...event,
  since: sinceLabel(event),
  flight: String(event.flight || '').toUpperCase(),
  dest: String(event.title || '').toUpperCase(),
  remark: String(event.remark || '').toUpperCase(),
  tone: TONES[event.tone] ? event.tone : 'go',
}))

const lastUpdated = longDate(nowData.updatedAt)

function renderDetails(source) {
  return marked.parseInline(String(source || ''))
    .replace(/<a href="(https?:\/\/[^"]+)"/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer"')
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
        :key="row.id"
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
      <li
        v-for="row in rows"
        :key="`details-${row.id}`"
        class="flex gap-3"
      >
        <span class="text-accent shrink-0">→</span>
        <span
          class="text-muted [&_a]:text-fg [&_a]:hover:text-accent [&_a]:transition-colors"
        >
          <span class="font-mono text-xs text-muted/90">{{ row.flight }}</span>
          :
          <span v-html="renderDetails(row.details)" />
        </span>
      </li>
    </ul>

    <p class="text-xs text-muted/90 font-mono mt-12">
      Inspired by the <a href="https://nownownow.com" target="_blank" rel="noopener noreferrer" class="hover:text-muted transition-colors">/now page movement</a>.
    </p>
  </section>
</template>
