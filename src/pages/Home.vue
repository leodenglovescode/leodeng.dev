<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { calcAge } from '../utils/age'

// Fast enough to feel alive. Most phrases need a beat longer than this to
// actually read, so hovering pauses it.
const STATUS_INTERVAL = 1000

const time = ref('')
const age = calcAge()
const currentStatus = ref('')

const statuses = [
  'probably debugging something right now',
  'making LLMs argue with each other',
  'self-hosting things I don\'t need',
  'googling how to do basic stuff in Docker',
  'trying too hard to center a div in css',
  'writing prompts that are too long',
  'refactoring code I wrote yesterday',
  'convincing JavaScript to cooperate',
  'asking AI obvious questions',
  'trying to remember what I was doing',
  'fixing a bug that isn\'t even there',
  'spotting planes and taking photos of them',
  'watching F1 and complaining about the cars',
]

let statusTimer = null
let clockTimer = null

function pickStatus() {
  // Never land on the line already showing — at a one-second cadence a random
  // repeat just reads as the ticker having frozen.
  let next = currentStatus.value
  while (next === currentStatus.value) {
    next = statuses[Math.floor(Math.random() * statuses.length)]
  }
  currentStatus.value = next
}

function startTicker() {
  clearInterval(statusTimer)
  statusTimer = setInterval(pickStatus, STATUS_INTERVAL)
}

function stopTicker() {
  clearInterval(statusTimer)
  statusTimer = null
}

// Clicking still rerolls, and restarts the clock so the line you asked for
// doesn't get replaced a few milliseconds later.
function rerollStatus() {
  pickStatus()
  if (statusTimer) startTicker()
}

function updateTime() {
  time.value = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'
  })
}

onMounted(() => {
  pickStatus()
  updateTime()
  clockTimer = setInterval(updateTime, 60000)

  // Text that rewrites itself every second is exactly what "reduce motion"
  // asks you not to do (WCAG 2.2.2). Those visitors get one status and the
  // click-to-reroll, which is the whole joke anyway.
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) startTicker()
})

// Both intervals used to outlive the page — this is a route component, so
// navigating away left them running.
onBeforeUnmount(() => {
  clearInterval(statusTimer)
  clearInterval(clockTimer)
})
</script>

<template>
  <header class="pt-20 sm:pt-32 pb-20 flex flex-col-reverse sm:flex-row items-center sm:items-start gap-10 sm:gap-12">
    <div class="flex-1">
      <p class="text-muted text-sm font-mono mb-6">{{ time }} CST</p>

      <h1 class="text-3xl sm:text-4xl font-bold text-fg leading-tight mb-4">
        Hey, I'm Leo<span class="text-highlight">.</span>
      </h1>

      <p class="text-lg text-muted leading-relaxed mb-3">
        {{ age }}-year-old full-stack dev & avgeek from Beijing who builds things with code + AI. I make stuff, break stuff, learn stuff (hopefully). This is my place in the world wide web to share what I'm up to and make friends with people who likes the same stuff I do! :)
      </p>
      <br/>
      <p class="text-lg text-muted leading-relaxed mb-3">What I'm up to (maybe):</p>
      <p
        class="text-sm text-muted/90 font-mono cursor-pointer hover:text-accent transition-colors"
        title="Hover to pause, click to reroll"
        @click="rerollStatus"
        @mouseenter="stopTicker"
        @mouseleave="startTicker"
      >
        > {{ currentStatus }} <span class="text-highlight animate-pulse">▊</span>
      </p>

      <div class="flex gap-8 mt-12">
        <RouterLink to="/projects" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → Projects
        </RouterLink>
        <RouterLink to="/blog" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → Blog
        </RouterLink>
        <RouterLink to="/about" class="text-sm font-mono text-muted hover:text-fg transition-colors">
          → About
        </RouterLink>
      </div>
    </div>

    <img
      src="/leo_profilepic.webp"
      alt="Leo Deng"
      class="w-32 h-32 sm:w-48 sm:h-48 rounded-full object-cover border-2 border-accent shrink-0"
    />
  </header>
</template>
