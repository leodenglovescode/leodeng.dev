<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { renderMarkdown } from '../../utils/posts.js'
import { renderMermaid } from '../../utils/mermaid.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'request-media', 'save'])

const textarea = ref(null)
const previewPane = ref(null)
const showPreview = ref(true)

const html = computed(() => {
  try {
    return renderMarkdown(props.modelValue || '')
  } catch {
    return '<p>Preview unavailable.</p>'
  }
})

const stats = computed(() => {
  const text = (props.modelValue || '').trim()
  const words = text ? text.split(/\s+/).length : 0
  return { words, chars: text.length, minutes: Math.max(1, Math.round(words / 200)) }
})

/* ---------- text manipulation ---------- */

// Goes through execCommand so the browser's native undo stack keeps working —
// losing ctrl+Z after every toolbar click is what makes an editor feel cheap.
function replaceRange(start, end, text, selStart = null, selEnd = null) {
  const el = textarea.value
  if (!el) return
  el.focus()
  el.setSelectionRange(start, end)

  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    el.setRangeText(text, start, end, 'end')
  }

  emit('update:modelValue', el.value)
  el.setSelectionRange(selStart ?? start + text.length, selEnd ?? start + text.length)
}

/** Wraps the selection (or the word under the caret) in a marker pair, toggling. */
function surround(before, after = before, placeholder = '') {
  const el = textarea.value
  if (!el) return
  const value = el.value
  let { selectionStart: start, selectionEnd: end } = el

  // Nothing selected: grab the word the caret sits in, so ctrl+B on a word
  // bolds the word rather than dropping empty markers.
  if (start === end) {
    const left = value.slice(0, start).search(/[^\s]*$/)
    const right = start + value.slice(start).match(/^[^\s]*/)[0].length
    if (right > left) {
      start = left
      end = right
    }
  }

  const selected = value.slice(start, end)

  // Already wrapped? Unwrap instead.
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length)
    replaceRange(start, end, inner, start, start + inner.length)
    return
  }
  if (
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    replaceRange(start - before.length, end + after.length, selected, start - before.length, end - before.length)
    return
  }

  const body = selected || placeholder
  replaceRange(start, end, `${before}${body}${after}`, start + before.length, start + before.length + body.length)
}

/** Expands the selection to whole lines and rewrites each one. */
function mapLines(fn) {
  const el = textarea.value
  if (!el) return
  const value = el.value
  const start = value.lastIndexOf('\n', el.selectionStart - 1) + 1
  let end = value.indexOf('\n', el.selectionEnd)
  if (end === -1) end = value.length

  const lines = value.slice(start, end).split('\n')
  const next = fn(lines).join('\n')
  replaceRange(start, end, next, start, start + next.length)
}

