<script setup>
import { ref, computed } from 'vue'
import { onClickOutside } from '@vueuse/core'
import {
  Settings,
  RotateCcw,
  Lock,
  Unlock,
  GripVertical,
  Palette,
  Layers,
  Type,
  MapPin,
  WrapText,
  ListOrdered,
  ArrowLeftRight
} from 'lucide-vue-next'
import { useLegendStore } from '../../stores/legend'
import { useDataStore } from '../../stores/data'
import { computePopupPosition } from '../../composables/usePopupPosition'
import LegendDropdown from './LegendDropdown.vue'
import LegendColorPicker from './LegendColorPicker.vue'

const emit = defineEmits(['settings-open', 'settings-close', 'dropdown-open', 'dropdown-close'])

const legendStore = useLegendStore()
const dataStore = useDataStore()

// Dropdown refs
const colorDropdownRef = ref(null)
const groupDropdownRef = ref(null)

// Settings panel visibility
const showSettings = ref(false)
const settingsButtonRef = ref(null)
const settingsPanelRef = ref(null)
const settingsPanelStyle = ref({})

// Color by options with section groups
const colorByGroups = [
  {
    label: 'Taxonomy',
    options: [
      { value: 'subspecies', label: 'Subspecies' },
      { value: 'species', label: 'Species' },
      { value: 'genus', label: 'Genus' }
    ]
  },
  {
    label: 'Other',
    options: [
      { value: 'status', label: 'Sequencing Status' },
      { value: 'mimicry', label: 'Mimicry Ring' },
      { value: 'source', label: 'Data Source' }
    ]
  }
]

// Group by options structured with optgroups for consistent header style
const groupByGroups = computed(() => {
  const raw = legendStore.groupByOptions
  const groups = []
  let currentGroup = null

  for (const opt of raw) {
    if (opt.disabled) {
      // Header item - start a new optgroup
      // Extract clean label from "── Taxonomy ──" -> "Taxonomy"
      const label = opt.label.replace(/[─\s]/g, '').trim() || opt.label
      currentGroup = { label, options: [] }
      groups.push(currentGroup)
    } else if (currentGroup) {
      currentGroup.options.push(opt)
    } else {
      // "None" option before any header - put in a standalone group
      if (!groups.length || groups[0].label !== '') {
        groups.unshift({ label: '', options: [] })
      }
      groups[0].options.push(opt)
    }
  }

  return groups
})

// Current colorBy
const colorBy = computed({
  get: () => dataStore.colorBy,
  set: (value) => { dataStore.setColorBy(value) }
})

// Current groupBy
const groupBy = computed({
  get: () => legendStore.effectiveGroupBy,
  set: (value) => {
    legendStore.setGroupBy(value)
    // If setting to 'none', disable grouping; otherwise enable it
    if (value === 'none') {
      legendStore.setGroupingEnabled(false)
    } else {
      legendStore.setGroupingEnabled(true)
    }
  }
})

// Whether to show the group by dropdown (only for taxonomy-based colorBy)
const showGroupBy = computed(() => {
  return legendStore.groupByOptions.length > 1
})

// Valid colorBy values (derived from colorByGroups to stay in sync)
const validColorByValues = new Set(colorByGroups.flatMap(g => g.options.map(o => o.value)))
const taxonomyColorBy = new Set(['subspecies', 'species', 'genus'])

// Whether color↔group swap is valid
const canSwapColorGroup = computed(() => {
  const currentGroup = groupBy.value
  if (currentGroup === 'none') return false
  // groupBy value must be a valid colorBy option (tribe/subfamily/family are not)
  if (!validColorByValues.has(currentGroup)) return false
  // If both are taxonomy, swap is invalid (would reverse the hierarchy)
  if (taxonomyColorBy.has(colorBy.value) && taxonomyColorBy.has(currentGroup)) return false
  return true
})

