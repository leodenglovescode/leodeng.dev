<script setup>
import { useLocale } from '../utils/i18n.js'

const { t } = useLocale('privacy')
</script>

<template>
  <article class="pt-16 sm:pt-24 pb-20">
    <header class="mb-10">
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">{{ t('title') }}</h1>
      <p class="mt-3 text-xs font-mono text-muted">{{ t('updated') }}</p>
      <p class="mt-5 text-sm text-muted leading-relaxed">{{ t('intro') }}</p>
    </header>

    <section v-for="section in t('sections')" :key="section.id" :aria-labelledby="`privacy-${section.id}`" class="mb-8">
      <h2 :id="`privacy-${section.id}`" class="text-lg font-semibold mb-3">{{ section.title }}</h2>
      <p v-for="paragraph in section.paragraphs" :key="paragraph" class="text-sm text-muted leading-relaxed mb-3">{{ paragraph }}</p>
      <ul v-if="section.links" class="text-sm space-y-2">
        <li v-for="link in section.links" :key="link.href">
          <a :href="link.href" class="text-accent underline underline-offset-4">{{ link.label }}</a>
        </li>
      </ul>
    </section>
  </article>
</template>