function toggleHeading(level) {
  const marker = '#'.repeat(level)
  mapLines((lines) =>
    lines.map((line) => {
      const stripped = line.replace(/^#{1,6}\s+/, '')
      return line.startsWith(`${marker} `) ? stripped : `${marker} ${stripped}`
    }),
  )
}

function togglePrefix(prefix) {
  mapLines((lines) => {
    const allPrefixed = lines.every((line) => !line.trim() || line.startsWith(prefix))
    return lines.map((line) => {
      if (!line.trim()) return line
      return allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`
    })
  })
}

function toggleOrderedList() {
  mapLines((lines) => {
    const allNumbered = lines.every((line) => !line.trim() || /^\d+\.\s/.test(line))
    let n = 0
    return lines.map((line) => {
      if (!line.trim()) return line
      if (allNumbered) return line.replace(/^\d+\.\s/, '')
      n += 1
      return `${n}. ${line}`
    })
  })
}

function insertBlock(text) {
  const el = textarea.value
  if (!el) return
  const { selectionStart: start, selectionEnd: end } = el
  const needsLeadingBreak = start > 0 && el.value[start - 1] !== '\n'
  const block = `${needsLeadingBreak ? '\n\n' : ''}${text}`
  replaceRange(start, end, block)
}

function insertLink() {
  const el = textarea.value
  if (!el) return
  const { selectionStart: start, selectionEnd: end } = el
  const selected = el.value.slice(start, end)
  const isUrl = /^https?:\/\/\S+$/.test(selected)
  const label = isUrl ? 'link text' : selected || 'link text'
  const url = isUrl ? selected : 'https://'
  const text = `[${label}](${url})`
  // Put the caret on whichever half still needs typing.
  const from = isUrl ? start + 1 : start + label.length + 3
  const to = isUrl ? start + 1 + label.length : start + label.length + 3 + url.length
  replaceRange(start, end, text, from, to)
}

/** Called by the parent after the media manager picks a file. */
function insertMedia({ markdown }) {
  insertBlock(markdown)
}

defineExpose({ insertMedia, focus: () => textarea.value?.focus() })

/* ---------- keyboard ---------- */

const LIST_ITEM = /^(\s*)([-*+]\s|\d+\.\s|>\s)(.*)$/

function onKeydown(event) {
  const el = textarea.value
  const mod = event.metaKey || event.ctrlKey

  if (mod && !event.altKey) {
    const key = event.key.toLowerCase()
    const shortcuts = {
      b: () => surround('**', '**', 'bold text'),
      i: () => surround('*', '*', 'italic text'),
      u: () => surround('<u>', '</u>', 'underlined text'),
      k: insertLink,
    }
    if (key === 's') {
      event.preventDefault()
      emit('save')
      return
    }
    if (key === 'x' && event.shiftKey) {
      event.preventDefault()
      surround('~~', '~~', 'struck through')
      return
    }
    if (shortcuts[key] && !event.shiftKey) {
      event.preventDefault()
      shortcuts[key]()
      return
    }
    if (/^[123]$/.test(event.key)) {
      event.preventDefault()
      toggleHeading(Number(event.key))
      return
    }
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    const multiline = el.value.slice(el.selectionStart, el.selectionEnd).includes('\n')
    if (multiline || event.shiftKey) {
      mapLines((lines) =>
        lines.map((line) =>
          event.shiftKey ? line.replace(/^(\t| {1,2})/, '') : `  ${line}`,
        ),
      )
    } else {
      replaceRange(el.selectionStart, el.selectionEnd, '  ')
    }
    return
  }

  // Enter inside a list continues it; Enter on an empty item ends the list.
  if (event.key === 'Enter' && !event.shiftKey && el.selectionStart === el.selectionEnd) {
    const value = el.value
    const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    const line = value.slice(lineStart, el.selectionStart)
    const match = line.match(LIST_ITEM)
    if (!match) return

    const [, indent, marker, rest] = match
    event.preventDefault()

    if (!rest.trim()) {
      replaceRange(lineStart, el.selectionStart, '')
      return
    }
    const nextMarker = /^\d+\.\s$/.test(marker)
      ? `${parseInt(marker, 10) + 1}. `
      : marker
    replaceRange(el.selectionStart, el.selectionStart, `\n${indent}${nextMarker}`)
  }
}

/* ---------- scroll sync ---------- */

let syncing = false

function syncScroll(source) {
  const editor = textarea.value
  const preview = previewPane.value
  if (!editor || !preview || syncing) return
  syncing = true
  const [from, to] = source === 'editor' ? [editor, preview] : [preview, editor]
  const range = from.scrollHeight - from.clientHeight
  const ratio = range > 0 ? from.scrollTop / range : 0
  to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
  requestAnimationFrame(() => {
    syncing = false
  })
}

watch(showPreview, () => {
  if (!showPreview.value) return
  requestAnimationFrame(() => syncScroll('editor'))
  drawDiagrams()
})

/* ---------- mermaid ---------- */

// v-html rebuilds the preview on every keystroke, so diagrams are re-mounted
// constantly. Debounce it (half-finished syntax renders as an error anyway)
// and let utils/mermaid.js serve unchanged diagrams from its cache.
let diagramTimer = null

function drawDiagrams(delay = 400) {
  clearTimeout(diagramTimer)
  diagramTimer = setTimeout(async () => {
    await nextTick()
    if (previewPane.value) renderMermaid(previewPane.value)
  }, delay)
}

watch(html, () => drawDiagrams(), { immediate: true })

onUnmounted(() => clearTimeout(diagramTimer))

/* ---------- toolbar definition ---------- */

const groups = [
  [
    { label: 'H1', title: 'Heading 1  (ctrl+1)', run: () => toggleHeading(1), mono: true },
    { label: 'H2', title: 'Heading 2  (ctrl+2)', run: () => toggleHeading(2), mono: true },
    { label: 'H3', title: 'Heading 3  (ctrl+3)', run: () => toggleHeading(3), mono: true },
  ],
  [
    { label: 'B', title: 'Bold  (ctrl+B)', run: () => surround('**', '**', 'bold text'), class: 'font-bold' },
    { label: 'I', title: 'Italic  (ctrl+I)', run: () => surround('*', '*', 'italic text'), class: 'italic font-serif' },
    { label: 'U', title: 'Underline  (ctrl+U)', run: () => surround('<u>', '</u>', 'underlined text'), class: 'underline' },
    { label: 'S', title: 'Strikethrough  (ctrl+shift+X)', run: () => surround('~~', '~~', 'struck through'), class: 'line-through' },
  ],
  [
    { label: '“ ”', title: 'Blockquote', run: () => togglePrefix('> ') },
    { label: '• —', title: 'Bullet list', run: () => togglePrefix('- ') },
    { label: '1.', title: 'Numbered list', run: toggleOrderedList, mono: true },
  ],
  [
    { label: '</>', title: 'Inline code', run: () => surround('`', '`', 'code'), mono: true },
    { label: '{ }', title: 'Code block', run: () => insertBlock('```js\n\n```\n'), mono: true },
    {
      label: 'Diagram',
      title: 'Mermaid diagram',
      run: () => insertBlock('```mermaid\nflowchart LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]\n```\n'),
    },
    { label: '—', title: 'Horizontal rule', run: () => insertBlock('---\n\n') },
    { label: '🔗', title: 'Link  (ctrl+K)', run: insertLink },
  ],
]
</script>

<template>
  <div class="flex flex-col rounded-lg border border-fg/10 bg-surface overflow-hidden">
    <div class="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-fg/10 bg-fg/[0.02]">
      <template v-for="(group, gi) in groups" :key="gi">
        <span v-if="gi > 0" class="w-px h-4 bg-fg/10 mx-1" />
        <button
          v-for="item in group"
          :key="item.label"
          type="button"
          :title="item.title"
          :aria-label="item.title"
          class="min-w-8 h-8 px-2 rounded text-xs text-muted hover:text-fg hover:bg-fg/5 active:bg-fg/10 transition-colors"
          :class="[item.class, item.mono && 'font-mono']"
          @click="item.run()"
        >{{ item.label }}</button>
      </template>

      <span class="w-px h-4 bg-fg/10 mx-1" />
      <button
        type="button"
        title="Insert image or media"
        class="h-8 px-2.5 rounded text-xs text-muted hover:text-fg hover:bg-fg/5 transition-colors"
        @click="emit('request-media')"
      >Media</button>

      <div class="ml-auto flex items-center gap-3">
        <span class="text-[11px] font-mono text-muted/50 hidden sm:inline">
          {{ stats.words }} words · {{ stats.minutes }} min
        </span>
        <button
          type="button"
          class="h-8 px-2.5 rounded text-xs transition-colors"
          :class="showPreview ? 'text-accent bg-accent/10' : 'text-muted hover:text-fg hover:bg-fg/5'"
          @click="showPreview = !showPreview"
        >Preview</button>
      </div>
    </div>

    <div class="grid" :class="showPreview ? 'md:grid-cols-2' : 'grid-cols-1'">
      <textarea
        ref="textarea"
        :value="modelValue"
        spellcheck="true"
        placeholder="Write in Markdown…"
        class="min-h-[60vh] resize-y p-4 bg-transparent font-mono text-[13.5px] leading-[1.75] text-text
               outline-none placeholder:text-muted/40 selection:bg-accent/30"
        :class="showPreview && 'md:border-r border-fg/10'"
        @input="emit('update:modelValue', $event.target.value)"
        @keydown="onKeydown"
        @scroll="syncScroll('editor')"
      />
      <div
        v-if="showPreview"
        ref="previewPane"
        class="hidden md:block min-h-[60vh] max-h-[75vh] overflow-y-auto p-5 prose"
        v-html="html"
        @scroll="syncScroll('preview')"
      />
    </div>
  </div>
</template>
