<script setup>
import { computed, ref } from 'vue'
import VueMultiselect from 'vue-multiselect'
import { useDataStore } from '@/stores/data'

const store = useDataStore()

const props = defineProps({
  label: String,
  modelValue: [String, Array, Object, null],
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Select...' },
  multiple: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  showCount: { type: Boolean, default: true },
  filterOptions: { type: Function, default: null },
  // Options shaped as [{ [groupLabel]: 'Header', [groupValues]: [...] }].
  groupValues: { type: String, default: undefined },
  groupLabel: { type: String, default: undefined }
})

const flatOptions = computed(() => props.groupValues
  ? props.options.flatMap(group => group[props.groupValues] || [])
  : props.options)

const emit = defineEmits(['update:modelValue'])
const searchText = ref('')

const visibleOptions = computed(() => {
  if (!props.filterOptions) return props.options
  return props.filterOptions(props.options, searchText.value)
})

const displayedCount = computed(() => {
  if (props.filterOptions && searchText.value.trim()) return visibleOptions.value.length
  return new Set(flatOptions.value.map(option => option?.value ?? option)).size
})

const trackByKey = computed(() => (
  flatOptions.value.some(option => typeof option === 'object' && option !== null)
    ? 'value'
    : undefined
))

const updateValue = (val) => {
  emit('update:modelValue', val)
}

const updateSearch = (search) => {
  searchText.value = search || ''
}

const customLabel = (option) => {
  if (typeof option === 'object') {
    return option.label || option.name || option.value
  }
  return option
}

const getOptionColor = (option) => {
  if (typeof option === 'object' && option.color) return option.color
  const label = customLabel(option)
  if (!store.coloredLabels.has(label)) return null
  return store.activeColorMap?.[label] || null
}

const getOptionAccentStyle = (option) => {
  if (typeof option === 'object' && option.colorStyle) return option.colorStyle
  const color = getOptionColor(option)
  return color ? { background: color } : null
}

const getOptionTagStyle = (option) => {
  if (typeof option === 'object' && option.segments?.length) return null
  if (typeof option === 'object' && option.colorStyle) return { ...option.colorStyle, color: '#101827' }
  if (typeof option === 'object' && option.color) return { background: option.color, color: '#101827' }
  return null
}

