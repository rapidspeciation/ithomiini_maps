<script setup>
import { computed } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import LegendColorPicker from './LegendColorPicker.vue'
import LegendEditableLabel from './LegendEditableLabel.vue'
import ShapeIcon from './ShapeIcon.vue'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  color: {
    type: String,
    required: true
  },
  defaultColor: {
    type: String,
    default: ''
  },
  customLabel: {
    type: String,
    default: ''
  },
  customColor: {
    type: String,
    default: ''
  },
  visible: {
    type: Boolean,
    default: true
  },
  editable: {
    type: Boolean,
    default: false
  },
  isExportMode: {
    type: Boolean,
    default: false
  },
  dotSize: {
    type: Number,
    default: 10
  },
  fontSize: {
    type: Number,
    default: 14
  },
  borderColor: {
    type: String,
    default: '#ffffff'
  },
  borderWidth: {
    type: Number,
    default: 1.5
  },
  indented: {
    type: Boolean,
    default: false
  },
  shape: {
    type: String,
    default: 'circle',
    validator: (v) => ['circle', 'square', 'triangle', 'rhombus'].includes(v)
  },
  wrapLabel: {
    type: Boolean,
    default: false
  },
  count: {
    type: Number,
    default: null
  }
})

const emit = defineEmits([
  'update:customLabel',
  'update:customColor',
  'toggle-visibility',
  'reset-color',
  'picker-open',
  'picker-close'
])

// The color to display (custom or original)
const displayColor = computed(() => props.customColor || props.color)

// The default color for reset
const originalColor = computed(() => props.defaultColor || props.color)

function handleColorUpdate(newColor) {
  emit('update:customColor', newColor)
}

function handleColorReset() {
  emit('reset-color')
}

function handleLabelUpdate(newLabel) {
  emit('update:customLabel', newLabel)
}

function toggleVisibility() {
  emit('toggle-visibility')
}
</script>

<template>
  <div
    class="legend-item"
    :class="{
      'is-hidden': !visible,
      'is-editable': editable,
      'is-export': isExportMode && !editable,
      'is-indented': indented,
      'is-wrap': wrapLabel
    }"
  >
    <!-- Color dot / picker -->
    <LegendColorPicker
      v-if="editable"
      :color="displayColor"
      :default-color="originalColor"
      :size="dotSize"
      :border-color="borderColor"
      :border-width="borderWidth"
      :shape="shape"
      @update:color="handleColorUpdate"
      @reset="handleColorReset"
      @picker-open="emit('picker-open')"
      @picker-close="emit('picker-close')"
    />
    <!-- Shape indicator (non-editable mode) -->
    <ShapeIcon
      v-else
      class="legend-shape"
      :shape="shape"
      :color="displayColor"
      :size="dotSize"
      :border-color="borderColor"
      :border-width="borderWidth"
    />

    <!-- Label -->
    <LegendEditableLabel
      v-if="editable"
      :label="label"
      :custom-label="customLabel"
      :editable="editable"
      :font-size="fontSize"
      @update:custom-label="handleLabelUpdate"
    />
    <span
      v-else
      class="legend-label"
      :class="{ 'wrap-enabled': wrapLabel }"
      :style="{ fontSize: fontSize + 'px' }"
      :title="label"
    >
      {{ customLabel || label }}
    </span>

    <!-- Count badge -->
    <span
      v-if="count !== null"
      class="legend-count"
      :style="{ fontSize: (fontSize - 2) + 'px' }"
    >{{ count }}</span>

    <!-- Visibility toggle (only in edit mode) -->
    <button
      v-if="editable"
      class="visibility-toggle"
      :title="visible ? 'Hide from map' : 'Show on map'"
      @click.stop="toggleVisibility"
    >
      <Eye v-if="visible" :size="14" />
      <EyeOff v-else :size="14" />
    </button>
  </div>
</template>

<style scoped>
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  transition: opacity 0.2s ease;
}

.legend-item.is-hidden {
  opacity: 0.4;
}

.legend-item.is-editable:hover {
  background: var(--color-bg-tertiary);
  margin: 0 -8px;
  padding: 4px 8px;
  border-radius: 4px;
}

.legend-shape {
  flex-shrink: 0;
}

.legend-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
  font-style: italic;
}

/* Wrap mode: a long name continues on the next line, flush with its first line (a hanging indent read as a
   misaligned epithet in a two-word name). */
.legend-label.wrap-enabled {
  white-space: normal;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
}

/* When wrapping, align dot to top of first line instead of center */
.legend-item.is-wrap {
  align-items: flex-start;
}

.legend-item.is-wrap .legend-shape {
  margin-top: 3px;
}

.legend-count {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.visibility-toggle {
  display: none;
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.legend-item.is-editable:hover .visibility-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
}

.visibility-toggle:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.legend-item.is-hidden .visibility-toggle {
  display: flex;
  color: var(--color-text-muted);
}

/* Export mode - cleaner appearance */
.legend-item.is-export {
  padding: 2px 0;
}

.legend-item.is-export .legend-label {
  font-size: inherit;
}

/* Indented style for grouped items */
.legend-item.is-indented {
  padding-left: 4px;
}

.legend-item.is-indented .legend-label {
  font-size: 12px;
}
</style>
