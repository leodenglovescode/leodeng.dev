<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-20">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">About Me</h2>
      <div class="space-y-4 text-[15px] leading-relaxed text-muted">
        <p>
          I'm Leo, a 16-year-old from Beijing who builds full-stack web apps and dabbles in IoT.
          I got into coding by just making stuff — broke a lot of things along the way,
          learned even more, and at some point it stuck.
        </p>
        <p>
          Outside of code I'm into aviation and railway photography (hence ShutterWingPhotos),
          F1, and biking around the city. I also self-host basically everything I can get my hands on,
          which has led to some fun rabbit holes with home servers, Docker, and HomeAssistant.
        </p>
        <p>
          These days I mostly build with React, Vue, Node.js, and Python,
          and use AI tools pretty heavily to go from idea to working thing faster.
          I also do occasional IoT stuff — lately with ESP32s.
        </p>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">Things I Actually Use</h2>
      <p class="text-sm text-muted leading-relaxed mb-4">
        Not a skill tree, just tools and tech I use pretty much regularly.
      </p>
      <div class="flex flex-wrap gap-2">
        <span v-for="s in [
          'html', 'css', 'js', 'react', 'vue', 'vite',
          'node.js', 'python', 'fastapi', 'docker', 'ollama', 'git',
          'linux', 'prompt engineering', 'self-hosting',
          'typescript', 'tailwind', 'next.js', 'esp32', 'homeassistant'
        ]" :key="s"
          class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted/80 hover:text-fg hover:border-accent/30 transition-all cursor-default"
        >{{ s }}</span>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">My Journey</h2>
      <div class="space-y-6 text-sm">
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2017</span>
          <p class="text-muted">Started coding — school projects in Scratch</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2018/19</span>
          <p class="text-muted">Started learning HTML, CSS, JS and built my first personal site</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2023</span>
          <p class="text-muted">AI boom — started using AI tools to build websites and apps</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2025</span>
          <p class="text-muted">Built ShutterWingPhotos with AI assistance (React, Vite, Node.js)</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2026 (now)</span>
          <p class="text-muted">Continuously updating ShutterWingPhotos, building llmgps, and getting into IoT</p>
        </div>
      </div>
    </section>

  </div>
</template>
