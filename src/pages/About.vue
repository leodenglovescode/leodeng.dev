<script setup>
import { ref, computed, onMounted } from 'vue'

const age = Math.floor((new Date() - new Date(2010, 1, 1)) / 31557600000)

const GITHUB_LOGIN = 'leodenglovescode'

const repoCount = ref(null)
const starCount = ref(null)
const followerCount = ref(null)
const prCount = ref(null)
const topLanguages = ref([])

const totalContributions = ref(null)
const contributionDays = ref([]) // { date, level, gridColumn, gridRow }
const monthLabels = ref([])
const weeksCount = ref(0)
const contributionRangeLabel = ref('contributions in the last year')

const tooltip = ref({ visible: false, x: 0, y: 0, count: 0, dateLabel: '' })

function formatStat(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n)
}

// GitHub's own Octicons (MIT, github.com/primer/octicons), inlined so the
// icons are pixel-identical to GitHub's UI without a CDN or extra dependency.
const ICON_PATHS = {
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
  starFill: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
  gitPullRequest: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  people: 'M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z',
}

const statTiles = computed(() => [
  { icon: 'repo', value: repoCount.value, label: 'repos' },
  { icon: 'starFill', value: starCount.value, label: 'stars' },
  { icon: 'gitPullRequest', value: prCount.value, label: 'merged PRs' },
  { icon: 'people', value: followerCount.value, label: 'followers' },
].filter(t => t.value !== null))

const levelClasses = [
  'bg-fg/8',
  'bg-accent/25',
  'bg-accent/50',
  'bg-accent/75',
  'bg-accent',
]

// Buckets raw event counts into the same 0-4 levels GitHub uses for its own
// contribution graph, since the events-API fallback has no precomputed level.
function levelForCount(count) {
  if (count <= 0) return 0
  if (count <= 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

// Shared grid-position math: takes ascending {date, level, count} entries and
// assigns each a Sunday-anchored (gridColumn, gridRow), plus month labels.
function layoutCalendar(daysWithCount) {
  const firstDate = new Date(daysWithCount[0].date + 'T00:00:00Z')
  const anchor = new Date(firstDate)
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay()) // back up to Sunday

  const labels = []
  let prevMonth = null
  let prevColumn = -1

  const days = daysWithCount.map(d => {
    const date = new Date(d.date + 'T00:00:00Z')
    const diffDays = Math.round((date - anchor) / 86400000)
    const column = Math.floor(diffDays / 7)
    const row = (diffDays % 7) + 1

    const month = date.getUTCMonth()
    if (column !== prevColumn && month !== prevMonth) {
      labels[column] = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
      prevMonth = month
      prevColumn = column
    }

    return { date: d.date, level: d.level, count: d.count, gridColumn: column + 1, gridRow: row }
  })

  return { days, labels, weeksCount: Math.max(...days.map(d => d.gridColumn)) }
}

function showTooltip(event, day) {
  const rect = event.currentTarget.getBoundingClientRect()
  tooltip.value = {
    visible: true,
    x: rect.left + rect.width / 2,
    y: rect.top - 6,
    count: day.count,
    dateLabel: new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }
}

function hideTooltip() {
  tooltip.value.visible = false
}

// Primary source: a public, no-auth wrapper around GitHub's real contribution
// calendar. GitHub's own GraphQL API requires an auth token even for public
// data, which can't safely live in client-side JS — so this is the only way
// to show the full year live without a backend of our own.
async function fetchContributionsPrimary() {
  const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${GITHUB_LOGIN}?y=last`)
  if (!res.ok) throw new Error(`contributions API responded ${res.status}`)
  const data = await res.json()
  const rawDays = data.contributions
  if (!rawDays?.length) throw new Error('empty contributions response')

  const { days, labels, weeksCount: wc } = layoutCalendar(
    rawDays.map(d => ({ date: d.date, level: d.level, count: d.count }))
  )
  contributionDays.value = days
  monthLabels.value = labels
  weeksCount.value = wc
  totalContributions.value = data.total.lastYear ?? 0
  contributionRangeLabel.value = 'contributions in the last year'
}

// Fallback: GitHub's own official REST API, no auth needed — but it only
// exposes recent public events (~90 days / 300 events max), not a full
// contribution calendar, and event counts approximate rather than match
// contribution counts exactly (e.g. one push = one event regardless of
// commit count). Used only if the primary source is unreachable.
async function fetchContributionsFallback() {
  const counts = new Map()
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.github.com/users/${GITHUB_LOGIN}/events/public?per_page=100&page=${page}`)
    if (!res.ok) break
    const events = await res.json()
    if (!Array.isArray(events) || events.length === 0) break
    for (const e of events) {
      const date = e.created_at.slice(0, 10)
      counts.set(date, (counts.get(date) || 0) + 1)
    }
    if (events.length < 100) break
  }
  if (counts.size === 0) throw new Error('no public events available')

  const dates = [...counts.keys()].sort()
  const start = new Date(dates[0] + 'T00:00:00Z')
  const end = new Date(dates[dates.length - 1] + 'T00:00:00Z')
  const daysWithCount = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    const count = counts.get(key) || 0
    daysWithCount.push({ date: key, level: levelForCount(count), count })
  }

  const { days, labels, weeksCount: wc } = layoutCalendar(daysWithCount)
  contributionDays.value = days
  monthLabels.value = labels
  weeksCount.value = wc
  totalContributions.value = [...counts.values()].reduce((a, b) => a + b, 0)
  contributionRangeLabel.value = 'public events in the last ~90 days'
}

