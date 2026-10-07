<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { interests, orbitFor } from '../content/interests'
import { useLocale } from '../utils/i18n.js'

const { isZh, t, localePath } = useLocale('interests')

const InterestVortex3D = defineAsyncComponent(() =>
  import('../components/interests/InterestVortex3D.vue')
)

const STORAGE_KEY = 'leodeng-shared-interests'

const orbitLabel = (orbit) => ({
  often: t('oftenInMyHead'),
  waves: t('comesInWaves'),
  parked: t('parkedForNow'),
}[orbit.key])

const interestItems = computed(() => interests.map((interest, index) => {
  const copy = t(`items.${interest.id}`)
  const orbit = orbitFor(interest.progress)
  return {
    ...interest,
    ...copy,
    vortexLabel: copy.vortexLabel || copy.label,
    number: String(index + 1).padStart(2, '0'),
    orbit: { ...orbit, label: orbitLabel(orbit) },
  }
}))

const selectedId = ref(interests[0].id)
const sharedIds = ref([])
const userPaused = ref(false)
const prefersReducedMotion = ref(false)
const sceneReady = ref(false)
const webglAvailable = ref(true)
const compactScene = ref(false)
const palette = ref({
  accent: '#4d9dff',
  highlight: '#f5c518',
  sunCore: '#ffd45c',
  sunGlow: '#ff8a1f',
})
let motionQuery
let compactQuery
let themeObserver

const selectedInterest = computed(() =>
  interestItems.value.find((interest) => interest.id === selectedId.value) ?? interestItems.value[0]
)

const sharedInterests = computed(() =>
  interestItems.value.filter((interest) => sharedIds.value.includes(interest.id))
)

const matchCopy = computed(() => {
  const count = sharedInterests.value.length
  if (!count) return t('pickAnythingYouAreIntoToo')
  if (count === 1) return t('oneSharedRabbitHoleThatIsEnough')
  if (count <= 3) {
    const names = new Intl.ListFormat(isZh.value ? 'zh-CN' : 'en', { style: 'long', type: 'conjunction' })
      .format(sharedInterests.value.map((interest) => interest.label))
    return t('sharedInterestsWeWouldProbablyEndUp', { p0: count, p1: names })
  }
  if (count <= 7) return t('thingsInCommonThisConversationCouldTake', { p0: count })
  return t('thingsInCommonWeMayBeThe', { p0: count })
})

const motionPaused = computed(() => userPaused.value || prefersReducedMotion.value)

function selectInterest(id) {
  selectedId.value = id
}

function saveShared() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedIds.value))
  } catch {
    // The survey still works for this visit when storage is unavailable.
  }
}

function toggleShared(interest) {
  selectedId.value = interest.id
  sharedIds.value = sharedIds.value.includes(interest.id)
    ? sharedIds.value.filter((id) => id !== interest.id)
    : [...sharedIds.value, interest.id]
  saveShared()
}

function clearShared() {
  sharedIds.value = []
  saveShared()
}

function syncMotionPreference(event) {
  prefersReducedMotion.value = event.matches
}

function syncCompactPreference(event) {
  compactScene.value = event.matches
}

function syncPalette() {
  const styles = getComputedStyle(document.documentElement)
  palette.value = {
    accent: styles.getPropertyValue('--color-accent').trim() || '#4d9dff',
    highlight: styles.getPropertyValue('--color-highlight').trim() || '#f5c518',
    sunCore: '#ffd45c',
    sunGlow: '#ff8a1f',
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = motionQuery.matches
  motionQuery.addEventListener?.('change', syncMotionPreference)

  compactQuery = window.matchMedia('(max-width: 540px)')
  compactScene.value = compactQuery.matches
  compactQuery.addEventListener?.('change', syncCompactPreference)

  syncPalette()
  themeObserver = new MutationObserver(syncPalette)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const validIds = new Set(interestItems.value.map((interest) => interest.id))
    if (Array.isArray(saved)) sharedIds.value = saved.filter((id) => validIds.has(id))
  } catch {
    // Start fresh if an old or hand-edited value is not valid JSON.
  }

  webglAvailable.value = supportsWebGL()
  sceneReady.value = webglAvailable.value
})