// Swap color and group values
function swapColorAndGroup() {
  if (!canSwapColorGroup.value) return
  const newColor = groupBy.value
  const newGroup = colorBy.value
  dataStore.setColorBy(newColor)
  legendStore.setGroupBy(newGroup)
}

// Show species prefix setting when coloring by subspecies
const showSpeciesPrefixSetting = computed(() => dataStore.colorBy === 'subspecies')

// Prefix format options (shortest to longest)
const prefixFormatOptions = [
  { value: 'none', label: 'Hidden' },
  { value: 'firstLetterBoth', label: 'G. e.' },
  { value: 'syllableBoth', label: 'Gen. epi.' },
  { value: 'firstLetterGenus', label: 'G. epithet' },
  { value: 'syllableGenus', label: 'Gen. epithet' },
  { value: 'fullSpecies', label: 'Full name' }
]

// Toggle settings
function toggleSettings() {
  if (!showSettings.value && settingsButtonRef.value) {
    const rect = settingsButtonRef.value.getBoundingClientRect()
    settingsPanelStyle.value = computePopupPosition(rect, {
      placement: 'bottom',
      popupWidth: 300,
      popupHeight: 500
    })
    showSettings.value = true
    emit('settings-open')
  } else {
    showSettings.value = false
    emit('settings-close')
  }
}

// Close settings panel
function closeSettings() {
  if (showSettings.value) {
    showSettings.value = false
    emit('settings-close')
  }
}

// Handle reset - resets all legend customizations
function handleReset() {
  legendStore.resetCustomizations()
}

// Toggle sticky edges
function toggleSticky() {
  legendStore.setStickyEdges(!legendStore.stickyEdges)
}

// Update text scale
function updateTextScale(e) {
  legendStore.setTextScale(parseFloat(e.target.value))
}

// Update map point size
function updateMapPointSize(e) {
  dataStore.mapStyle.pointSize = parseInt(e.target.value)
}

// Update map border width
function updateMapBorderWidth(e) {
  dataStore.mapStyle.borderWidth = parseFloat(e.target.value)
}

// Update map fill opacity
function updateMapFillOpacity(e) {
  dataStore.mapStyle.fillOpacity = parseFloat(e.target.value)
}

// Update manual max-items count
function handleManualCountInput(e) {
  const val = parseInt(e.target.value)
  if (!isNaN(val) && val >= 1) legendStore.setMaxItemsManual(val)
}

onClickOutside(settingsPanelRef, (e) => {
  if (!showSettings.value) return
  if (settingsButtonRef.value?.contains(e.target)) return
  closeSettings()
}, { event: 'mousedown' })
</script>

