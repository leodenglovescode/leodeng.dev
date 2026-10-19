<script setup>
import { computed } from 'vue'
const props = defineProps({ progress: { type: Object, required: true } })
const percent = computed(() => props.progress.phase === 'complete' ? 100 : props.progress.total > 0 ? Math.min(100, Math.floor(props.progress.loaded / props.progress.total * 100)) : 0)
const determinate = computed(() => ['complete', 'error'].includes(props.progress.phase) || (props.progress.phase === 'uploading' && props.progress.total > 0))
const label = computed(() => {
  const { phase, fileName, index, count } = props.progress
  const batch = count > 1 ? ` (${index} of ${count})` : ''
  if (phase === 'complete') return count > 1 ? `Uploaded ${count} files.` : `Uploaded ${fileName}.`
  if (phase === 'error') return `Upload failed: ${fileName}${batch}`
  if (phase === 'preparing') return `Preparing ${fileName}${batch}`
  if (phase === 'saving') return `Saving ${fileName} to R2${batch}…`
  return `Uploading ${fileName}${batch}`
})
</script>

<template>
  <div v-if="progress.phase !== 'idle'" class="upload-progress min-w-0" :class="{ failed: progress.phase === 'error' }">
    <div class="flex items-start justify-between gap-2 text-xs text-muted mb-2">
      <p role="status" aria-live="polite" class="min-w-0 break-words">{{ label }}</p>
      <span v-if="determinate" class="font-mono shrink-0" aria-hidden="true">{{ percent }}%</span>
    </div>
    <progress :value="determinate ? percent : undefined" max="100" :aria-label="label" />
  </div>
</template>

<style scoped>
progress { display: block; width: 100%; height: 6px; border: 0; border-radius: 4px; overflow: hidden; appearance: none; background: color-mix(in srgb, var(--color-fg) 10%, transparent); color: var(--color-accent); }
progress::-webkit-progress-bar { background: color-mix(in srgb, var(--color-fg) 10%, transparent); border-radius: 4px; }
progress::-webkit-progress-value { background: var(--color-accent); border-radius: 4px; }
progress::-moz-progress-bar { background: var(--color-accent); border-radius: 4px; }
progress:indeterminate { background: linear-gradient(90deg, transparent, var(--color-accent), transparent), color-mix(in srgb, var(--color-fg) 10%, transparent); background-size: 45% 100%, 100% 100%; background-repeat: no-repeat; animation: upload-pulse 1.3s ease-in-out infinite alternate; }
progress:indeterminate::-webkit-progress-bar { background: transparent; }
.failed progress { color: #ef4444; }.failed progress::-webkit-progress-value { background: #ef4444; }.failed progress::-moz-progress-bar { background: #ef4444; }
@keyframes upload-pulse { from { background-position: 0% 0; } to { background-position: 100% 0; } }
@media (prefers-reduced-motion: reduce) { progress:indeterminate { animation: none; background-position: center; } }
</style>
