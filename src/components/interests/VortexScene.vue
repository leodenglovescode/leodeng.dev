<script setup>
import { computed, markRaw, ref } from 'vue'
import { Html, OrbitControls } from '@tresjs/cientos'
import { useLoop } from '@tresjs/core'
import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  DynamicDrawUsage,
  TubeGeometry,
  Vector3,
} from 'three'

const props = defineProps({
  interests: { type: Array, required: true },
  selectedId: { type: String, required: true },
  sharedIds: { type: Array, required: true },
  paused: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  palette: { type: Object, required: true },
})

const emit = defineEmits(['select'])
const vortexGroup = ref(null)

// Radius and depth grow together, producing a real funnel rather than a flat
// spiral with perspective painted on. The center sits farther from the camera.
function pointOnVortex(progress) {
  const angle = progress * Math.PI * 2 * 4.25 - Math.PI / 2
  const radius = 0.22 + progress * 3.38

  return new Vector3(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * 0.76,
    -2.45 + progress * 2.65,
  )
}

// Labels get their own wider spiral. Keeping them off the actual nodes gives
// the first few interests enough room to be readable around the sun.
function labelPointOnVortex(progress, index) {
  const compactSlots = [
    [2.2, 0],
    [-3.2, 0],
    [2.2, 1.7],
    [0, 1.7],
    [-3.2, 1.7],
    [0, -1.7],
    [2.2, 3.4],
    [-3.2, 3.4],
    [1.15, -3.4],
    [0, 3.4],
    [-2.25, -3.4],
    [-3.2, -1.7],
    [2.2, -1.7],
  ]

  if (props.compact) {
    const [x, y] = compactSlots[index] ?? [0, 0]
    return new Vector3(x, y, -0.5)
  }

  const labelAngles = [
    0, 1.05, 2.1, 3.15, 4.2, 5.25,
    0.2, 1.45, 2.7, 3.55, 5.2,
    2.85, 5.75,
  ]
  const angle = labelAngles[index] ?? progress * Math.PI * 2
  const labelRadius = index < 6 ? 1.68 : index < 11 ? 2.72 : 3.52

  return new Vector3(
    Math.cos(angle) * labelRadius,
    Math.sin(angle) * labelRadius * 0.78,
    -2.38 + progress * 2.58,
  )
}

const curvePoints = Array.from({ length: 241 }, (_, index) => pointOnVortex(index / 240))
const curve = markRaw(new CatmullRomCurve3(curvePoints, false, 'centripetal'))
const tubeGeometry = markRaw(new TubeGeometry(curve, 360, 0.022, 8, false))
const particleGeometry = markRaw(new BufferGeometry().setFromPoints(
  Array.from({ length: 181 }, (_, index) => pointOnVortex(index / 180)),
))
const flowOffsets = Array.from({ length: 9 }, (_, index) =>
  (index * 0.61803398875) % 1
)
const flowGeometry = markRaw(new BufferGeometry().setFromPoints(
  flowOffsets.map((progress) => pointOnVortex(progress)),
))
flowGeometry.getAttribute('position').setUsage(DynamicDrawUsage)
const driftTime = ref(0)

const positionedInterests = props.interests.map((interest, index) => {
  const point = pointOnVortex(interest.progress)
  const labelPoint = labelPointOnVortex(interest.progress, index)

  return {
    ...interest,
    position: point.toArray(),
    labelPosition: labelPoint.toArray(),
    connectorGeometry: markRaw(new BufferGeometry().setFromPoints([point, labelPoint])),
  }
})

const sceneInterests = computed(() => positionedInterests.map((interest) => ({
  ...interest,
  shared: props.sharedIds.includes(interest.id),
})))

const coronaRaysGeometry = markRaw(new BufferGeometry().setFromPoints(
  Array.from({ length: 32 }, (_, index) => {
    const ray = Math.floor(index / 2)
    const angle = (ray / 16) * Math.PI * 2
    const radius = index % 2 === 0 ? 0.44 : ray % 2 === 0 ? 0.72 : 0.6

    return new Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      -2.5,
    )
  }),
))

const { onBeforeRender } = useLoop()

onBeforeRender(({ delta }) => {
  if (!vortexGroup.value || props.paused) return

  // Track active time instead of global elapsed time so pause and resume do not
  // jump. The limited roll keeps the labels apart while still reading as drift.
  driftTime.value += Math.min(delta, 0.05)
  const phase = driftTime.value
  const compactFactor = props.compact ? 0.4 : 1

  vortexGroup.value.rotation.z = 0.08 + Math.sin(phase * 0.45) * 0.16 * compactFactor
  vortexGroup.value.rotation.y = 0.3 + Math.sin(phase * 0.32) * 0.12 * compactFactor
  vortexGroup.value.rotation.x = -0.35 + Math.cos(phase * 0.27) * 0.06 * compactFactor
  vortexGroup.value.position.x = Math.cos(phase * 0.38) * 0.08 * compactFactor
  vortexGroup.value.position.y = Math.sin(phase * 0.5) * 0.12 * compactFactor

  const flowPositions = flowGeometry.getAttribute('position')
  flowOffsets.forEach((offset, index) => {
    const point = pointOnVortex((offset + phase * 0.055) % 1)
    flowPositions.setXYZ(index, point.x, point.y, point.z)
  })
  flowPositions.needsUpdate = true
})
</script>