onBeforeUnmount(() => {
  motionQuery?.removeEventListener?.('change', syncMotionPreference)
  compactQuery?.removeEventListener?.('change', syncCompactPreference)
  themeObserver?.disconnect()
})
</script>

<template>
  <section class="pt-20 sm:pt-32 pb-20">
    <header class="mb-8">
      <h1 class="text-s font-mono text-muted uppercase tracking-widest mb-2">{{ t('interests') }}</h1>
      <p class="text-2xl sm:text-3xl font-semibold text-fg leading-tight mb-4">
        {{ t('whatKeepsPullingMeIn') }}<span class="text-highlight">{{ isZh ? '。' : '.' }}</span>
      </p>
      <p class="max-w-2xl text-[15px] leading-relaxed text-muted">
        {{ t('aMapOfMyCurrentRabbitHoles') }}
      </p>
    </header>

    <div class="orbit-key" :aria-label="t('vortexPositionKey')">
      <span><b>{{ t('center') }}</b> {{ t('oftenInMyHead') }}</span>
      <span><b>{{ t('middle') }}</b> {{ t('comesInWaves') }}</span>
      <span><b>{{ t('edge') }}</b> {{ t('parkedForNow') }}</span>
    </div>

    <div class="vortex-map" :aria-label="t('interactive3dInterestVortex')">
      <InterestVortex3D
        v-if="sceneReady"
        :interests="interestItems"
        :selected-id="selectedId"
        :shared-ids="sharedIds"
        :paused="motionPaused"
        :compact="compactScene"
        :palette="palette"
        @select="selectInterest"
      />

      <div v-else class="vortex-fallback">
        <p class="font-mono text-xs text-muted">
          {{ webglAvailable ? t('preparing3dVortex') : t('3dIsUnavailableInThisBrowser') }}
        </p>
      </div>

      <div v-if="sceneReady" class="vortex-hint" aria-hidden="true">{{ t('dragToTilt') }}</div>

      <button
        type="button"
        class="motion-toggle"
        :aria-pressed="motionPaused"
        :disabled="prefersReducedMotion"
        @click="userPaused = !userPaused"
      >
        <span aria-hidden="true">{{ motionPaused ? '▶' : 'Ⅱ' }}</span>
        {{ prefersReducedMotion ? t('reducedMotion') : motionPaused ? t('resumeDrift') : t('pauseDrift') }}
      </button>
    </div>

    <div class="selected-interest" aria-live="polite">
      <div>
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-semibold text-fg">{{ selectedInterest.label }}</h2>
          <span class="orbit-badge">{{ selectedInterest.orbit.label }}</span>
        </div>
        <p class="text-sm leading-relaxed text-muted">{{ selectedInterest.description }}</p>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-3 mt-4">
          <RouterLink
            v-if="selectedInterest.link"
            :to="localePath(selectedInterest.link)"
            class="text-xs font-mono text-fg hover:text-accent transition-colors"
          >
            → {{ selectedInterest.linkLabel }}
          </RouterLink>
          <button
            type="button"
            class="text-xs font-mono transition-colors"
            :class="sharedIds.includes(selectedInterest.id) ? 'text-highlight' : 'text-muted hover:text-fg'"
            :aria-pressed="sharedIds.includes(selectedInterest.id)"
            @click="toggleShared(selectedInterest)"
          >
            {{ sharedIds.includes(selectedInterest.id) ? t('sharedInterest') : t('iAmIntoThisToo') }}
          </button>
        </div>
      </div>
    </div>

    <section class="survey" aria-labelledby="survey-title">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 id="survey-title" class="font-semibold text-fg mb-1">{{ t('whatPullsYouIn') }}</h2>
          <p class="text-sm text-muted">{{ t('pickAnythingWeHaveInCommonGold') }}</p>
        </div>
        <button
          v-if="sharedIds.length"
          type="button"
          class="text-xs font-mono text-muted hover:text-fg transition-colors"
          @click="clearShared"
        >
          {{ t('clearMine') }}
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="interest in interestItems"
          :key="`survey-${interest.id}`"
          type="button"
          class="survey-choice"
          :class="{ 'is-shared': sharedIds.includes(interest.id) }"
          :aria-pressed="sharedIds.includes(interest.id)"
          @click="toggleShared(interest)"
        >
          {{ interest.label }}
        </button>
      </div>

      <p class="mt-5 text-sm text-fg" aria-live="polite">{{ matchCopy }}</p>
      <p class="mt-2 text-xs font-mono text-muted/90">{{ t('nothingGetsSentAnywhereThisStaysIn') }}</p>
    </section>

    <div class="mt-16">
      <div class="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 class="text-xs font-mono text-muted/90 uppercase tracking-widest mb-2">{{ t('theMapExplained') }}</h2>
          <p class="text-sm text-muted">{{ t('theSameInterestsWithoutMakingYouChase') }}</p>
        </div>
        <span class="hidden sm:block text-xs font-mono text-muted/90">{{ t('alwaysShifting') }}</span>
      </div>

      <ol class="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
        <li
          v-for="interest in interestItems"
          :key="`plain-${interest.id}`"
          class="grid grid-cols-[2rem_1fr] gap-3 py-5 border-t border-fg/8"
        >
          <span class="font-mono text-xs text-accent pt-1">{{ interest.number }}</span>
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <h3 class="font-semibold text-fg">{{ interest.label }}</h3>
              <span class="orbit-badge">{{ interest.orbit.label }}</span>
            </div>
            <p class="text-sm text-muted leading-relaxed">{{ interest.description }}</p>
          </div>
        </li>
      </ol>
    </div>

    <p class="mt-12 text-xs font-mono text-muted/90">
      {{ t('positionMeansCurrentAttentionNotImportanceThis') }}
    </p>
  </section>
