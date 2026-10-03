<script setup>
import { TresCanvas } from '@tresjs/core'
import VortexScene from './VortexScene.vue'

defineProps({
  interests: { type: Array, required: true },
  selectedId: { type: String, required: true },
  sharedIds: { type: Array, required: true },
  paused: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  palette: { type: Object, required: true },
})

defineEmits(['select'])
</script>

<template>
  <TresCanvas
    :alpha="true"
    :clear-alpha="0"
    :antialias="true"
    :dpr="[1, 1.75]"
    render-mode="always"
  >
    <TresPerspectiveCamera
      :position="compact ? [0, 0.15, 10.2] : [0, 0.15, 8.6]"
      :fov="compact ? 48 : 46"
    />
    <VortexScene
      :key="compact ? 'compact' : 'wide'"
      :interests="interests"
      :selected-id="selectedId"
      :shared-ids="sharedIds"
      :paused="paused"
      :compact="compact"
      :palette="palette"
      @select="$emit('select', $event)"
    />
  </TresCanvas>
</template>
