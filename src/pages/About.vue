<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import GitHubActivity from '../components/GitHubActivity.vue'
import { calcAge } from '../utils/age'
import { useLocale } from '../utils/i18n.js'

const age = calcAge()
const { isZh, t, localePath } = useLocale('about')

// Site theme is a manual toggle (see Navbar.vue), not tied to OS
// prefers-color-scheme, so the Apple Music embed has to watch the actual
// `.dark` class on <html> rather than assume a fixed or system theme.
// Starts true to match index.html's default class="dark"; `document` isn't
// available during SSR, so the real value is only read once mounted.
const isDark = ref(true)
// Permission lasts only for this mounted page. No iframe, preconnect, or
// remembered opt-in contacts Apple before the visitor chooses to load it.
const musicPlayerEnabled = ref(false)
let themeObserver

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onUnmounted(() => {
  themeObserver?.disconnect()
})
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-20">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">{{ t('aboutMe') }}</h2>
      <div class="space-y-4 text-[15px] leading-relaxed text-muted">
        <p>
          {{ t('iMLeoYearsOldFromBeijing', { p0: age }) }}
        </p>
        <p>
          {{ t('outsideOfCodeILikeTinkeringWith') }}
          <RouterLink :to="localePath('/gallery')" class="text-fg hover:text-accent transition-colors">{{ t('photos') }}</RouterLink>{{ t('areHereIAlsoWatchSomeF1') }}
        </p>
        <p>
          {{ t('iMostlyUseVueAndReactFor') }}
        </p>
        <p>
          <RouterLink :to="localePath('/shelf')" class="text-fg hover:text-accent transition-colors">{{ t('shelfLink') }} ↗</RouterLink>
        </p>
      </div>
    </section>

    <section>
      <GitHubActivity data-legacy-hide="true" />
      <p class="mt-4"><RouterLink :to="localePath('/stats')" class="text-sm text-accent hover:underline">{{ t('moreStats') }} ↗</RouterLink></p>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">{{ t('myFavoriteRockPlaylist') }}</h2>
      <div v-if="!musicPlayerEnabled" data-legacy-hide="true" class="border border-fg/10 rounded-lg p-5 space-y-4">
        <p id="apple-music-notice" class="text-sm text-muted leading-relaxed">{{ t('musicPlayerNotice') }}</p>
        <button type="button" aria-describedby="apple-music-notice" class="px-4 py-2 rounded-md bg-accent-strong text-white text-sm font-medium" @click="musicPlayerEnabled = true">{{ t('loadMusicPlayer') }}</button>
      </div>
      <iframe
        v-else
        :title="t('musicPlayerTitle')"
        allow="autoplay *; encrypted-media *;"
        frameborder="0"
        height="450"
        style="width:100%;max-width:660px;overflow:hidden;background:transparent;"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
        :src="`https://embed.music.apple.com/cn/playlist/rock-essentials/pl.u-XkD0vBBs2bRAkr6?l=${isZh ? 'zh-CN' : 'en'}&theme=${isDark ? 'dark' : 'light'}`"
      ></iframe>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-muted">
        <button v-if="musicPlayerEnabled" type="button" class="underline hover:text-accent" @click="musicPlayerEnabled = false">{{ t('unloadMusicPlayer') }}</button>
        <a href="https://music.apple.com/cn/playlist/rock-essentials/pl.u-XkD0vBBs2bRAkr6" target="_blank" rel="noopener noreferrer" class="underline hover:text-accent">{{ t('openMusicPlaylist') }}</a>
        <a data-legacy-hide="true" href="https://www.apple.com/legal/privacy/data/en/apple-music-web/" target="_blank" rel="noopener noreferrer" class="underline hover:text-accent">{{ t('applePlayerPrivacy') }}</a>
        <RouterLink data-legacy-hide="true" :to="localePath('/privacy')" class="underline hover:text-accent">{{ t('sitePrivacy') }}</RouterLink>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">{{ t('toolsIUse') }}</h2>
      <p class="text-sm text-muted leading-relaxed mb-4">
        {{ t('notASkillTreeJustToolsAnd') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <span v-for="s in [
          'html', 'css', 'js', 'react', 'vue', 'vite',
          'node.js', 'python', 'fastapi', 'docker', 'ollama', 'git',
          'linux', 'prompt engineering', 'self-hosting',
          'typescript', 'tailwind', 'next.js', 'esp32', 'homeassistant'
        ]" :key="s"
          class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted hover:text-fg hover:border-accent/30 transition-all cursor-default"
        >{{ s }}</span>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">{{ t('myJourney') }}</h2>
      <div class="space-y-6 text-sm">
        <div class="flex gap-4">
          <span class="text-muted/90 font-mono shrink-0 w-14 text-right">2017</span>
          <p class="text-muted">{{ t('startedCodingSchoolProjectsInScratch') }}</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/90 font-mono shrink-0 w-14 text-right">2018/19</span>
          <p class="text-muted">{{ t('startedLearningHtmlCssJsAndBuilt') }}</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/90 font-mono shrink-0 w-14 text-right">2023</span>
          <p class="text-muted">{{ t('aiBoomStartedUsingAiToolsTo') }}</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/90 font-mono shrink-0 w-14 text-right">2025</span>
          <p class="text-muted">{{ t('builtShutterwingphotosReactViteNodeJs') }}</p>
        </div>
        <div class="flex gap-4">
          <span class="text-muted/90 font-mono shrink-0 w-14 text-right">{{ t('2026Now') }}</span>
          <p class="text-muted">
            {{ t('buildingLlmgpsGettingIntoIotAndWorking') }}
            <RouterLink :to="localePath('/now')" class="text-fg hover:text-accent transition-colors">{{ t('nowPage') }}</RouterLink>{{ t('period') }}
          </p>
        </div>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">{{ t('languages') }}</h2>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="l in [
            { flag: '🇨🇳', name: t('chinese'), level: t('1stLanguage') },
            { flag: '🇺🇸', name: t('english'), level: t('2ndLanguage') },
          ]"
          :key="l.name"
          class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted hover:text-fg hover:border-accent/30 transition-all cursor-default"
        >{{ l.flag }} {{ l.name }} · {{ l.level }}</span>
      </div>
    </section>

  </div>
</template>