<template>
  <div
    class="legend-toolbar"
  >
    <!-- Drag handle -->
    <div class="drag-handle" title="Drag to move legend">
      <GripVertical :size="16" />
    </div>

    <!-- Color by dropdown -->
    <div class="toolbar-item dropdown-with-label" @click.stop="colorDropdownRef?.open()">
      <span class="dropdown-label"><Palette :size="11" /> Color</span>
      <LegendDropdown
        ref="colorDropdownRef"
        v-model="colorBy"
        :groups="colorByGroups"
        @open="emit('dropdown-open')"
        @close="emit('dropdown-close')"
      />
    </div>

    <!-- Swap color/group button -->
    <button
      v-if="showGroupBy"
      class="swap-button"
      :class="{ disabled: !canSwapColorGroup }"
      :disabled="!canSwapColorGroup"
      title="Swap Color and Group"
      @click.stop="swapColorAndGroup"
    >
      <ArrowLeftRight :size="12" />
    </button>

    <!-- Group by dropdown -->
    <div v-if="showGroupBy" class="toolbar-item dropdown-with-label" @click.stop="groupDropdownRef?.open()">
      <span class="dropdown-label"><Layers :size="11" /> Group</span>
      <LegendDropdown
        ref="groupDropdownRef"
        v-model="groupBy"
        :groups="groupByGroups"
        @open="emit('dropdown-open')"
        @close="emit('dropdown-close')"
      />
    </div>

    <!-- Sticky toggle -->
    <button
      class="toolbar-button"
      :class="{ active: legendStore.stickyEdges }"
      :title="legendStore.stickyEdges ? 'Sticky edges ON (click to disable)' : 'Sticky edges OFF (click to enable)'"
      @click="toggleSticky"
    >
      <Lock v-if="legendStore.stickyEdges" :size="14" />
      <Unlock v-else :size="14" />
    </button>

    <!-- Settings toggle -->
    <button
      ref="settingsButtonRef"
      class="toolbar-button"
      :class="{ active: showSettings }"
      title="Legend settings"
      @click="toggleSettings"
    >
      <Settings :size="14" />
    </button>

    <!-- Reset button (only show if customizations exist) -->
    <button
      v-if="legendStore.hasCustomizations"
      class="toolbar-button reset-button"
      title="Reset all customizations"
      @click="handleReset"
    >
      <RotateCcw :size="14" />
    </button>

    <!-- Settings panel (popup window that can overflow legend) -->
    <Teleport to="body">
      <Transition name="settings-slide">
        <div v-if="showSettings" ref="settingsPanelRef" class="settings-panel" :style="settingsPanelStyle" @click.stop>
        <div class="settings-header">
          <span>LEGEND SETTINGS</span>
          <button class="close-button" @click="closeSettings">
            &times;
          </button>
        </div>

        <!-- Legend Text size -->
        <div class="settings-row">
          <label class="settings-label">
            <Type :size="14" />
            Text Size
          </label>
          <div class="settings-control">
            <input
              type="range"
              min="0.6"
              max="1.5"
              step="0.1"
              :value="legendStore.textScale"
              @input="updateTextScale"
            />
            <span class="value-display">{{ (legendStore.textScale * 100).toFixed(0) }}%</span>
          </div>
        </div>

        <!-- Divider -->
        <div class="settings-divider"></div>

        <!-- Display Section -->
        <div class="settings-section-header">
          <Type :size="14" />
          <span>DISPLAY</span>
        </div>

        <!-- Text Wrap -->
        <div class="settings-row">
          <label class="settings-label">
            <WrapText :size="14" />
            Wrap Long Labels
          </label>
          <div class="settings-control">
            <button
              class="wrap-toggle-button"
              :class="{ active: legendStore.wrapLabels }"
              @click="legendStore.toggleWrapLabels()"
            >
              {{ legendStore.wrapLabels ? 'ON' : 'OFF' }}
            </button>
            <span class="value-display">{{ legendStore.wrapLabels ? 'Outdent' : 'Ellipsis' }}</span>
          </div>
        </div>

        <!-- Show Counts -->
        <div class="settings-row">
          <label class="settings-label">
            Show Counts
          </label>
          <div class="settings-control">
            <button
              class="wrap-toggle-button"
              :class="{ active: legendStore.showCounts }"
              @click="legendStore.toggleShowCounts()"
            >
              {{ legendStore.showCounts ? 'ON' : 'OFF' }}
            </button>
            <span class="value-display">per item</span>
          </div>
        </div>

        <!-- Species Prefix (when coloring by subspecies) -->
        <div v-if="showSpeciesPrefixSetting" class="settings-row">
          <label class="settings-label">
            <Palette :size="14" />
            Species Prefix
          </label>
          <div class="settings-control">
            <select
              class="prefix-format-select"
              :value="legendStore.prefixFormat"
              @change="legendStore.setPrefixFormat($event.target.value)"
            >
              <option
                v-for="opt in prefixFormatOptions"
                :key="opt.value"
                :value="opt.value"
              >{{ opt.label }}</option>
            </select>
          </div>
        </div>

        <!-- Max Legend Items -->
        <div class="settings-row">
          <label class="settings-label"><ListOrdered :size="14" /> Max Items</label>
          <div class="settings-control">
            <button
              class="wrap-toggle-button"
              :class="{ active: legendStore.isManualMode }"
              @click="legendStore.toggleMaxItemsMode()"
            >
              {{ legendStore.isManualMode ? 'MANUAL' : 'AUTO' }}
            </button>
            <span class="value-display">{{ legendStore.isManualMode ? '' : 'fit to size' }}</span>
          </div>
        </div>
        <div v-if="legendStore.isManualMode" class="settings-row manual-count-row">
          <div class="settings-control">
            <input
              type="number"
              class="manual-count-input"
              :value="legendStore.maxItemsManual"
              min="1"
              max="500"
              @input="handleManualCountInput"
              @keydown.enter="$event.target.blur()"
            />
            <span class="value-display">items</span>
          </div>
        </div>

        <!-- Divider -->
        <div class="settings-divider"></div>

        <!-- Map Point Style Section -->
        <div class="settings-section-header">
          <MapPin :size="14" />
          <span>MAP POINTS</span>
        </div>

        <!-- Map Point Size -->
        <div class="settings-row">
          <label class="settings-label">
            Point Size
          </label>
          <div class="settings-control">
            <input
              type="range"
              min="4"
              max="20"
              step="1"
              :value="dataStore.mapStyle.pointSize"
              @input="updateMapPointSize"
            />
            <span class="value-display">{{ dataStore.mapStyle.pointSize }}</span>
          </div>
        </div>

        <!-- Map Border Width -->
        <div class="settings-row">
          <label class="settings-label">
            Border Width
          </label>
          <div class="settings-control">
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              :value="dataStore.mapStyle.borderWidth"
              @input="updateMapBorderWidth"
            />
            <span class="value-display">{{ dataStore.mapStyle.borderWidth.toFixed(1) }}</span>
          </div>
        </div>

        <!-- Map Fill Opacity -->
        <div class="settings-row">
          <label class="settings-label">
            Fill Opacity
          </label>
          <div class="settings-control">
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              :value="dataStore.mapStyle.fillOpacity"
              @input="updateMapFillOpacity"
            />
            <span class="value-display">{{ Math.round(dataStore.mapStyle.fillOpacity * 100) }}%</span>
          </div>
        </div>

        <!-- Map Border Color -->
        <div class="settings-row">
          <label class="settings-label">
            Border Color
          </label>
          <div class="settings-control color-control">
            <LegendColorPicker
              trigger-type="swatch"
              :color="dataStore.mapStyle.borderColor"
              :default-color="'#ffffff'"
              :show-reset="false"
              @update:color="dataStore.mapStyle.borderColor = $event"
            />
            <input
              type="text"
              class="color-input"
              v-model="dataStore.mapStyle.borderColor"
              @keydown.enter="$event.target.blur()"
            />
          </div>
        </div>

        <!-- Quick reset -->
        <div class="settings-actions">
          <button
            class="action-button"
            @click="handleReset"
          >
            <RotateCcw :size="14" />
            Reset All
          </button>
        </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.legend-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--color-border, #3d3d5c);
  background: var(--color-bg-overlay, rgba(26, 26, 46, 0.95));
  border-radius: 8px; /* Fully rounded — separate floating element */
  position: absolute;
  bottom: calc(100% + 2px); /* Float above legend with small gap so green border is visible */
  left: -1px; /* Align with legend border */
  /* Let toolbar expand wider than legend so all buttons are reachable */
  right: auto;
  min-width: calc(100% + 2px);
  width: max-content;
  cursor: grab;
  box-shadow: 0 -2px 10px var(--color-shadow-color, rgba(0, 0, 0, 0.3));
  backdrop-filter: blur(4px);
}

