<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  text: { type: String, required: true },
  // Render each character in its own flap cell. Worth it for short fixed-width
  // columns; a wall of boxes across a long line just reads as noise.
  cells: { type: Boolean, default: false },
  // Rows stagger their start so the board settles left-to-right, top-to-bottom
  // like the real thing rather than all at once.
  delay: { type: Number, default: 0 },
})

// Uppercase alphanumerics plus the punctuation the board actually uses. A real
// Solari unit only carries a few dozen flaps, and the short cycle is what makes
// the scramble read as mechanical rather than as random noise.
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·-/:.'

const TICK = 45        // ms between flaps
const MIN_FLIPS = 6    // even the first character gets a visible spin
const STAGGER = 1.6    // extra flaps per character position

// Server-render (and pre-JS paint) the settled text, so the pre-rendered HTML
// and any reader without JS get the real content rather than a scramble.
const display = ref(props.text)
const settled = ref(true)

let timer = null
let startTimer = null

function stop() {
  clearInterval(timer)
  clearTimeout(startTimer)
  timer = null
  startTimer = null
}

function run() {
  stop()
  const target = [...props.text]
  // Spaces settle immediately: keeping the word gaps intact throughout means
  // the line stays shaped like language while the letters are still spinning.
  const settleAt = target.map((c, i) => (c === ' ' ? 0 : Math.round(MIN_FLIPS + i * STAGGER)))
  const last = Math.max(0, ...settleAt)

  // Without a per-flip seed every row scrambles through the identical letter
  // sequence, and a board spinning in lockstep reads as one animation rather
  // than as a dozen independent units.
  const seed = Math.floor(Math.random() * CHARSET.length)
  const frame = t => target
    .map((c, i) => (t >= settleAt[i] ? c : CHARSET[(seed + t * 3 + i * 7) % CHARSET.length]))
    .join('')

  settled.value = false
  // Scramble before the stagger delay, not after — otherwise the row shows its
  // answer for a beat and then hides it again, which reads backwards.
  display.value = frame(0)

  let tick = 0
  startTimer = setTimeout(() => {
    timer = setInterval(() => {
      tick++
      if (tick > last) {
        display.value = props.text
        settled.value = true
        stop()
        return
      }
      display.value = frame(tick)
    }, TICK)
  }, props.delay)
}

// Text that rewrites itself is exactly what "reduce motion" asks you not to do
// (WCAG 2.3.3). Those visitors get the settled board straight away.
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function flip() {
  if (prefersReducedMotion()) {
    display.value = props.text
    settled.value = true
    return
  }
  run()
}

onMounted(flip)
onBeforeUnmount(stop)

// A changed target re-flips to it, which is what a departure board does.
watch(() => props.text, () => {
  display.value = props.text
  flip()
})

defineExpose({ flip })
</script>

<template>
  <!-- Single root: a fragment would drop the caller's class/style, since Vue
       can't decide which of several roots the fallthrough attrs belong to. -->
  <span class="flap" :class="{ 'is-settled': settled }">
    <span v-if="cells" class="flap-row" aria-hidden="true">
      <span v-for="(ch, i) in [...display]" :key="i" class="flap-cell">{{ ch }}</span>
    </span>
    <span v-else aria-hidden="true">{{ display }}</span>

    <!-- The scrambling text is decorative; screen readers get the target once. -->
    <span class="sr-only">{{ text }}</span>
  </span>
</template>
