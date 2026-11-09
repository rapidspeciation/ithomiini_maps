<script setup>
import { ref, computed, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { parseDate, getDateOffset, toLocalISODate } from '../utils/dateHelpers'
import { Calendar, Filter, Info } from 'lucide-vue-next'

const store = useDataStore()

// Date range
const startDate = ref('')
const endDate = ref('')

// Quick ranges
const quickRanges = [
  { label: 'All Time', start: '', end: '' },
  { label: 'Last Year', start: getDateOffset(-365), end: '' },
  { label: 'Last 5 Years', start: getDateOffset(-365 * 5), end: '' },
  { label: 'Last 10 Years', start: getDateOffset(-365 * 10), end: '' },
  { label: '2020s', start: '2020-01-01', end: '2029-12-31' },
  { label: '2010s', start: '2010-01-01', end: '2019-12-31' },
  { label: '2000s', start: '2000-01-01', end: '2009-12-31' },
  { label: 'Pre-2000', start: '', end: '1999-12-31' },
]

// Get date statistics from data
const dateStats = computed(() => {
  const features = store.allFeatures || []
  let earliest = null
  let latest = null
  let withDates = 0
  let withoutDates = 0

  features.forEach(f => {
    // Access flat object properties directly (not via f.properties)
    const dateStr = f.observation_date || f.date || f.preservation_date
    const d = parseDate(dateStr)
    if (d) {
      withDates++
      if (!earliest || d < earliest) earliest = d
      if (!latest || d > latest) latest = d
    } else {
      withoutDates++
    }
  })

  return {
    earliest: earliest ? toLocalISODate(earliest) : null,
    latest: latest ? toLocalISODate(latest) : null,
    withDates,
    withoutDates,
    total: features.length
  }
})

// Apply quick range
const applyQuickRange = (range) => {
  startDate.value = range.start
  endDate.value = range.end
  applyFilter()
}

// Apply filter to store
const applyFilter = () => {
  store.filters.dateStart = startDate.value || null
  store.filters.dateEnd = endDate.value || null
}

// Clear filter
const clearFilter = () => {
  startDate.value = ''
  endDate.value = ''
  store.filters.dateStart = null
  store.filters.dateEnd = null
}

// Check if filter is active
const isFilterActive = computed(() => {
  return !!store.filters.dateStart || !!store.filters.dateEnd
})

// Watch for external changes
watch(() => [store.filters.dateStart, store.filters.dateEnd], ([start, end]) => {
  startDate.value = start || ''
  endDate.value = end || ''
})
</script>

<template>
  <div class="date-filter">
    <!-- Header with stats -->
    <div class="filter-header">
      <div class="header-title">
        <Calendar :size="16" />
        <span>Date Filter</span>
      </div>
      <div class="date-coverage">
        <span class="coverage-stat">
          {{ dateStats.withDates.toLocaleString() }} with dates
        </span>
        <span class="coverage-divider">•</span>
        <span class="coverage-stat muted">
          {{ dateStats.withoutDates.toLocaleString() }} without
        </span>
      </div>
    </div>

    <!-- Date range info -->
    <div v-if="dateStats.earliest" class="date-range-info">
      <span>Data range:</span>
      <strong>{{ dateStats.earliest }}</strong>
      <span>to</span>
      <strong>{{ dateStats.latest }}</strong>
    </div>

    <!-- Quick ranges -->
    <div class="quick-ranges">
      <button
        v-for="range in quickRanges"
        :key="range.label"
        class="range-btn"
        :class="{ 
          active: startDate === range.start && endDate === range.end 
        }"
        @click="applyQuickRange(range)"
      >
        {{ range.label }}
      </button>
    </div>

    <!-- Custom date inputs -->
    <div class="custom-dates">
      <div class="date-input-group">
        <label>From</label>
        <input 
          type="date" 
          v-model="startDate"
          :max="endDate || dateStats.latest"
          @change="applyFilter"
        />
      </div>
      <span class="date-separator">—</span>
      <div class="date-input-group">
        <label>To</label>
        <input 
          type="date" 
          v-model="endDate"
          :min="startDate || dateStats.earliest"
          @change="applyFilter"
        />
      </div>
    </div>

    <!-- Active filter indicator -->
    <div v-if="isFilterActive" class="active-filter">
      <span class="filter-badge">
        <Filter :size="12" />
        Date filter active
      </span>
      <button class="btn-clear" @click="clearFilter">
        Clear
      </button>
    </div>

    <!-- Note about missing dates -->
    <p class="filter-note">
      <Info :size="14" />
      Records without dates are hidden when a date filter is active.
    </p>
  </div>
</template>

<style scoped>
.date-filter {
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 16px;
}

/* Header */
.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.header-title svg {
  width: 16px;
  height: 16px;
  color: var(--color-accent-text);
}

.date-coverage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
}

.coverage-stat {
  color: var(--color-accent-text);
}

.coverage-stat.muted {
  color: var(--color-text-muted);
}

.coverage-divider {
  color: var(--color-text-muted);
}

/* Date range info */
.date-range-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-secondary);
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}

.date-range-info strong {
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* Quick ranges */
.quick-ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.range-btn {
  padding: 5px 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s;
}

.range-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.range-btn.active {
  background: rgb(var(--color-accent-rgb) / 0.15);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Custom dates */
.custom-dates {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}

.date-input-group {
  flex: 1;
}

.date-input-group label {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.date-input-group input {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-control);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 0.8rem;
}

.date-input-group input:focus {
  outline: none;
  border-color: var(--color-accent);
}

/* Calendar icon: color-scheme (index.css) already draws it light on dark and dark on light. */
.date-input-group input::-webkit-calendar-picker-indicator {
  opacity: 0.8;
  cursor: pointer;
}

.date-separator {
  color: var(--color-text-muted);
  padding-bottom: 6px;
}

/* Active filter */
.active-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgb(var(--color-accent-rgb) / 0.1);
  border-radius: 6px;
  margin-bottom: 10px;
}

.filter-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--color-accent-text);
}

.filter-badge svg {
  width: 12px;
  height: 12px;
}

.btn-clear {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgb(var(--color-accent-rgb) / 0.3);
  border-radius: 4px;
  color: var(--color-accent-text);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-clear:hover {
  background: rgb(var(--color-accent-rgb) / 0.15);
}

/* Filter note */
.filter-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  line-height: 1.4;
  margin: 0;
}

.filter-note svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}
</style>
