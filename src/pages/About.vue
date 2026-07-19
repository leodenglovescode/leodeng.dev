<script setup>
const age = Math.floor((new Date() - new Date(2010, 1, 1)) / 31557600000)
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-20">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">About Me</h2>
      <div class="space-y-4 text-[15px] leading-relaxed text-muted">
        <p>
          I'm Leo, {{ age }}, from Beijing. I build full-stack web apps and like building with IoT
          on the side. Got into coding by just making random stuff, broke a lot of it, learned from that,
          and somewhere along the way it became my hobby.
        </p>
        <p>
          Outside of code I planespot and do aviation photography (that's where ShutterWingPhotos came from),
          watch some F1, and bike around the city when the weather lets me. I also self-host
          more services than I probably need to: Home Servers, Docker, Home Assistant, the usual rabbit hole.
        </p>
        <p>
          I mostly build with React, Vue, Node.js, and Python right now, and I lean on AI tools a lot
          to move faster from idea to a working prototype.
        </p>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">My Fav Rock Playlist</h2>
      <iframe
        allow="autoplay *; encrypted-media *;"
        frameborder="0"
        height="450"
        style="width:100%;max-width:660px;overflow:hidden;background:transparent;"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
        src="https://embed.music.apple.com/cn/playlist/rock-essentials/pl.u-XkD0vBBs2bRAkr6?l=en"
      ></iframe>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">Tools I Use</h2>
      <p class="text-sm text-muted leading-relaxed mb-4">
        Not a skill tree, just tools and tech I use regularly.
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
          <p class="text-muted">Built ShutterWingPhotos (React, Vite, Node.js)</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/30 font-mono shrink-0 w-14 text-right">2026 (now)</span>
          <p class="text-muted">Continuously updating ShutterWingPhotos, building llmgps, and getting into IoT</p>
        </div>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">Languages</h2>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="l in [
            { flag: '🇨🇳', name: 'Chinese', level: '1st language' },
            { flag: '🇺🇸', name: 'English', level: '2nd language' },
          ]"
          :key="l.name"
          class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted/80 hover:text-fg hover:border-accent/30 transition-all cursor-default"
        >{{ l.flag }} {{ l.name }} · {{ l.level }}</span>
      </div>
    </section>

  </div>
</template>
