<script setup>
import { ref, onMounted } from 'vue'

const time = ref('')
const age = ref(16)
const currentStatus = ref('')

const statuses = [
  'probably debugging something rn',
  'making LLMs argue with each other',
  'self-hosting things i don\'t need',
  'googling how to do basic stuff in docker',
  'yelling at CSS again',
  'writing prompts that are too long',
  'refactoring code i wrote yesterday',
  'convincing javascript to cooperate',
]

function pickStatus() {
  currentStatus.value = statuses[Math.floor(Math.random() * statuses.length)]
}

function updateTime() {
  time.value = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'
  })
}

onMounted(() => {
  pickStatus()
  updateTime()
  setInterval(updateTime, 60000)

  const birthday = new Date(2010, 1, 23)
  const now = new Date()
  age.value = Math.floor((now - birthday) / 31557600000)
})
</script>

<template>
  <header class="pt-20 sm:pt-32 pb-20">
    <p class="text-muted text-sm font-mono mb-6">{{ time }} CST</p>

    <h1 class="text-3xl sm:text-4xl font-bold text-fg leading-tight mb-4">
      Hey, I'm Leo<span class="text-accent">.</span>
    </h1>

    <p class="text-lg text-muted leading-relaxed mb-3">
      {{ age }}-year-old full-stack dev from Beijing who builds things with code + AI. I make stuff, break stuff, learn stuff (hopefully). This is my corner of the internet to share what I'm up to and maybe connect with cool people.
    </p>
    <br/>
    <p class="text-lg text-muted leading-relaxed mb-3">What I'm up to (maybe):</p>
    <p class="text-sm text-muted/60 font-mono cursor-pointer hover:text-accent transition-colors" @click="pickStatus">
      > {{ currentStatus }} <span class="animate-pulse">▊</span>
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
  </header>
</template>
