<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import MusicArtwork from './MusicArtwork.vue'
import { useLocale } from '../utils/i18n.js'
import { statsJson } from '../../lib/monkeyStats.js'
const { isZh } = useLocale('stats')
const data = ref(null), state = ref('loading'), range = ref('30')
const words = computed(() => isZh.value ? {
 title:'音乐聆听', intro:'来自我的 Mac 的聆听记录，大约每分钟更新，包含今天的记录。日期按 UTC 统计。', loading:'正在加载聆听统计…', empty:'开始记录后，音乐统计会显示在这里。', error:'聆听统计暂时不可用。', seven:'近 7 天', month:'近 30 天', all:'全部时间', plays:'播放次数', hours:'聆听时长', artists:'常听歌手', albums:'常听专辑', tracks:'常听歌曲', daily:'最近 90 天的聆听时长', unit:'小时', note:'听满 30 秒或歌曲时长的一半计为一次播放，以较短者为准。', stale:'当前显示上次成功更新的数据。', through:'统计截至', no:'此时间段还没有记录。', minutes:'分钟'
} : {
 title:'Music listening', intro:'Listening history from my Mac, updated about every minute, including today. Dates use UTC.', loading:'Loading listening stats...', empty:'My music stats will appear once listening history starts coming in.', error:'Listening stats are temporarily unavailable.', seven:'Last 7 days', month:'Last 30 days', all:'All time', plays:'Counted plays', hours:'Listening time', artists:'Top artists', albums:'Top albums', tracks:'Top songs', daily:'Listening time over the last 90 days', unit:'hours', note:'A play counts after 30 seconds or half the track, whichever comes first.', stale:'Showing the last successful update.', through:'Through', no:'No listening history for this period yet.', minutes:'min'
})
const summary = computed(() => data.value?.ranges?.[range.value])
const maxDay = computed(() => Math.max(1, ...(data.value?.daily || []).map(d => d.listenedMs)))
const rankingMax = kind => Math.max(1, ...(summary.value?.[kind] || []).map(r => r.listenedMs))
let timer, mounted = false, pending = false
async function refresh() {
  if (pending || document.hidden) return
  pending = true
  try { const next = await statsJson('/api/stats/music'); if (mounted) { data.value = next; state.value = next.state } } catch { if (mounted && !data.value) state.value = 'unavailable' }
  finally { pending = false }
}
onMounted(() => { mounted = true; void refresh(); timer = setInterval(refresh, 60000); document.addEventListener('visibilitychange', refresh) })
onBeforeUnmount(() => { mounted = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) })
</script>
<template>
  <section id="music" class="music-section">
    <p class="text-xs font-mono text-muted">03 / {{ words.title }}</p>
    <h2 class="text-lg font-semibold mt-3">{{ words.title }}</h2>
    <p class="text-sm text-muted mt-2">{{ words.intro }}</p>
    <p v-if="state !== 'ready'" class="text-sm text-muted mt-5" role="status">{{ state === 'loading' ? words.loading : state === 'empty' ? words.empty : words.error }}</p>
    <template v-else>
      <div class="flex flex-wrap gap-2 mt-5" role="group" :aria-label="words.title">
        <button v-for="(label,key) in { '7':words.seven, '30':words.month, all:words.all }" :key="key" :aria-pressed="range === key" @click="range = key" class="text-xs border rounded px-3 py-2" :class="range === key ? 'border-accent text-accent' : 'border-fg/15 text-muted'">{{ label }}</button>
      </div>
      <dl class="flex flex-wrap gap-10 mt-6 mb-3">
        <div><dt class="text-xs text-muted">{{ words.plays }}</dt><dd class="text-2xl font-mono mt-2">{{ summary.plays.toLocaleString() }}</dd></div>
        <div><dt class="text-xs text-muted">{{ words.hours }}</dt><dd class="text-2xl font-mono mt-2">{{ (summary.listenedMs / 3600000).toFixed(1) }} <small class="text-xs">{{ words.unit }}</small></dd></div>
      </dl>
      <p class="text-xs text-muted">{{ words.note }}</p>
      <figure class="mt-7">
        <svg viewBox="0 0 600 100" role="img" :aria-label="words.daily" class="w-full text-accent">
          <rect v-for="(day,index) in data.daily" :key="day.day" :x="index * 600 / Math.max(1,data.daily.length)" :y="95 - day.listenedMs/maxDay*85" :width="Math.max(1,600/Math.max(1,data.daily.length)-2)" :height="day.listenedMs/maxDay*85" fill="currentColor"><title>{{ day.day }}: {{ (day.listenedMs/60000).toFixed(0) }} {{ words.minutes }}</title></rect>
        </svg>
        <figcaption class="text-xs text-muted mt-2">{{ words.daily }}</figcaption>
      </figure>
      <div class="music-rankings">
        <section v-for="kind in ['artists','albums','tracks']" :key="kind">
          <h3 class="text-sm font-semibold mb-4">{{ words[kind] }}</h3>
          <p v-if="!summary[kind].length" class="text-xs text-muted">{{ words.no }}</p>
          <ol v-else class="space-y-4">
            <li v-for="(item,index) in summary[kind]" :key="index" class="text-sm">
              <div class="flex gap-3">
                <MusicArtwork v-if="kind !== 'tracks'" :kind="kind" :name="item.name" :artist="item.artist" />
                <div class="min-w-0 flex-1"><div class="flex justify-between gap-3"><span class="min-w-0 break-words">{{ item.name }}<small v-if="item.artist" class="block text-muted">{{ item.artist }}</small></span><span class="text-xs text-muted whitespace-nowrap">{{ (item.listenedMs/60000).toFixed(0) }} {{ words.minutes }}</span></div>
              <div class="music-bar"><span :style="{ width: `${item.listenedMs/rankingMax(kind)*100}%` }"></span></div></div></div>
            </li>
          </ol>
        </section>
      </div>
      <p class="text-xs text-muted mt-6">{{ isZh ? '图片来源：' : 'Artwork: ' }}<a href="https://www.theaudiodb.com" class="underline" target="_blank" rel="noopener noreferrer">TheAudioDB</a> &amp; <a href="https://coverartarchive.org" class="underline" target="_blank" rel="noopener noreferrer">Cover Art Archive</a>. {{ isZh ? '点击图片查看来源。' : 'Select an image to view its source.' }}</p>
      <p class="text-xs text-muted mt-3">{{ words.through }} {{ data.through }} (UTC). <span v-if="data.stale">{{ words.stale }}</span></p>
    </template>
  </section>
</template>
<style scoped>
.music-section { padding:24px; border:1px solid color-mix(in srgb,var(--color-fg) 10%,transparent); border-radius:12px; min-width:0; }
.music-rankings { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:28px; margin-top:28px; }
.music-bar { height:3px; background:color-mix(in srgb,var(--color-fg) 8%,transparent); margin-top:7px; }
.music-bar span { display:block; height:100%; background:var(--color-accent); }
@media(max-width:640px) { .music-rankings { grid-template-columns:1fr; } .music-section { padding:16px; } }
</style>
