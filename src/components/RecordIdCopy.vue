<script setup>
// A record's ID in its outlined box. A real ID is a button that copies it; a record without a CAM ID shows "No ID" as
// plain text (its synthetic key stays in the tooltip).
// Feedback never changes the box's size: a check icon when a copy method reported success, and when both failed the
// ID turns into selected text (a read-only field) with a warning icon, so it can be copied by hand. The words go to
// the tooltip and a polite live region.
import { nextTick, onUnmounted, ref } from 'vue'
import { AlertCircle, Check, Copy } from 'lucide-vue-next'
import { displayRecordId, isSyntheticId, recordIdTitle } from '../utils/recordId'

const props = defineProps({ id: { type: [String, Number], default: null } })

const state = ref('idle') // idle | copied | failed
const field = ref(null)
let timer = null

/** Copies with the Clipboard API, else the selection fallback; true only when one of them reports success. */
async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the selection fallback */ }
  // http pages (no secure context) have no Clipboard API.
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try { ok = document.execCommand('copy') === true } catch { ok = false }
  area.remove()
  return ok
}

async function copy() {
  clearTimeout(timer)
  if (await writeClipboard(String(props.id))) {
    state.value = 'copied'
    timer = setTimeout(() => { state.value = 'idle' }, 1500)
    return
  }
  state.value = 'failed'
  await nextTick()
  field.value?.focus()
  field.value?.select()
}

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div
    v-if="state === 'failed'"
    class="record-id-copy is-failed"
    title="Copy failed: the ID is selected, copy it with Ctrl+C or the menu"
  >
    <input
      ref="field"
      class="record-id-field"
      :value="String(id)"
      readonly
      aria-label="Record ID, selected to copy"
      @blur="state = 'idle'"
    />
    <span class="record-id-action" aria-hidden="true"><AlertCircle :size="14" /></span>
    <span class="record-id-live" aria-live="polite">Copy failed. The ID is selected; copy it with Ctrl+C.</span>
  </div>
  <button
    v-else-if="id !== null && id !== undefined && id !== '' && !isSyntheticId(id)"
    type="button"
    class="record-id-copy"
    :class="{ 'is-copied': state === 'copied' }"
    :title="state === 'copied' ? 'Copied' : 'Copy record ID'"
    :aria-label="`Copy record ID ${id}`"
    @click.stop="copy"
  >
    <span class="record-id-text">{{ displayRecordId(id) }}</span>
    <span class="record-id-action" aria-hidden="true">
      <component :is="state === 'copied' ? Check : Copy" :size="14" />
    </span>
    <span class="record-id-live" aria-live="polite">{{ state === 'copied' ? 'Record ID copied' : '' }}</span>
  </button>
  <div v-else class="record-id-plain" :title="recordIdTitle(id)">{{ displayRecordId(id) }}</div>
</template>

<style scoped>
.record-id-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s, background-color 0.15s;
}

.record-id-copy:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-hover);
}

.record-id-copy:focus-visible,
.record-id-copy.is-failed:focus-within {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.record-id-copy.is-failed {
  cursor: text;
  border-color: var(--color-warning-text);
}

/* The ID stays on one line: it is what people copy. */
.record-id-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.record-id-field {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}

.record-id-action {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--color-accent-text);
}

.is-failed .record-id-action {
  color: var(--color-warning-text);
}

.record-id-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