<template>
  <TresAmbientLight :intensity="1.4" />
  <TresPointLight :position="[4, 3, 6]" :intensity="18" :color="palette.accent" />
  <TresPointLight :position="[-3, -2, 4]" :intensity="10" :color="palette.highlight" />

  <TresGroup ref="vortexGroup" :rotation="[-0.35, 0.3, 0.08]">
    <TresMesh :geometry="tubeGeometry">
      <TresMeshStandardMaterial
        :color="palette.accent"
        :transparent="true"
        :opacity="0.72"
        :metalness="0.28"
        :roughness="0.34"
        :emissive="palette.accent"
        :emissive-intensity="0.18"
      />
    </TresMesh>

    <TresPoints :geometry="particleGeometry">
      <TresPointsMaterial
        :color="palette.highlight"
        :size="0.055"
        :size-attenuation="true"
        :transparent="true"
        :opacity="0.95"
      />
    </TresPoints>

    <TresPoints :geometry="flowGeometry">
      <TresPointsMaterial
        :color="palette.highlight"
        :size="0.15"
        :size-attenuation="true"
        :transparent="true"
        :opacity="0.95"
        :blending="AdditiveBlending"
        :depth-write="false"
      />
    </TresPoints>

    <TresLineSegments :geometry="coronaRaysGeometry">
      <TresLineBasicMaterial
        :color="palette.sunGlow"
        :transparent="true"
        :opacity="0.36"
        :blending="AdditiveBlending"
        :depth-write="false"
      />
    </TresLineSegments>

    <TresMesh :position="[0, 0, -2.5]">
      <TresRingGeometry :args="[0.42, 0.68, 64]" />
      <TresMeshBasicMaterial
        :color="palette.sunGlow"
        :transparent="true"
        :opacity="0.18"
        :side="DoubleSide"
        :blending="AdditiveBlending"
        :depth-write="false"
      />
    </TresMesh>

    <TresMesh :position="[0, 0, -2.5]">
      <TresSphereGeometry :args="[0.36, 40, 40]" />
      <TresMeshStandardMaterial
        :color="palette.sunCore"
        :emissive="palette.sunGlow"
        :emissive-intensity="1.45"
        :roughness="0.72"
      />
    </TresMesh>

    <TresMesh :position="[0, 0, -2.5]" :scale="1.5">
      <TresSphereGeometry :args="[0.36, 32, 32]" />
      <TresMeshBasicMaterial
        :color="palette.sunGlow"
        :transparent="true"
        :opacity="0.12"
        :blending="AdditiveBlending"
        :depth-write="false"
      />
    </TresMesh>

    <TresPointLight
      :position="[0, 0, -2.12]"
      :intensity="24"
      :distance="7"
      :decay="2"
      :color="palette.sunGlow"
    />

    <template v-for="interest in sceneInterests" :key="interest.id">
      <TresLine :geometry="interest.connectorGeometry">
        <TresLineBasicMaterial
          :color="interest.shared ? palette.highlight : palette.accent"
          :transparent="true"
          :opacity="interest.shared ? 0.55 : 0.22"
        />
      </TresLine>

      <TresMesh :position="interest.position">
        <TresSphereGeometry
          :args="[selectedId === interest.id ? 0.12 : interest.shared ? 0.1 : 0.075, 18, 18]"
        />
        <TresMeshStandardMaterial
          :color="interest.shared ? palette.highlight : palette.accent"
          :metalness="0.2"
          :roughness="0.3"
          :emissive="interest.shared ? palette.highlight : palette.accent"
          :emissive-intensity="interest.shared ? 0.42 : 0.16"
        />
      </TresMesh>

      <Html
        center
        :position="interest.labelPosition"
        :distance-factor="8"
        :z-index-range="selectedId === interest.id ? [30, 30] : [20, 1]"
      >
        <button
          type="button"
          class="vortex-word"
          :class="{
            'is-selected': selectedId === interest.id,
            'is-shared': interest.shared,
          }"
          :aria-pressed="selectedId === interest.id"
          :aria-label="`${interest.label}: ${interest.description}`"
          @click.stop="emit('select', interest.id)"
        >
          {{ interest.vortexLabel || interest.label }}
        </button>
      </Html>
    </template>
  </TresGroup>

  <OrbitControls
    :enable-pan="false"
    :enable-zoom="false"
    :enable-damping="true"
    :damping-factor="0.08"
    :rotate-speed="0.35"
    :min-polar-angle="0.95"
    :max-polar-angle="2.2"
  />
</template>

<style scoped>
.vortex-word {
  min-height: 2rem;
  padding: 0.32rem 0.68rem;
  border: 1px solid color-mix(in srgb, var(--color-fg) 14%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg) 90%, transparent);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

.vortex-word:hover,
.vortex-word:focus-visible {
  color: var(--color-fg);
  border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
  transform: scale(1.05);
}

.vortex-word.is-shared {
  color: var(--color-highlight);
  border-color: color-mix(in srgb, var(--color-highlight) 70%, transparent);
}

.vortex-word.is-selected {
  color: #fff;
  border-color: transparent;
  background: var(--color-accent-strong);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 14%, transparent);
}

.vortex-word.is-selected.is-shared {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-highlight) 34%, transparent);
}

@media (max-width: 540px) {
  .vortex-word {
    min-height: 1.7rem;
    padding: 0.24rem 0.5rem;
    font-size: 0.62rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vortex-word {
    transition: none;
  }
}
</style>