async function fetchGithubStats() {
  try {
    const userRes = await fetch(`https://api.github.com/users/${GITHUB_LOGIN}`)
    const user = await userRes.json()
    repoCount.value = user.public_repos ?? 0
    followerCount.value = user.followers ?? 0

    const repos = []
    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      const repoRes = await fetch(`https://api.github.com/users/${GITHUB_LOGIN}/repos?per_page=100&page=${pageNum}&type=owner`)
      const page = await repoRes.json()
      if (!Array.isArray(page) || page.length === 0) break
      repos.push(...page)
      if (page.length < 100) break
    }

    const ownRepos = repos.filter(r => !r.fork)
    starCount.value = ownRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0)

    const langCounts = {}
    for (const r of ownRepos) {
      if (!r.language) continue
      langCounts[r.language] = (langCounts[r.language] || 0) + 1
    }
    topLanguages.value = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang)
  } catch {
    // stats stay null — tiles simply don't render
  }

  try {
    const prRes = await fetch(`https://api.github.com/search/issues?q=is:pr+is:merged+author:${GITHUB_LOGIN}`)
    const prData = await prRes.json()
    prCount.value = prData.total_count ?? 0
  } catch {
    // stays null — tile simply doesn't render
  }
}

onMounted(() => {
  fetchGithubStats()
  fetchContributionsPrimary().catch(() =>
    fetchContributionsFallback().catch(() => {
      // heatmap stays hidden — total/contributionDays stay empty
    })
  )
})
</script>

<template>
  <div class="pt-20 sm:pt-32 pb-20 space-y-20">

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">About Me</h2>
      <div class="space-y-4 text-[15px] leading-relaxed text-muted">
        <p>
          I'm Leo, {{ age }}, from Beijing. I build full-stack web apps and like building with IoT
          on the side, Got into coding by just making random small projects, broke things, learned a lot of valuable lessons,
          and somewhere along the way it became my hobby.
        </p>
        <p>
          Outside of code I like planespotting & aviation photography (that's where ShutterWingPhotos came from),
          watch some F1, and bike around the city when the weather lets me. I also self-host
          a bunch of services: Home Servers, Docker, Home Assistant, the usual rabbit hole.
        </p>
        <p>
          I mostly build with React, Vue, Node.js, and Python right now, and I lean on AI tools a lot
          to move faster from idea to a working prototype.
        </p>
      </div>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">GitHub</h2>

      <div v-if="statTiles.length" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div
          v-for="t in statTiles"
          :key="t.label"
          class="flex items-center gap-3 px-4 py-3 rounded-lg border border-fg/8 hover:border-accent/30 transition-colors"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" class="text-muted/70 shrink-0">
            <path :d="ICON_PATHS[t.icon]" />
          </svg>
          <div>
            <div class="text-fg font-semibold leading-none">{{ formatStat(t.value) }}</div>
            <div class="text-[11px] font-mono text-muted/60 mt-1">{{ t.label }}</div>
          </div>
        </div>
      </div>

      <div v-if="topLanguages.length" class="flex flex-wrap gap-2 mb-6">
        <span v-for="l in topLanguages" :key="l" class="text-xs font-mono px-3 py-1.5 rounded-full border border-fg/8 text-muted/80">
          {{ l }}
        </span>
      </div>

      <div v-if="contributionDays.length" class="overflow-x-auto">
        <p class="text-xs font-mono text-muted/50 mb-2">
          {{ totalContributions }} {{ contributionRangeLabel }}
        </p>
        <div class="inline-grid gap-[3px] mb-1" :style="{ gridTemplateColumns: `repeat(${weeksCount}, 10px)` }">
          <span v-for="(label, i) in monthLabels" :key="i" class="text-[10px] font-mono text-muted/40 leading-none">
            {{ label }}
          </span>
        </div>
        <div
          class="inline-grid gap-[3px]"
          :style="{ gridTemplateColumns: `repeat(${weeksCount}, 10px)`, gridTemplateRows: 'repeat(7, 10px)' }"
        >
          <div
            v-for="day in contributionDays"
            :key="day.date"
            class="w-[10px] h-[10px] rounded-sm cursor-default transition-[filter] hover:brightness-125"
            :class="levelClasses[day.level]"
            :style="{ gridColumn: day.gridColumn, gridRow: day.gridRow }"
            @mouseenter="showTooltip($event, day)"
            @mouseleave="hideTooltip"
          ></div>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="tooltip.visible"
          class="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2.5 py-1.5 rounded-md bg-surface border border-fg/10 shadow-lg text-xs font-mono whitespace-nowrap"
          :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        >
          <div class="text-fg font-semibold">{{ tooltip.count }} contribution{{ tooltip.count === 1 ? '' : 's' }}</div>
          <div class="text-muted/70">{{ tooltip.dateLabel }}</div>
        </div>
      </Teleport>
    </section>

    <section>
      <h2 class="text-s font-mono text-muted uppercase tracking-widest mb-6">My Favorite Rock Playlist</h2>
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
          <p class="text-muted">
            Continuously updating ShutterWingPhotos, building llmgps, and getting into IoT —
            more on the <RouterLink to="/now" class="text-fg hover:text-accent transition-colors">/now page</RouterLink>.
          </p>
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
