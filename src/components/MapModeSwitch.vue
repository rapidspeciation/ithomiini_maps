<script setup>
// Points / Clusters / Heatmap / Ranges on the map itself (the store's `visualizationMode`, which is also what shared
// links and remembered settings carry). The options of the current mode stay in the sidebar (SidebarMapSettings.vue).
// A radio group: one Tab stop, arrow keys, Home and End move the choice, as in a native radio group.
import { nextTick, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { MAP_MODES } from '../utils/mapModes'

defineProps({
  // Phones: icon over a short label, each segment at least 44 px square.
  stacked: { type: Boolean, default: false },
})

const store = useDataStore()
const buttons = ref([])

const isCurrent = value => store.visualizationMode === value
// The current mode is the Tab stop; if none matches (it should not happen), the first one is.
const tabStop = (value, index) => (MAP_MODES.some(m => isCurrent(m.value)) ? isCurrent(value) : index === 0) ? 0 : -1

function choose(value) {
  if (store.visualizationMode !== value) store.visualizationMode = value
}

function onKeydown(event, index) {
  const last = MAP_MODES.length - 1
  const next = {
    ArrowRight: index === last ? 0 : index + 1,
    ArrowDown: index === last ? 0 : index + 1,
    ArrowLeft: index === 0 ? last : index - 1,
    ArrowUp: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  }[event.key]
  if (next === undefined) return
  event.preventDefault()
  choose(MAP_MODES[next].value)
  nextTick(() => buttons.value[next]?.focus())
}
</script>

<template>
  <div class="map-mode-switch" :class="{ 'is-stacked': stacked }" role="radiogroup" aria-label="Map mode">
    <button
      v-for="(mode, index) in MAP_MODES"
      :key="mode.value"
      :ref="el => { buttons[index] = el }"
      type="button"
      role="radio"
      class="map-mode-btn"
      :class="{ active: isCurrent(mode.value) }"
      :aria-checked="isCurrent(mode.value)"
      :tabindex="tabStop(mode.value, index)"
      :title="mode.title"
      :data-map-mode="mode.value"
      @click="choose(mode.value)"
      @keydown="onKeydown($event, index)"
    >
      <svg class="map-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <template v-if="mode.value === 'points'">
          <circle cx="6" cy="7" r="2"/><circle cx="17" cy="5.5" r="2"/><circle cx="12" cy="13" r="2"/>
          <circle cx="5.5" cy="18.5" r="2"/><circle cx="18" cy="17.5" r="2"/>
        </template>
        <template v-else-if="mode.value === 'clusters'">
          <circle cx="9" cy="9" r="6.5"/><circle cx="9" cy="9" r="2.5"/><circle cx="18.5" cy="18.5" r="3.5"/>
        </template>
        <template v-else-if="mode.value === 'heatmap'">
          <circle cx="12" cy="12" r="9.5" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="5.5"/>
          <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
        </template>
        <template v-else>
          <path d="M12 2.5 20.5 7.25v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="M12 8.5 15.5 10.5v3.5L12 16l-3.5-2v-3.5z"/>
        </template>
      </svg>
      <span class="map-mode-label">{{ mode.label }}</span>
    </button>
  </div>
</template>

<style scoped>
/* One box with hairline dividers, like the basemap and palette buttons beside it; the chosen mode is filled with the
   brand accent, as the sidebar's Map/Table toggle and the phone pills are. */
.map-mode-switch {
  display: inline-flex;
  align-items: stretch;
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 2px 10px var(--color-shadow-color);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.map-mode-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 11px;
  background: transparent;
  border: none;
  border-left: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.map-mode-btn:first-child {
  border-left: none;
  border-radius: 7px 0 0 7px;
}

.map-mode-btn:last-child {
  border-radius: 0 7px 7px 0;
}

.map-mode-btn:hover:not(.active) {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

.map-mode-btn:active:not(.active) {
  background: var(--color-bg-hover);
}

.map-mode-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-accent-text);
}

.map-mode-btn.active {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.map-mode-btn.active .map-mode-icon {
  color: var(--color-on-accent);
}

/* The divider beside a filled segment would draw a grey line through the accent. */
.map-mode-btn.active + .map-mode-btn {
  border-left-color: var(--color-accent);
}

.map-mode-btn:focus-visible {
  z-index: 1;
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Phones: icon over the label, as on the pill row above. */
.map-mode-switch.is-stacked .map-mode-btn {
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 52px;
  min-height: 44px;
  padding: 4px 3px;
  font-size: 0.66rem;
  font-weight: 600;
}

.map-mode-switch.is-stacked .map-mode-icon {
  width: 15px;
  height: 15px;
}

@media (pointer: coarse) {
  .map-mode-btn {
    min-height: 44px;
    min-width: 44px;
    justify-content: center;
  }
}
</style>
