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
  'asking ai obvious questions',
  'trying to remember what i was doing',
  'fixing a bug that isn\'t even there',
  'spotting planes and taking photos of them',
  'watching F1 and complaining about the cars',
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

  const birthday = new Date(2010, 1, 1)
  const now = new Date()
  age.value = Math.floor((now - birthday) / 31557600000)
})
</script>

<template>
  <header class="pt-20 sm:pt-32 pb-20 flex flex-col-reverse sm:flex-row items-center sm:items-start gap-10 sm:gap-12">
    <div class="flex-1">
      <p class="text-muted text-sm font-mono mb-6">{{ time }} CST</p>

      <h1 class="text-3xl sm:text-4xl font-bold text-fg leading-tight mb-4">
        Hey, I'm Leo<span class="text-accent">.</span>
      </h1>

      <p class="text-lg text-muted leading-relaxed mb-3">
        {{ age }}-year-old full-stack dev & avgeek from Beijing who builds things with code + AI. I make stuff, break stuff, learn stuff (hopefully). This is my place in the world wide web to share what I'm up to and make friends with people who likes the same stuff I do! :)
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
    </div>

    <img
      src="/leo_profilepic.png"
      alt="Leo Deng"
      class="w-32 h-32 sm:w-48 sm:h-48 rounded-full object-cover border-2 border-accent shrink-0"
    />
  </header>
</template>
