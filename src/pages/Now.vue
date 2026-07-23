<script setup>
const lastUpdated = 'July 23, 2026'
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-2">Now</h2>
    <p class="text-xs font-mono text-muted/40 mb-10">Last updated {{ lastUpdated }}</p>

    <div class="space-y-4 text-[15px] leading-relaxed text-muted mb-10">
      <p>What I'm currently focused on — a snapshot, not a resume.</p>
    </div>

    <ul class="space-y-4 text-sm">
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Just shipped the planespotting <RouterLink to="/gallery" class="text-fg hover:text-accent transition-colors">gallery</RouterLink> on this site, with build-time photo compression.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Continuously iterating on <a href="https://shutterwingphotos.com" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">ShutterWingPhotos</a>.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Building <a href="https://github.com/leodenglovescode/llmgps" target="_blank" rel="noopener noreferrer" class="text-fg hover:text-accent transition-colors">llmgps</a>, a multi-LLM chat workspace with a debate mode.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Tinkering with ESP32-based IoT for Home Assistant.</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Running a self-hosted Headscale mesh for remote access to my home server (wrote it up on the <RouterLink to="/blog" class="text-fg hover:text-accent transition-colors">blog</RouterLink>).</span>
      </li>
      <li class="flex gap-3">
        <span class="text-accent shrink-0">→</span>
        <span class="text-muted">Planespotting when the weather and schedule line up.</span>
      </li>
    </ul>

    <p class="text-xs text-muted/30 font-mono mt-12">
      Inspired by the <a href="https://nownownow.com" target="_blank" rel="noopener noreferrer" class="hover:text-muted transition-colors">/now page movement</a>.
    </p>
  </section>
</template>