const confidenceClass = (confidence) => {
  const normalized = String(confidence || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-')
  if (normalized === 'needs-check') return 'low'
  return normalized || 'unknown'
}

const confidenceColor = (confidence) => {
  const normalized = confidenceClass(confidence)
  if (normalized === 'high') return '#22c55e'
  if (normalized === 'medium') return '#eab308'
  if (normalized === 'low') return '#ef4444'
  return 'rgba(16, 24, 39, 0.35)'
}

const segmentStyle = (segment) => ({
  background: segment.color,
  '--confidence-color': confidenceColor(segment.confidence),
})
</script>

<template>
  <div class="filter-wrapper">
    <label v-if="label" class="filter-label">
      {{ label }}
      <span v-if="showCount && flatOptions.length > 0" class="option-count">
        ({{ displayedCount }})
      </span>
    </label>
    <VueMultiselect
      :model-value="modelValue"
      @update:model-value="updateValue"
      @search-change="updateSearch"
      :options="visibleOptions"
      :placeholder="placeholder"
      :multiple="multiple"
      :close-on-select="!multiple"
      :searchable="true"
      :internal-search="!filterOptions"
      :show-labels="false"
      :custom-label="customLabel"
      :track-by="trackByKey"
      :allow-empty="true"
      :disabled="disabled"
      :max-height="300"
      :options-limit="500"
      :group-values="groupValues"
      :group-label="groupLabel"
      :group-select="false"
      class="filter-multiselect"
    >
      <template #tag="{ option, remove }">
        <span
          class="multiselect__tag custom-filter-tag"
          :class="[
            typeof option === 'object' && option.segments?.length ? 'segmented-filter-tag' : '',
            typeof option === 'object' && !option.segments?.length ? confidenceClass(option.confidence) : ''
          ]"
          :style="getOptionTagStyle(option)"
        >
          <span v-if="typeof option === 'object' && option.segments?.length" class="tag-segments" aria-hidden="true">
            <span
              v-for="(segment, index) in option.segments"
              :key="`${segment.butterfly || index}-${segment.confidence}`"
              class="tag-segment"
              :class="confidenceClass(segment.confidence)"
              :style="segmentStyle(segment)"
            />
          </span>
          <span class="tag-label">{{ customLabel(option) }}</span>
          <span v-if="typeof option === 'object' && option.tagBadge" class="tag-count">
            {{ Number(option.tagBadge).toLocaleString() }}
          </span>
          <i
            class="multiselect__tag-icon"
            @mousedown.prevent="remove(option)"
          />
        </span>
      </template>
      <template #option="{ option }">
        <span v-if="option?.$isLabel" class="option-group-label">{{ option.$groupLabel }}</span>
        <span v-else class="option-with-dot">
          <span
            v-if="getOptionAccentStyle(option)"
            class="color-dot"
            :style="getOptionAccentStyle(option)"
          />
          <span class="option-text">
            <span>{{ customLabel(option) }}</span>
            <span v-if="typeof option === 'object' && option.meta" class="option-meta">
              {{ option.meta }}
            </span>
            <span v-if="typeof option === 'object' && option.badges?.length" class="option-badge-row">
              <span
                v-for="badge in option.badges"
                :key="badge.key"
                class="option-badge"
                :class="`option-badge-${badge.key}`"
              >
                {{ badge.label }}
              </span>
            </span>
            <span v-if="typeof option === 'object' && option.matchMeta" class="option-match-meta">
              {{ option.matchMeta }}
            </span>
            <span v-if="typeof option === 'object' && option.synonymMeta" class="option-synonym-meta">
              {{ option.synonymMeta }}
            </span>
          </span>
        </span>
      </template>
      <template #noResult>
        <span class="no-result">No matching results</span>
      </template>
      <template #noOptions>
        <span class="no-options">No options available</span>
      </template>
    </VueMultiselect>
  </div>
</template>

<style>
/* Import vue-multiselect CSS - this needs to be global */
@import 'vue-multiselect/dist/vue-multiselect.css';
</style>

<style scoped>
.filter-wrapper {
  margin-bottom: 12px;
}

.option-group-label {
  font-size: 0.75rem;
  font-style: italic;
  font-weight: 600;
}

.filter-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted, #888);
  margin-bottom: 6px;
}

