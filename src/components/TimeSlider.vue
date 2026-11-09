<script setup>
import { ref, computed, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { parseDate } from '../utils/dateHelpers'

const store = useDataStore()

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Month range computed from temporal distribution (year-based histogram)
const monthRange = computed(() => {
  const dist = store.temporalDistribution
  if (!dist.length) return { min: 0, max: 0, minYear: 2000 }
  const firstYear = dist[0].year
  const lastYear = dist[dist.length - 1].year
  return {
    min: 0,
    max: (lastYear - firstYear) * 12 + 11,
    minYear: firstYear
  }
})

// Convert month offset to { year, month }
const offsetToDate = (offset) => {
  const yr = monthRange.value.minYear + Math.floor(offset / 12)
  const mo = (offset % 12) + 1
  return { year: yr, month: mo }
}

// Convert { year, month } to month offset
const dateToOffset = (year, month) => {
  return (year - monthRange.value.minYear) * 12 + (month - 1)
}

// Format for live feedback: "Jan 2004"
const formatOffset = (offset) => {
  const { year, month } = offsetToDate(offset)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// Drag state (purely visual, no store updates during drag)
const dragMin = ref(monthRange.value.min)
const dragMax = ref(monthRange.value.max)
const isDragging = ref(false)

// Sync from store filters when set externally (e.g., DateFilter or reset)
watch(() => [store.filters.dateStart, store.filters.dateEnd], ([start, end]) => {
  if (isDragging.value) return // Don't override drag position
  const d = start && parseDate(start) // local day: new Date('2022-03-01') is still February in the Americas
  if (d) {
    dragMin.value = dateToOffset(d.getFullYear(), d.getMonth() + 1)
  } else {
    dragMin.value = monthRange.value.min
  }
  const e = end && parseDate(end)
  if (e) {
    dragMax.value = dateToOffset(e.getFullYear(), e.getMonth() + 1)
  } else {
    dragMax.value = monthRange.value.max
  }
}, { immediate: true })

// Update when month range changes (e.g., new data loaded)
watch(monthRange, (range) => {
  if (!store.filters.dateStart) dragMin.value = range.min
  if (!store.filters.dateEnd) dragMax.value = range.max
})

// Get last day of month for end date
const lastDayOfMonth = (year, month) => {
  return new Date(year, month, 0).getDate()
}

// Apply filter to store — only called on release (@change)
const applySliderRange = () => {
  const isFullRange = dragMin.value <= monthRange.value.min && dragMax.value >= monthRange.value.max
  if (isFullRange) {
    store.filters.dateStart = null
    store.filters.dateEnd = null
  } else {
    const startDate = offsetToDate(dragMin.value)
    const endDate = offsetToDate(dragMax.value)
    const pad = (n) => String(n).padStart(2, '0')
    store.filters.dateStart = `${startDate.year}-${pad(startDate.month)}-01`
    const lastDay = lastDayOfMonth(endDate.year, endDate.month)
    store.filters.dateEnd = `${endDate.year}-${pad(endDate.month)}-${pad(lastDay)}`
  }
}

// @input handlers: update drag position only (no filtering)
const onMinInput = (e) => {
  const val = parseInt(e.target.value)
  if (val < dragMax.value) dragMin.value = val
  isDragging.value = true
}

const onMaxInput = (e) => {
  const val = parseInt(e.target.value)
  if (val > dragMin.value) dragMax.value = val
  isDragging.value = true
}

// @change handlers: apply filter on release
const onMinCommit = () => {
  isDragging.value = false
  applySliderRange()
}

const onMaxCommit = () => {
  isDragging.value = false
  applySliderRange()
}

const resetRange = () => {
  dragMin.value = monthRange.value.min
  dragMax.value = monthRange.value.max
  isDragging.value = false
  store.filters.dateStart = null
  store.filters.dateEnd = null
}

// Histogram bars (year-based, colored by drag position)
const maxCount = computed(() => {
  return Math.max(1, ...store.temporalDistribution.map(d => d.count))
})

const histogramBars = computed(() => {
  return store.temporalDistribution.map(d => {
    const yearStartOffset = dateToOffset(d.year, 1)
    const yearEndOffset = dateToOffset(d.year, 12)
    // A year is "in range" if any of its months overlap with drag range
    const inRange = yearEndOffset >= dragMin.value && yearStartOffset <= dragMax.value
    return {
      year: d.year,
      count: d.count,
      height: (d.count / maxCount.value) * 100,
      inRange
    }
  })
})

const isFilterActive = computed(() => {
  return dragMin.value > monthRange.value.min || dragMax.value < monthRange.value.max
})
</script>

<template>
  <div class="time-slider" v-if="histogramBars.length > 0">
    <!-- Histogram visualization -->
    <div class="histogram">
      <div
        v-for="bar in histogramBars"
        :key="bar.year"
        class="histogram-bar"
        :class="{ 'in-range': bar.inRange, 'out-range': !bar.inRange }"
        :style="{ height: bar.height + '%' }"
        :title="`${bar.year}: ${bar.count} records`"
      />
    </div>

    <!-- Live feedback label -->
    <div class="drag-feedback" :class="{ active: isFilterActive }">
      <span>{{ formatOffset(dragMin) }}</span>
      <span class="drag-separator">—</span>
      <span>{{ formatOffset(dragMax) }}</span>
    </div>

    <!-- Dual range slider -->
    <div class="slider-container">
      <input
        type="range"
        class="range-input range-min"
        aria-label="From"
        :min="monthRange.min"
        :max="monthRange.max"
        :value="dragMin"
        @input="onMinInput"
        @change="onMinCommit"
      />
      <input
        type="range"
        class="range-input range-max"
        aria-label="To"
        :min="monthRange.min"
        :max="monthRange.max"
        :value="dragMax"
        @input="onMaxInput"
        @change="onMaxCommit"
      />
    </div>

    <!-- Reset button -->
    <button v-if="isFilterActive" class="btn-reset-range" @click="resetRange">
      Reset to full range
    </button>
  </div>
  <div v-else class="time-slider-empty">
    <p>No date data available for the selected sources.</p>
  </div>
</template>

<style scoped>
.time-slider {
  padding: 12px 14px;
}

.time-slider-empty {
  padding: 12px 14px;
}

.time-slider-empty p {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-style: italic;
  margin: 0;
}

/* Histogram */
.histogram {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 60px;
  margin-bottom: 4px;
  padding: 0 2px;
}

.histogram-bar {
  flex: 1;
  min-width: 2px;
  border-radius: 1px 1px 0 0;
  transition: background-color 0.1s;
}

.histogram-bar.in-range {
  background-color: var(--color-accent);
}

.histogram-bar.out-range {
  background-color: var(--color-text-muted);
  opacity: 0.25;
}

.histogram-bar:hover {
  opacity: 1;
}

.histogram-bar.in-range:hover {
  background-color: var(--color-accent-hover);
}

/* Live feedback label */
.drag-feedback {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  transition: color 0.15s;
}

.drag-feedback.active {
  color: var(--color-accent-text);
}

.drag-separator {
  color: var(--color-text-muted);
}

/* Dual range slider */
.slider-container {
  position: relative;
  height: 24px;
}

.range-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  pointer-events: none;
  outline: none;
}

/* Track styling - only show on the bottom layer */
.range-min {
  z-index: 1;
}

.range-min::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--color-bg-tertiary);
  border-radius: 2px;
}

.range-min::-moz-range-track {
  height: 4px;
  background: var(--color-bg-tertiary);
  border-radius: 2px;
}

.range-max {
  z-index: 2;
}

.range-max::-webkit-slider-runnable-track {
  height: 4px;
  background: transparent;
}

.range-max::-moz-range-track {
  height: 4px;
  background: transparent;
}

/* Thumb styling */
.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  pointer-events: all;
  margin-top: -6px;
  transition: transform 0.15s;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.range-input::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.range-input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  pointer-events: all;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

/* Reset button */
.btn-reset-range {
  width: 100%;
  padding: 6px 12px;
  margin-top: 8px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-reset-range:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border-color: var(--color-text-muted);
}
</style>
