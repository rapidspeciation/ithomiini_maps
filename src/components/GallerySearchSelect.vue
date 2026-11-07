<script setup>
import { computed, nextTick, ref, watch, useId } from 'vue'

const props = defineProps({
  modelValue: [String, Number],
  options: {
    type: Array,
    default: () => [],
  },
  placeholder: {
    type: String,
    default: 'Search...',
  },
  monospace: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const search = ref('')
const isOpen = ref(false)
// Option highlighted with the arrow keys; Enter picks it. The options are not Tab stops.
const activeIndex = ref(-1)
const listId = `gallery-search-${useId()}`
const menuRef = ref(null)

const selectedOption = computed(() =>
  props.options.find(option => String(option.value) === String(props.modelValue))
)

watch(selectedOption, (option) => {
  if (!isOpen.value) search.value = option?.label || ''
}, { immediate: true })

const filteredOptions = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query || query === selectedOption.value?.label?.toLowerCase()) {
    return props.options.slice(0, 80)
  }
  return props.options
    .filter(option => {
      const haystack = [
        option.label,
        option.meta,
        option.searchText,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice(0, 80)
})

watch(search, () => { activeIndex.value = -1 })

function open() {
  isOpen.value = true
  activeIndex.value = -1
  if (!selectedOption.value || search.value === selectedOption.value.label) {
    search.value = ''
  }
}

function closeSoon() {
  window.setTimeout(() => {
    isOpen.value = false
    search.value = selectedOption.value?.label || ''
  }, 120)
}

function selectOption(option) {
  emit('update:modelValue', option?.value || null)
  search.value = option?.label || ''
  isOpen.value = false
}

function onKeydown(event) {
  const n = filteredOptions.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!isOpen.value) { open(); return }
    if (!n) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = activeIndex.value < 0 ? (step > 0 ? 0 : n - 1) : (activeIndex.value + step + n) % n
    nextTick(() => menuRef.value?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }))
  } else if (event.key === 'Enter') {
    if (!isOpen.value || !n) return
    event.preventDefault()
    selectOption(filteredOptions.value[Math.max(0, activeIndex.value)])
  } else if (event.key === 'Escape') {
    if (!isOpen.value) return
    // Closes the list only; a second Escape reaches the gallery.
    event.preventDefault()
    event.stopPropagation()
    isOpen.value = false
  }
}
</script>

<template>
  <div class="gallery-search-select" :class="{ open: isOpen, monospace }">
    <input
      :value="search"
      :placeholder="selectedOption?.label || placeholder"
      class="gallery-search-input"
      :aria-label="placeholder"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="isOpen"
      :aria-controls="listId"
      :aria-activedescendant="isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined"
      @focus="open"
      @input="search = $event.target.value; isOpen = true"
      @blur="closeSoon"
      @keydown="onKeydown"
    />
    <svg class="select-caret" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m7 10 5 5 5-5z"/>
    </svg>
    <div v-if="isOpen" :id="listId" ref="menuRef" class="gallery-search-menu" role="listbox" tabindex="-1">
      <button
        v-for="(option, index) in filteredOptions"
        :id="`${listId}-${index}`"
        :key="option.value"
        type="button"
        role="option"
        tabindex="-1"
        :aria-selected="String(option.value) === String(modelValue)"
        :data-active="index === activeIndex"
        class="gallery-search-option"
        :class="{ selected: String(option.value) === String(modelValue), active: index === activeIndex }"
        @mousedown.prevent="selectOption(option)"
      >
        <span class="option-label">{{ option.label }}</span>
        <span v-if="option.meta" class="option-meta">{{ option.meta }}</span>
      </button>
      <div v-if="filteredOptions.length === 0" class="gallery-search-empty">
        No matching results
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-search-select {
  position: relative;
}

.gallery-search-input {
  width: 100%;
  padding: 8px 28px 8px 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-style: italic;
  cursor: text;
  transition: all 0.2s;
}

.monospace .gallery-search-input {
  font-family: monospace;
  font-style: normal;
}

.gallery-search-input:hover {
  border-color: var(--color-border-control);
}

.gallery-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgb(var(--color-accent-rgb) / 0.15);
}

.select-caret {
  position: absolute;
  right: 8px;
  top: 50%;
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
  pointer-events: none;
  transform: translateY(-50%);
}

.gallery-search-menu {
  position: absolute;
  z-index: 50;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
}

.gallery-search-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}

.gallery-search-option:hover,
.gallery-search-option.selected,
.gallery-search-option.active {
  background: rgb(var(--color-accent-rgb) / 0.12);
}

/* The option Enter will pick (arrow keys): fill plus an accent edge. */
.gallery-search-option.active {
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.option-label {
  font-size: 0.8rem;
}

.option-meta {
  color: var(--color-text-muted);
  font-size: 0.68rem;
}

.gallery-search-empty {
  padding: 10px;
  color: var(--color-text-muted);
  font-size: 0.76rem;
  font-style: italic;
}
</style>
