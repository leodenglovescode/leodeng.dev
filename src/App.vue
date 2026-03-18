<script setup>
import { ref, onMounted } from 'vue'

const time = ref('')
const age = ref(16)
const currentStatus = ref('')
const hoveredProject = ref(null)
const swUsers = ref('1.5k+')
const swPhotos = ref('14k+')

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

  const birthday = new Date(2010, 1, 23);  // ← month 1 = February
  const now = new Date();
  age.value = Math.floor((now - birthday) / 31557600000);

  fetchSwStats()
})

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

const links = [
  { label: 'GitHub', url: 'https://github.com/leodenglovescode' },
  { label: 'X', url: 'https://x.com/@Leodeng14' },
  { label: 'Email', url: 'mailto:leodeng@leodeng.dev' },
  { label: 'YouTube', url: 'https://www.youtube.com/@leodaviation' },
  { label: 'ShutterWingPhotos', url: 'https://shutterwingphotos.com' },
]
</script>

<template>
  <div class="max-w-xl mx-auto px-6 py-20 sm:py-32">

    <!-- intro -->
    <header class="mb-20">
      <p class="text-muted text-sm font-mono mb-6">{{ time }} CST</p>

      <h1 class="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
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
    </header>

    <!-- what i care about, but make it casual -->
    <section class="mb-20">
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">About my code...</h2>

      <div class="space-y-4 text-[15px] leading-relaxed">
        <p>
          I always learn by building things, and definitely with a lot of help from AIs.
          Copilot, Claude, ChatGPT, whatever AI I can get my hands on,
          they all help me figure out how to turn my ideas into reality.
          <br/><br/>
          Which is really cool.
        </p>
      </div>
    </section>

    <!-- projects — just the real ones -->
    <section class="mb-20">
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">Projects & random stuff I've built:</h2>

      <div class="space-y-1">
        <a
          href="https://shutterwingphotos.com"
          target="_blank"
          rel="noopener noreferrer"
          class="group block py-4 border-b border-white/5 hover:border-accent/20 transition-colors"
          @mouseenter="hoveredProject = 'ShutterWingPhotos'"
          @mouseleave="hoveredProject = null"
        >
          <div class="flex items-baseline justify-between gap-4 mb-1">
            <h3 class="text-white font-semibold group-hover:text-accent transition-colors">
              ShutterWingPhotos
            </h3>
            <span class="text-xs font-mono text-muted/40 shrink-0">↗ website</span>
          </div>
          <p class="text-sm text-muted leading-relaxed">
            Aviation/Railway Photography website built with React+Vite+Node.js,<br/>
            with a fairly big community: {{ swUsers }} users, {{ swPhotos }} photos.<br/>
            Self-hosted on a home server,<br/>
            Go visit if you like planes, trains or just want to see some photos.<br/>
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
          class="group block py-4 border-b border-white/5 hover:border-accent/20 transition-colors"
          @mouseenter="hoveredProject = 'llmgps'"
          @mouseleave="hoveredProject = null"
        >
          <div class="flex items-baseline justify-between gap-4 mb-1">
            <h3 class="text-white font-semibold group-hover:text-accent transition-colors">
              llmgps
            </h3>
            <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
          </div>
          <p class="text-sm text-muted leading-relaxed">
            Multi-LLM chat workspace. debate mode makes models argue and synthesize answers.
            self-hosted, docker, ollama, streaming, auth and more.
            Go check it out if you are interested!
          </p>
          <div class="flex flex-wrap gap-2 mt-3">
            <span v-for="t in ['next.js', 'typescript', 'ollama', 'docker']" :key="t"
              class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
            >{{ t }}</span>
          </div>
        </a>

        <!-- this site -->
        <a
          href="https://github.com/leodenglovescode/leodeng.dev"
          target="_blank"
          rel="noopener noreferrer"
          class="group block py-4 border-b border-white/5 hover:border-accent/20 transition-colors"
        >
          <div class="flex items-baseline justify-between gap-4 mb-1">
            <h3 class="text-white font-semibold group-hover:text-accent transition-colors">
              this website
            </h3>
            <span class="text-xs font-mono text-muted/40 shrink-0">↗ github</span>
          </div>
          <p class="text-sm text-muted leading-relaxed">
            you're looking at it right now (haha)
          </p>
          <div class="flex flex-wrap gap-2 mt-3">
            <span v-for="t in ['vue', 'vite', 'tailwind']" :key="t"
              class="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted/70"
            >{{ t }}</span>
          </div>
        </a>

        <!-- more -->
        <div class="py-4">
          <p class="text-sm text-muted/50 italic">
            Actively building & maintaining new stuff, check back later or check out my github! :)
          </p>
        </div>
      </div>
    </section>

    <!-- skills but not cringe -->
    <section class="mb-20">
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">things i actually use</h2>

      <p class="text-sm text-muted leading-relaxed mb-4">
        Not a skill tree, just a list of tools and tech I use pretty much regularly.
      </p>

      <div class="flex flex-wrap gap-2">
        <span v-for="s in [
          'html', 'css', 'js', 'react', 'vue', 'vite',
          'node.js', 'python', 'docker', 'ollama', 'git',
          'linux', 'prompt engineering', 'self-hosting', 
          'typescript', 'tailwind', 'next.js'
        ]" :key="s"
          class="text-xs font-mono px-3 py-1.5 rounded-full border border-white/8 text-muted/80 hover:text-white hover:border-accent/30 transition-all cursor-default"
        >{{ s }}</span>
      </div>
    </section>

    <!-- the timeline -->
    <section class="mb-20">
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">My journey here:</h2>

      <div class="space-y-6 text-sm">
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2017</span>
          <p class="text-muted">Started coding. school projects (scratch)</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2018/19</span>
          <p class="text-muted">Started learning a bit of everything (HTML, CSS, JS) and built my first personal site</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2023</span>
          <p class="text-muted">AI boom, started using AI tools to build websites/apps</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2025</span>
          <p class="text-muted">Using AI to assist building my current main project, ShutterWingPhotos (React, Vite, Node.js)</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2026 (now)</span>
          <p class="text-muted">Continously updating ShutterWingPhotos and building new projects that makes AIs Debate (llmgps)</p>
        </div>
      </div>
    </section>


    <section class="mb-16">
      <h2 class="text-xs font-mono text-muted uppercase tracking-widest mb-6">Find me</h2>

      <div class="flex gap-6">
        <a
          v-for="link in links"
          :key="link.label"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-muted hover:text-white transition-colors underline decoration-white/10 hover:decoration-accent/50"
        >{{ link.label }}</a>
      </div>
    </section>


    <footer class="pt-8 border-t border-white/5">
      <p class="text-xs text-muted/30 font-mono">
        2026 © Leo Deng — Built with Vue, Vite, Tailwind.
      </p>
    </footer>

  </div>
</template>