.legend-toolbar:active {
  cursor: grabbing;
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--color-text-muted, #666);
  cursor: grab;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.drag-handle:hover {
  background: var(--color-bg-tertiary, rgba(255,255,255,0.05));
  color: var(--color-text-secondary, #aaa);
}

.drag-handle:active {
  cursor: grabbing;
}

.toolbar-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dropdown-with-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 6px;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  cursor: pointer;
}

.dropdown-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--color-text-muted, #666);
  white-space: nowrap;
  line-height: 1;
}

.swap-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  background: transparent;
  border: none;
  color: var(--color-text-muted, #666);
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.swap-button:hover:not(.disabled) {
  background: var(--color-bg-tertiary, rgba(255,255,255,0.05));
  color: var(--color-accent, #4ade80);
}

.swap-button.disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.toolbar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-muted, #666);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.toolbar-button:hover {
  background: var(--color-bg-tertiary, rgba(255,255,255,0.05));
  color: var(--color-text-primary, #e0e0e0);
}

.toolbar-button.active {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.1));
  color: var(--color-accent, #4ade80);
}

.reset-button:hover {
  color: var(--color-warning, #f59e0b);
}

/* Settings Panel - Now a floating popup that can overflow */
.settings-panel {
  position: fixed;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 8px;
  padding: 12px;
  z-index: 1000;
  box-shadow: 0 4px 20px var(--color-shadow-color, rgba(0, 0, 0, 0.4));
  min-width: 280px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 20px);
  overflow-y: auto;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border, #3d3d5c);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.close-button {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #666);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.close-button:hover {
  color: var(--color-text-primary, #e0e0e0);
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.settings-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, #aaa);
}

.settings-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-control input[type="range"] {
  flex: 1;
  height: 4px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border-radius: 2px;
  appearance: none;
  cursor: pointer;
}

.settings-control input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  background: var(--color-accent, #4ade80);
  border-radius: 50%;
  cursor: pointer;
}

.value-display {
  min-width: 40px;
  text-align: right;
  font-size: 12px;
  color: var(--color-text-muted, #666);
  font-family: var(--font-family-mono, monospace);
}

.settings-actions {
  padding-top: 8px;
  border-top: 1px solid var(--color-border, #3d3d5c);
}

.action-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-secondary, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-button:hover {
  background: var(--color-bg-tertiary, rgba(255,255,255,0.05));
  border-color: var(--color-warning, #f59e0b);
  color: var(--color-warning, #f59e0b);
}

/* Settings divider */
.settings-divider {
  height: 1px;
  background: var(--color-border, #3d3d5c);
  margin: 12px 0;
}

/* Settings section header */
.settings-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #666);
  margin-bottom: 12px;
}

/* Color control */
.color-control {
  gap: 8px;
}

.prefix-format-select {
  flex: 1;
  padding: 6px 8px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 12px;
  cursor: pointer;
  appearance: auto;
}

.prefix-format-select:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
}

.color-input {
  flex: 1;
  padding: 6px 8px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-family: monospace;
  font-size: 12px;
  text-transform: uppercase;
}

.color-input:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
}

/* Scrollbar for settings panel */
.settings-panel::-webkit-scrollbar {
  width: 6px;
}

.settings-panel::-webkit-scrollbar-track {
  background: transparent;
}

.settings-panel::-webkit-scrollbar-thumb {
  background: var(--color-border, #3d3d5c);
  border-radius: 3px;
}

/* Wrap toggle button */
.wrap-toggle-button {
  padding: 6px 12px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-muted, #666);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wrap-toggle-button:hover {
  border-color: var(--color-text-secondary, #aaa);
  color: var(--color-text-secondary, #aaa);
}

.wrap-toggle-button.active {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
  border-color: var(--color-accent, #4ade80);
  color: var(--color-accent, #4ade80);
}

/* Manual count input (Max Items) */
.manual-count-row {
  margin-top: -4px;
  padding-left: 20px;
}

.manual-count-input {
  width: 70px;
  padding: 6px 8px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 12px;
  text-align: center;
  -moz-appearance: textfield;
}

.manual-count-input::-webkit-inner-spin-button,
.manual-count-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.manual-count-input:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
}

/* Transitions */
.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: all 0.2s ease;
}

.settings-slide-enter-from,
.settings-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
