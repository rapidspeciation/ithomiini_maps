<script setup>
import { ref, computed } from 'vue'
import { Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { SHAPE_OPTIONS } from '../../utils/shapes'
import { computePopupPosition } from '../../composables/usePopupPosition'
import AbbreviationDropdown from './AbbreviationDropdown.vue'

const props = defineProps({
  speciesName: {
    type: String,
    required: true
  },
  abbreviation: {
    type: String,
    default: ''
  },
  abbreviationVisible: {
    type: Boolean,
    default: true
  },
  customLabel: {
    type: String,
    default: ''
  },
  borderColor: {
    type: String,
    default: null
  },
  count: {
    type: Number,
    default: 0
  },
  dotSize: {
    type: Number,
    default: 10
  },
  isExportMode: {
    type: Boolean,
    default: false
  },
  headersHidden: {
    type: Boolean,
    default: false
  },
  isLegendHovered: {
    type: Boolean,
    default: false
  },
  shape: {
    type: String,
    default: 'circle'
  },
  anyGroupHasCustomStyle: {
    type: Boolean,
    default: false
  },
  isNonTaxonomy: {
    type: Boolean,
    default: false
  },
  collapsible: {
    type: Boolean,
    default: false
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  speciesColor: {
    type: String,
    default: ''
  }
})

const emit = defineEmits([
  'open-style-popup',
  'show-headers',
  'hide-headers',
  'update:abbreviation',
  'update:abbreviation-visible',
  'update:custom-label',
  'apply-display-format-to-all',
  'apply-prefix-format-to-all',
  'dropdown-open',
  'dropdown-close',
  'toggle-collapse'
])

// Dropdown states
const showDisplayNameDropdown = ref(false)
const showPrefixDropdown = ref(false)
const displayNameDropdownPosition = ref({ x: 0, y: 0 })
const prefixDropdownPosition = ref({ x: 0, y: 0 })

// Format species name for display - use custom label if set, otherwise show full name
const displayName = computed(() => {
  if (props.customLabel) return props.customLabel
  // Default format: full species name
  return props.speciesName
})

// Style for species indicator dot/shape
const indicatorStyle = computed(() => {
  const style = {
    width: props.dotSize + 'px',
    height: props.dotSize + 'px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
  return style
})

// Get shape icon character
const shapeIcon = computed(() => {
  const shape = SHAPE_OPTIONS.find(s => s.value === props.shape)
  return shape ? shape.icon : '●'
})

// Shape color (border color or default)
const shapeColor = computed(() => props.borderColor || 'var(--color-text-muted, #888)')

// Should show clickable indicator (when legend is hovered)
// Allow in export mode too so legend behaves consistently
const showClickableIndicator = computed(() =>
  props.isLegendHovered
)

// Handle indicator click (open style popup)
function handleIndicatorClick(e) {
  e.stopPropagation()
  emit('open-style-popup', e)
}

// Handle show headers click
function handleShowHeaders(e) {
  e.stopPropagation()
  emit('show-headers')
}

// Handle hide headers click
function handleHideHeaders(e) {
  e.stopPropagation()
  emit('hide-headers')
}

// Toggle abbreviation visibility
function toggleAbbrevVisibility(e) {
  e.stopPropagation()
  emit('update:abbreviation-visible', !props.abbreviationVisible)
}

// Open display name dropdown
function openDisplayNameDropdown(e) {
  e.stopPropagation()
  const rect = e.target.getBoundingClientRect()
  const pos = computePopupPosition(rect, {
    placement: 'bottom',
    offset: 4,
    popupWidth: 260,
    popupHeight: 300
  })
  displayNameDropdownPosition.value = {
    x: parseInt(pos.left),
    y: parseInt(pos.top)
  }
  showDisplayNameDropdown.value = true
  emit('dropdown-open')
}

// Close display name dropdown
function closeDisplayNameDropdown() {
  showDisplayNameDropdown.value = false
  emit('dropdown-close')
}

// Handle display name selection
function handleDisplayNameSelect(result) {
  // If it's a predefined format (not custom), apply to ALL group headers
  if (result.format !== 'custom') {
    emit('apply-display-format-to-all', result.format)
  } else {
    // Custom value - only apply to this species
    emit('update:custom-label', result.value)
  }
  closeDisplayNameDropdown()
}

// Handle apply display format to all (explicit button click)
function handleDisplayNameApplyToAll(format) {
  emit('apply-display-format-to-all', format)
  closeDisplayNameDropdown()
}

// Open prefix dropdown
function openPrefixDropdown(e) {
  e.stopPropagation()
  const rect = e.target.getBoundingClientRect()
  const pos = computePopupPosition(rect, {
    placement: 'bottom',
    offset: 4,
    popupWidth: 260,
    popupHeight: 300
  })
  prefixDropdownPosition.value = {
    x: parseInt(pos.left),
    y: parseInt(pos.top)
  }
  showPrefixDropdown.value = true
  emit('dropdown-open')
}

// Close prefix dropdown
function closePrefixDropdown() {
  showPrefixDropdown.value = false
  emit('dropdown-close')
}

// Handle prefix selection
function handlePrefixSelect(result) {
  // If it's a predefined format (not custom), apply to ALL group headers
  if (result.format !== 'custom') {
    emit('apply-prefix-format-to-all', result.format)
  } else {
    // Custom value - only apply to this species
    emit('update:abbreviation', result.value)
  }
  closePrefixDropdown()
}

// Handle apply prefix format to all (explicit button click)
function handlePrefixApplyToAll(format) {
  emit('apply-prefix-format-to-all', format)
  closePrefixDropdown()
}
</script>

<template>
  <div
    class="legend-group-header"
    :class="{
      'is-export': isExportMode,
      'is-hidden': headersHidden,
      'is-collapsed': collapsed,
      'is-hovered': isLegendHovered
    }"
  >
    <button
      v-if="collapsible && !isExportMode"
      type="button"
      class="collapse-button"
      :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${speciesName} ${collapsed ? 'to show subspecies colors' : 'to use one species color'}`"
      :aria-expanded="!collapsed"
      :title="collapsed ? 'Show subspecies colors' : 'Use one species color'"
      @click.stop="emit('toggle-collapse')"
    >
      <ChevronRight v-if="collapsed" :size="13" />
      <ChevronDown v-else :size="13" />
      <span v-if="collapsed" class="collapsed-swatch" :style="{ backgroundColor: speciesColor }" />
    </button>
    <span v-else-if="collapsible && collapsed" class="collapsed-swatch" :style="{ backgroundColor: speciesColor }" aria-hidden="true" />
    <!-- Clickable style indicator (visible on hover so users can customize) -->
    <button
      v-if="showClickableIndicator"
      class="style-indicator-button"
      :style="indicatorStyle"
      @click="handleIndicatorClick"
      title="Click to customize styling for this group"
    >
      <span class="shape-icon" :style="{ color: shapeColor }">{{ shapeIcon }}</span>
    </button>
    <!-- Static indicator (show when ANY group has customized style, so all are visible for comparison) -->
    <span
      v-else-if="anyGroupHasCustomStyle"
      class="species-indicator"
      :style="{
        ...indicatorStyle,
        borderRadius: shape === 'circle' ? '50%' : '2px',
        backgroundColor: 'transparent',
        border: `2px solid ${shapeColor}`
      }"
    />

    <!-- Species name (clickable to open dropdown when hovered) -->
    <span class="species-name-container">
      <span
        class="species-name"
        :class="{
          'is-greyed': headersHidden,
          'is-editable': isLegendHovered,
          'non-taxonomy': isNonTaxonomy
        }"
        @click="isLegendHovered && openDisplayNameDropdown($event)"
        :title="isLegendHovered ? 'Click to change display format' : ''"
      >
        {{ displayName }}
      </span>
    </span>

    <!-- Abbreviation (clickable to open dropdown when hovered, hidden for non-taxonomy) -->
    <span
      v-if="isLegendHovered && !isNonTaxonomy"
      class="abbreviation-container"
      :class="{ 'is-disabled': !abbreviationVisible }"
    >
      <span
        class="abbreviation"
        :class="{ 'is-editable': true }"
        @click="openPrefixDropdown($event)"
        title="Click to change prefix format"
      >
        {{ abbreviation }}
      </span>

      <!-- Eye toggle for abbreviation visibility -->
      <button
        class="abbrev-eye-toggle"
        @click="toggleAbbrevVisibility"
        :title="abbreviationVisible ? 'Hide prefix for subspecies' : 'Show prefix for subspecies'"
      >
        <Eye v-if="abbreviationVisible" :size="10" />
        <EyeOff v-else :size="10" />
      </button>
    </span>

    <!-- Count badge -->
    <span class="subspecies-count">({{ count }})</span>

    <!-- Hide headers button (when headers are visible and legend is hovered) -->
    <button
      v-if="!headersHidden && isLegendHovered"
      class="hide-headers-button"
      @click="handleHideHeaders"
      title="Hide group headers"
    >
      <Eye :size="12" />
    </button>

    <!-- Show headers button (when headers are hidden and legend is hovered) -->
    <button
      v-if="headersHidden && isLegendHovered"
      class="show-headers-button"
      @click="handleShowHeaders"
      title="Show group headers"
    >
      <EyeOff :size="12" />
    </button>

    <!-- Display name dropdown -->
    <AbbreviationDropdown
      v-if="showDisplayNameDropdown"
      :species-name="speciesName"
      :current-value="displayName"
      type="displayName"
      :position="displayNameDropdownPosition"
      @select="handleDisplayNameSelect"
      @apply-to-all="handleDisplayNameApplyToAll"
      @close="closeDisplayNameDropdown"
    />

    <!-- Prefix dropdown -->
    <AbbreviationDropdown
      v-if="showPrefixDropdown"
      :species-name="speciesName"
      :current-value="abbreviation"
      type="prefix"
      :position="prefixDropdownPosition"
      @select="handlePrefixSelect"
      @apply-to-all="handlePrefixApplyToAll"
      @close="closePrefixDropdown"
    />
  </div>
</template>

<style scoped>
.collapse-button { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; min-width: 18px; min-height: 20px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-muted, #888); cursor: pointer; }
.collapse-button:hover { color: var(--color-text-primary, #fff); background: var(--color-bg-tertiary, #333); }
.collapse-button:focus-visible { outline: 2px solid var(--color-primary, #80aaff); outline-offset: 2px; }
.collapsed-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.legend-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
  user-select: none;
}

.legend-group-header:hover {
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.05));
}

/* Hidden headers mode */
.legend-group-header.is-hidden {
  padding: 2px 8px;
}

.legend-group-header.is-hidden:hover {
  background: transparent;
}

/* Only show on hover when hidden */
.legend-group-header.is-hidden:not(.is-hovered) {
  display: none;
}

.legend-group-header.is-hidden.is-collapsed { display: flex; }

.legend-group-header.is-hidden.is-hovered {
  display: flex;
  opacity: 0.6;
}

.species-indicator {
  display: inline-block;
}

/* Clickable style indicator button */
.style-indicator-button {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.style-indicator-button:hover {
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
  transform: scale(1.1);
}

.shape-icon {
  font-size: 14px;
  line-height: 1;
}

/* Abbreviation container */
.abbreviation-container {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.abbreviation-container.is-disabled {
  opacity: 0.4;
}

.abbreviation {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted, #888);
  font-style: italic;
  padding: 1px 3px;
  border-radius: 3px;
  transition: all 0.15s ease;
}

.abbreviation.is-editable {
  cursor: pointer;
}

.abbreviation.is-editable:hover {
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--color-text-secondary, #aaa);
}

.abbrev-eye-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--color-text-muted, #666);
  cursor: pointer;
  border-radius: 3px;
  opacity: 0.7;
  transition: all 0.15s ease;
}

.abbrev-eye-toggle:hover {
  opacity: 1;
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--color-text-secondary, #aaa);
}

/* Species name container */
.species-name-container {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: flex-start;
}

.species-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #fff);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 3px;
  border-radius: 3px;
  transition: all 0.15s ease;
}

.species-name.non-taxonomy {
  font-style: normal;
}

.species-name.is-greyed {
  color: var(--color-text-muted, #888);
  font-weight: 400;
}

.species-name.is-editable {
  cursor: pointer;
}

.species-name.is-editable:hover {
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
}

.subspecies-count {
  font-size: 11px;
  color: var(--color-text-muted, #888);
  flex-shrink: 0;
}

/* Hide/Show headers buttons */
.hide-headers-button,
.show-headers-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.7;
  transition: all 0.15s ease;
}

.hide-headers-button {
  color: var(--color-text-muted, #888);
}

.show-headers-button {
  color: var(--color-warning, #f59e0b);
}

.hide-headers-button:hover,
.show-headers-button:hover {
  opacity: 1;
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
}

/* Export mode - cleaner, more compact */
.legend-group-header.is-export {
  padding: 2px 4px;
}

.legend-group-header.is-export:hover {
  background: transparent;
}

.legend-group-header.is-export .species-name {
  font-size: inherit;
}

.legend-group-header.is-export .subspecies-count {
  display: none;
}
</style>
