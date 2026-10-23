<script setup>
defineProps({ modelValue: { type: Object, required: true }, label: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <fieldset class="grid sm:grid-cols-2 gap-3">
    <legend class="text-sm text-muted mb-2">{{ label }}</legend>
    <label v-for="lang in ['en', 'zh']" :key="lang" class="block text-xs text-muted">
      {{ lang === 'en' ? 'English' : 'Chinese (optional)' }}
      <input :value="modelValue[lang]" class="mt-1 w-full rounded-md border border-fg/15 bg-bg px-3 py-2 text-sm text-fg" @input="emit('update:modelValue', { ...modelValue, [lang]: $event.target.value })" />
    </label>
  </fieldset>
</template>
