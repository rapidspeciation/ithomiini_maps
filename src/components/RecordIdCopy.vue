<script setup>
// A record's ID in its outlined box. A real ID is a button that copies it, with "Copied" for a moment after;
// a record without a CAM ID shows "No ID" as plain text (its synthetic key stays in the tooltip).
import { onUnmounted, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { displayRecordId, isSyntheticId, recordIdTitle } from '../utils/recordId'

const props = defineProps({ id: { type: [String, Number], default: null } })

const copied = ref(false)
let timer = null

async function copy() {
  const text = String(props.id)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Older or locked-down browsers: the selection fallback.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    try { document.execCommand('copy') } catch { /* nothing more to try */ }
    area.remove()
  }
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { copied.value = false }, 1500)
}

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <button
    v-if="id !== null && id !== undefined && id !== '' && !isSyntheticId(id)"
    type="button"
    class="record-id-copy"
    :class="{ 'is-copied': copied }"
    :title="copied ? 'Copied' : 'Copy record ID'"
    :aria-label="`Copy record ID ${id}`"
    @click.stop="copy"
  >
    <span class="record-id-text">{{ displayRecordId(id) }}</span>
    <span class="record-id-action" aria-hidden="true">
      <component :is="copied ? Check : Copy" :size="14" />
      <span v-if="copied" class="record-id-copied">Copied</span>
    </span>
    <span class="record-id-live" aria-live="polite">{{ copied ? 'Record ID copied' : '' }}</span>
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

.record-id-copy:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.record-id-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.record-id-action {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--color-accent-text);
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
}

.record-id-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