</template>

<style scoped>
.orbit-key {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1.25rem;
  margin-bottom: 1rem;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.orbit-key span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.orbit-key b {
  color: var(--color-fg);
  font-weight: 400;
}

.vortex-map {
  position: relative;
  isolation: isolate;
  height: clamp(25rem, 76vw, 38rem);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 0.75rem;
  background:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 22%),
    radial-gradient(circle at 50% 50%, var(--color-surface), var(--color-bg) 76%);
}

.vortex-map :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.vortex-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
}

.vortex-hint,
.motion-toggle {
  position: absolute;
  z-index: 30;
  bottom: 0.75rem;
  min-height: 2rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--color-bg) 88%, transparent);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  backdrop-filter: blur(8px);
}

.vortex-hint {
  left: 0.75rem;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.motion-toggle {
  right: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: color 150ms ease, border-color 150ms ease;
}

.motion-toggle:hover:not(:disabled) {
  color: var(--color-fg);
  border-color: color-mix(in srgb, var(--color-fg) 22%, transparent);
}

.motion-toggle:disabled {
  opacity: 0.75;
}

.selected-interest {
  min-height: 8rem;
  padding: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-top: 0;
  border-radius: 0 0 0.75rem 0.75rem;
  background: color-mix(in srgb, var(--color-surface) 72%, transparent);
}

.orbit-badge {
  padding: 0.15rem 0.45rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 999px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 400;
}

.survey {
  margin-top: 3rem;
  padding: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 9%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-surface) 45%, transparent);
}

.survey-choice {
  min-height: 2rem;
  padding: 0.3rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);
  border-radius: 999px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease;
}

.survey-choice:hover {
  color: var(--color-fg);
  border-color: color-mix(in srgb, var(--color-fg) 25%, transparent);
}

.survey-choice.is-shared {
  border-color: transparent;
  background: var(--color-highlight);
  color: #111;
}

@media (max-width: 540px) {
  .vortex-map {
    height: 26rem;
  }

  .vortex-hint,
  .motion-toggle {
    bottom: 0.5rem;
  }

  .vortex-hint {
    left: 0.5rem;
  }

  .motion-toggle {
    right: 0.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .motion-toggle,
  .survey-choice {
    transition: none;
  }
}
</style>