.option-count {
  color: var(--color-text-muted, #666);
  font-weight: 400;
}

/* Vue-multiselect customization for dark theme */
:deep(.multiselect__tags) {
  min-height: 34px;
  padding: 4px 36px 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border, #3d3d5c);
  background: var(--color-bg-tertiary, #2d2d4a);
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.85rem;
}

:deep(.multiselect__tags:hover) {
  border-color: #4d4d6d;
}

:deep(.multiselect--active .multiselect__tags) {
  border-color: var(--color-accent, #4ade80);
}

:deep(.multiselect__placeholder) {
  color: var(--color-text-muted, #666);
  padding: 0;
  margin: 0;
  font-size: 0.85rem;
}

:deep(.multiselect__single) {
  background: transparent;
  color: var(--color-text-primary, #e0e0e0);
  padding: 0;
  margin: 0;
  font-size: 0.85rem;
}

:deep(.multiselect__input) {
  background: transparent;
  color: var(--color-text-primary, #e0e0e0);
  padding: 0;
  margin: 0;
  font-size: 0.85rem;
}

:deep(.multiselect__input::placeholder) {
  color: var(--color-text-muted, #666);
}

:deep(.multiselect__select) {
  height: 36px;
  padding: 4px 8px;
}

:deep(.multiselect__select:before) {
  border-color: var(--color-text-muted, #666) transparent transparent;
}

/* Dropdown content */
:deep(.multiselect__content-wrapper) {
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  max-height: 280px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

:deep(.multiselect__content) {
  max-height: none;
}

:deep(.multiselect__option) {
  padding: 10px 12px;
  min-height: auto;
  font-size: 0.85rem;
  color: var(--color-text-primary, #e0e0e0);
  background: transparent;
}

:deep(.multiselect__option--highlight) {
  background: var(--color-bg-tertiary, #2d2d4a);
  color: var(--color-text-primary, #e0e0e0);
}

:deep(.multiselect__option--selected) {
  background: rgba(74, 222, 128, 0.15);
  color: var(--color-accent, #4ade80);
  font-weight: 500;
}

:deep(.multiselect__option--selected.multiselect__option--highlight) {
  background: rgba(74, 222, 128, 0.25);
}

/* Species headers in grouped lists are labels, not choices. */
:deep(.multiselect__option--group),
:deep(.multiselect__option--group.multiselect__option--highlight),
:deep(.multiselect__option--group.multiselect__option--disabled) {
  padding: 8px 12px 4px;
  background: transparent !important;
  color: var(--color-text-secondary, #9ca3af) !important;
  cursor: default;
}

/* Multi-select tags */
:deep(.multiselect__tag) {
  background: var(--color-accent, #4ade80);
  color: var(--color-bg-primary, #1a1a2e);
  border-radius: 4px;
  padding: 2px 24px 2px 8px;
  margin-right: 4px;
  margin-bottom: 2px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 18px;
}

:deep(.multiselect__tag-icon) {
  line-height: 18px;
}

:deep(.multiselect__tag-icon:after) {
  color: var(--color-bg-primary, #1a1a2e);
}

:deep(.multiselect__tag-icon:hover) {
  background: rgba(0, 0, 0, 0.2);
}

.option-with-dot {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-meta {
  color: var(--color-text-muted, #666);
  font-size: 0.72rem;
  font-weight: 400;
  line-height: 1.25;
}

.option-match-meta {
  color: var(--color-accent, #4ade80);
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1.25;
}

.option-synonym-meta {
  color: #ef4444;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.25;
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}

.custom-filter-tag {
  background: var(--color-accent, #4ade80);
  color: var(--color-bg-primary, #1a1a2e);
  position: relative;
  overflow: hidden;
  border: 0;
  box-shadow: none;
}

.custom-filter-tag.high::after,
.custom-filter-tag.medium::after,
.custom-filter-tag.low::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 22px;
  bottom: 1px;
  height: 2px;
  border-radius: 999px;
  background: #22c55e;
  z-index: 1;
  pointer-events: none;
}

.custom-filter-tag.medium::after {
  background: #eab308;
}

.custom-filter-tag.low::after {
  background: #ef4444;
}

.segmented-filter-tag {
  background: transparent !important;
  color: #101827;
}

.tag-segments {
  position: absolute;
  inset: 0;
  display: flex;
  z-index: 0;
}

.tag-segment {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  box-sizing: border-box;
}

.tag-segment:first-child {
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}

.tag-segment:last-child {
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
}

.tag-segment::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 1px;
  height: 2px;
  border-radius: 999px;
  background: var(--confidence-color, #22c55e);
}

.tag-label,
.tag-count,
.custom-filter-tag .multiselect__tag-icon {
  position: relative;
  z-index: 1;
}

.tag-label {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.tag-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  margin-left: 5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(16, 24, 39, 0.22);
  color: inherit;
  font-size: 0.65rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.option-badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.option-badge {
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 0.66rem;
  line-height: 1.1;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary, #aaa);
}

.option-badge-high {
  color: #4ade80;
}

.option-badge-medium {
  color: #fbbf24;
}

.option-badge-low {
  color: #fb7185;
}

.no-result,
.no-options {
  display: block;
  padding: 10px 12px;
  color: var(--color-text-muted, #666);
  font-size: 0.85rem;
  font-style: italic;
}

/* Disabled state */
:deep(.multiselect--disabled .multiselect__tags) {
  opacity: 0.5;
  cursor: not-allowed;
}

:deep(.multiselect--disabled .multiselect__select) {
  background: none;
}
</style>
