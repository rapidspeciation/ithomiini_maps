<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDataStore } from '../stores/data'
import { usePersistenceStore } from '../stores/persistence'
import { useLegendStore } from '../stores/legend'
import { useSDMStore } from '../stores/sdm'
import { useHostPlantStore } from '../stores/hostPlants'
import FilterSelect from './FilterSelect.vue'
import DateFilter from './DateFilter.vue'
import TimeSlider from './TimeSlider.vue'
import SidebarMapSettings from './SidebarMapSettings.vue'
import DatabaseUpdateSection from './DatabaseUpdateSection.vue'
import { useCamidAutocomplete } from '../composables/useCamidAutocomplete'
import { ASPECT_RATIOS } from '../utils/constants'
import config from '../config'

const props = defineProps({
  currentView: {
    type: String,
    default: 'map'
  }
})

const emit = defineEmits(['open-export', 'open-mimicry', 'open-gallery', 'open-map-export', 'export-for-r', 'set-view', 'open-global-search'])

const store = useDataStore()
const persistenceStore = usePersistenceStore()
const legendStore = useLegendStore()
const sdmStore = useSDMStore()
const hostPlantStore = useHostPlantStore()
const expandedSdmResponsePlots = ref(new Set())
const toggleSdmResponsePlots = (species) => {
  const next = new Set(expandedSdmResponsePlots.value)
  if (next.has(species)) next.delete(species)
  else next.add(species)
  expandedSdmResponsePlots.value = next
}


// Toggle persistence
function togglePersistence() {
  const newValue = !persistenceStore.enabled
  persistenceStore.setEnabled(newValue)

  // If enabling, save all current state
  if (newValue) {
    persistenceStore.saveAllState({
      legendStore,
      dataStore: store
    })
  }
}

// CAMID autocomplete from composable
const {
  camidInput,
  camidTextarea,
  showCamidDropdown,
  selectedSuggestionIndex,
  camidSuggestions,
  handleCamidInput,
  selectCamid,
  handleCamidKeydown,
  handleCamidBlur,
  handleCamidClick
} = useCamidAutocomplete(store)

// Computed: Record counts
const totalRecords = computed(() => store.allFeatures.length)
const filteredRecords = computed(() => {
  const geo = store.filteredGeoJSON
  return geo ? geo.features.length : 0
})

// Image count
const imageCount = computed(() => {
  const geo = store.filteredGeoJSON
  if (!geo || !geo.features) return 0
  return geo.features.filter(f => f.properties?.image_url).length
})

// Share URL functionality
const copyShareUrl = () => {
  navigator.clipboard.writeText(window.location.href)
  showCopiedToast.value = true
  setTimeout(() => { showCopiedToast.value = false }, 2000)
}

const showCopiedToast = ref(false)

// Local UI refs
const goatChromosomeMinInput = ref('')
const goatChromosomeMaxInput = ref('')
const showExactDates = ref(false)

// ── Source tiles: immediate toggle, flattened GBIF children ───────────────
const GBIF_CHILDREN = ['iNaturalist', 'GBIF (UNAM)', 'GBIF (Other Institutions)']

// Compact tile labels + concise hover descriptions
const SOURCE_META = {
  'Sanger Institute': {
    label: 'Sanger',
    tooltip: 'Sanger Institute — sequencing project specimens with live photos',
  },
  'Dore et al. (2022)': {
    label: 'Doré 2022',
    tooltip: 'Doré et al. 2022 — published Neotropical Ithomiini compilation',
  },
  'iNaturalist': {
    label: 'iNat',
    tooltip: 'iNaturalist (via GBIF) — citizen-science research-grade observations',
  },
  'GBIF (UNAM)': {
    label: 'UNAM',
    tooltip: 'UNAM (via GBIF) — Universidad Nacional Autónoma de México museum collection',
  },
  'GBIF (Other Institutions)': {
    label: 'GBIF Other',
    tooltip: 'GBIF (other institutions) — aggregated museum & herbarium records',
  },
}
const SOURCE_SHORT_LABELS = Object.fromEntries(
  Object.entries(SOURCE_META).map(([k, v]) => [k, v.label])
)
const sourceTooltip = (source) => SOURCE_META[source]?.tooltip || source

const SOURCE_TILE_ORDER = computed(() => {
  const configured = Object.keys(store.sourceConfig || {})
  const known = configured.filter(s => SOURCE_SHORT_LABELS[s])
  const rest = configured.filter(s => !SOURCE_SHORT_LABELS[s])
  return [...known, ...rest]
})

const sourceRecordCount = (source) => {
  const cfg = store.sourceConfig?.[source]
  return cfg?.records || 0
}

const sourceIsLoading = (source) => store.sourceLoading?.has?.(source) ?? false
const sourceIsActive = (source) => store.filters.source.includes(source)
const sourceProgressValue = (source) => store.sourceProgress?.[source] ?? null

const toggleSource = (source) => {
  const current = store.filters.source
  const idx = current.indexOf(source)
  if (idx >= 0) {
    store.filters.source = current.filter(s => s !== source)
  } else {
    store.filters.source = [...current, source]
  }
}

const gbifAllSelected = computed(() =>
  GBIF_CHILDREN.every(c => store.filters.source.includes(c))
)

const toggleAllGbif = () => {
  if (gbifAllSelected.value) {
    store.filters.source = store.filters.source.filter(s => !GBIF_CHILDREN.includes(s))
  } else {
    const next = [...store.filters.source]
    for (const child of GBIF_CHILDREN) {
      if (!next.includes(child)) next.push(child)
    }
    store.filters.source = next
  }
}

const toggleGoatSource = (source) => {
  const idx = store.filters.goatDataSource.indexOf(source)
  if (idx >= 0) {
    store.filters.goatDataSource.splice(idx, 1)
  } else {
    store.filters.goatDataSource.push(source)
  }
}

// ── Filter tile system ─────────────────────────────────────────────────────
// Taxonomy levels ordered from broad to narrow.
// Enabled levels are rendered below as active filters; hidden ones retain
// their selections so users can re-enable without losing filter state.
const TAXONOMY_LEVELS = [
  { key: 'family', label: 'Family', storeKey: 'family', optionsKey: 'uniqueFamilies', placeholder: 'All Families' },
  { key: 'tribe', label: 'Tribe', storeKey: 'tribe', optionsKey: 'uniqueTribes', placeholder: 'All Tribes' },
  { key: 'genus', label: 'Genus', storeKey: 'genus', optionsKey: 'uniqueGenera', placeholder: 'All Genera' },
  { key: 'species', label: 'Species', storeKey: 'species', optionsKey: 'speciesFilterOptions', placeholder: 'Search species...' },
  { key: 'subspecies', label: 'Subsp.', storeKey: 'subspecies', optionsKey: 'uniqueSubspecies', placeholder: 'Search subspecies...' },
  { key: 'sex', label: 'Sex', storeKey: 'sex', placeholder: 'All sexes' },
]

const enabledTaxonomyLevels = ref(new Set(['species', 'subspecies']))
const toggleTaxonomyLevel = (key) => {
  const next = new Set(enabledTaxonomyLevels.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  enabledTaxonomyLevels.value = next
}

const OTHER_FILTERS = [
  { key: 'camid', label: 'CAMID' },
  { key: 'status', label: 'Sequencing Status' },
  { key: 'country', label: 'Country' },
  { key: 'timerange', label: 'Time Range' },
  { key: 'goat', label: 'GoaT' },
]

// Tiles whose availability depends on runtime state (view, feature flags, data loaded)
const availableOtherFilters = computed(() =>
  OTHER_FILTERS.filter(f => {
    if (f.key === 'sdm') return props.currentView === 'map' && sdmStore.hasData
    if (f.key === 'hostplants') return true
    if (f.key === 'goat') return config.features.goatIntegration
    return true
  })
)

const enabledOtherFilters = ref(new Set(['camid', 'sdm', 'hostplants']))
const syncStandaloneFilterStores = () => {
  if (enabledOtherFilters.value.has('sdm') && !sdmStore.enabled) sdmStore.toggle()
  if (enabledOtherFilters.value.has('hostplants') && !hostPlantStore.enabled) hostPlantStore.toggleEnabled()
}

onMounted(syncStandaloneFilterStores)

watch(
  () => [sdmStore.hasData, props.currentView],
  () => {
    if (props.currentView === 'map' && sdmStore.hasData) syncStandaloneFilterStores()
  }
)

const toggleOtherFilter = (key) => {
  const next = new Set(enabledOtherFilters.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  enabledOtherFilters.value = next

  // SDM tile drives sdmStore.enabled (which controls the map overlay + metadata load)
  if (key === 'sdm') {
    const want = next.has('sdm')
    if (want !== sdmStore.enabled) sdmStore.toggle()
  }
  if (key === 'hostplants') {
    const want = next.has('hostplants')
    if (want !== hostPlantStore.enabled) hostPlantStore.toggleEnabled()
  }
}

// Counts of active selections per level (shown on tiles)
const taxonomyActiveCount = (key) => {
  if (key === 'sex') return store.filters.sex !== 'all' ? 1 : 0
  const val = store.filters[key]
  return Array.isArray(val) ? val.length : 0
}

const selectedSpeciesFilterOptions = computed({
  get() {
    return store.filters.species.map(species => (
      store.speciesFilterOptions.find(option => option.value === species && !option.synonym)
      || { label: species, value: species }
    ))
  },
  set(options) {
    store.filters.species = (options || []).map(option => option.value || option).filter(Boolean)
  }
})

const otherFilterActiveCount = (key) => {
  if (key === 'camid') return (camidInput.value || '').split(/[,\s]+/).filter(Boolean).length
  if (key === 'status') return store.filters.status.length
  if (key === 'country') return store.filters.country.length
  if (key === 'timerange') {
    return (store.filters.dateStart ? 1 : 0) + (store.filters.dateEnd ? 1 : 0)
  }
  if (key === 'goat') {
    return (store.filters.goatCoverage !== 'all' ? 1 : 0)
      + store.filters.goatDataSource.filter(source => source !== 'none').length
      + (store.filters.goatChromosomeMin != null ? 1 : 0)
      + (store.filters.goatChromosomeMax != null ? 1 : 0)
  }
  if (key === 'sdm') return sdmStore.selectedSpecies.length
  if (key === 'hostplants') return hostPlantStore.selectedTaxonSlugs.length
  return 0
}

const otherFilterLabel = (key) =>
  OTHER_FILTERS.find(filter => filter.key === key)?.label || key

const HOST_BUTTERFLY_COLORS = [
  '#4ade80',
  '#38bdf8',
  '#f59e0b',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
  '#84cc16',
]

const selectedHostIdLevels = ref(['species'])
const selectedHostEvidenceLevels = ref(['direct', 'literature'])
const selectedHostButterflyValues = ref([])
const autoHostPlantSlugsByButterfly = ref(new Map())
const selectedButterfliesForHostPlants = computed(() =>
  selectedHostButterflyValues.value.filter(Boolean)
)

const selectedHostButterflyColorMap = computed(() => {
  const map = new Map()
  selectedButterfliesForHostPlants.value.forEach((butterfly, index) => {
    map.set(butterfly, HOST_BUTTERFLY_COLORS[index % HOST_BUTTERFLY_COLORS.length])
  })
  return map
})

const optionColorStyle = (colors = []) => {
  const unique = [...new Set(colors.filter(Boolean))]
  if (unique.length === 0) return null
  if (unique.length === 1) return { background: unique[0] }
  const step = 100 / unique.length
  const stops = unique.flatMap((color, index) => {
    const start = Math.round(index * step)
    const end = Math.round((index + 1) * step)
    return [`${color} ${start}%`, `${color} ${end}%`]
  })
  return { background: `linear-gradient(90deg, ${stops.join(', ')})` }
}

const hostPlantButterflyOptions = computed(() =>
  hostPlantStore.getButterflyOptionsForHostPlants().map(option => {
    const color = selectedHostButterflyColorMap.value.get(option.value)
    return {
      ...option,
      color,
      colorStyle: color ? { background: color } : null,
    }
  })
)
const selectedHostButterflyOptions = computed({
  get() {
    return selectedHostButterflyValues.value.map(value => (
      hostPlantButterflyOptions.value.find(option => option.value === value)
      || { label: value, value, color: selectedHostButterflyColorMap.value.get(value) }
    ))
  },
  set(options) {
    selectedHostButterflyValues.value = (options || []).map(option => option.value || option).filter(Boolean)
  }
})
const hostPlantTaxaForSelection = computed(() => {
  const selected = selectedButterfliesForHostPlants.value
  if (selected.length === 0) {
    return hostPlantStore.taxa.filter(taxon =>
      taxon.occurrence_count > 0 && selectedHostIdLevels.value.includes(taxon.rank)
    )
  }
  return hostPlantStore.getTaxaForButterflies(selected, {
    hostIdLevels: selectedHostIdLevels.value,
    evidenceLevels: selectedHostEvidenceLevels.value,
  })
})

const hostPlantContributorSegmentsBySlug = computed(() => {
  const bySlug = new Map()
  for (const butterfly of selectedButterfliesForHostPlants.value) {
    const color = selectedHostButterflyColorMap.value.get(butterfly)
    if (!color) continue
    const taxa = hostPlantStore.getTaxaForButterflies([butterfly], {
      hostIdLevels: selectedHostIdLevels.value,
      evidenceLevels: selectedHostEvidenceLevels.value,
    })
    for (const taxon of taxa) {
      const segments = bySlug.get(taxon.slug) || []
      const evidence = [...new Set((taxon.associations || []).map(association => association.evidence_level).filter(Boolean))].join(', ')
      segments.push({ color, evidence, butterfly })
      bySlug.set(taxon.slug, segments)
    }
  }
  return bySlug
})
const hostPlantOptions = computed(() =>
  hostPlantStore
    .getOccurrenceTaxonOptionsForButterflies([], {
      hostIdLevels: selectedHostIdLevels.value,
      evidenceLevels: selectedHostEvidenceLevels.value,
    })
    .map(option => {
      const segments = hostPlantContributorSegmentsBySlug.value.get(option.value) || []
      const colors = segments.map(segment => segment.color)
      const taxon = hostPlantStore.taxaBySlug.get(option.value)
      return {
        ...option,
        segments,
        colors,
        color: colors[0] || null,
        colorStyle: optionColorStyle(colors),
        tagBadge: taxon?.occurrence_count || null,
        evidence: segments.length === 1 ? segments[0].evidence : null,
      }
    })
)
const selectedHostPlantOptions = computed({
  get() {
    return hostPlantOptions.value.filter(option => hostPlantStore.selectedTaxonSlugs.includes(option.value))
  },
  set(options) {
    hostPlantStore.setSelectedTaxa((options || []).map(option => option.value))
  }
})

const toggleHostPlantIdLevel = (level) => {
  const selected = new Set(selectedHostIdLevels.value)
  if (selected.has(level)) {
    if (selected.size === 1) return
    selected.delete(level)
  } else {
    selected.add(level)
  }
  selectedHostIdLevels.value = hostPlantStore.hostIdLevels.map(item => item.key).filter(key => selected.has(key))
}

const toggleHostEvidenceLevel = (level) => {
  const selected = new Set(selectedHostEvidenceLevels.value)
  if (selected.has(level)) {
    if (selected.size === 1) return
    selected.delete(level)
  } else {
    selected.add(level)
  }
  selectedHostEvidenceLevels.value = hostPlantStore.evidenceLevels.map(item => item.key).filter(key => selected.has(key))
}

watch([selectedButterfliesForHostPlants, selectedHostIdLevels, selectedHostEvidenceLevels], () => {
  const previousAutoSlugs = new Set()
  for (const slugs of autoHostPlantSlugsByButterfly.value.values()) {
    for (const slug of slugs) previousAutoSlugs.add(slug)
  }

  const nextByButterfly = new Map()
  for (const butterfly of selectedButterfliesForHostPlants.value) {
    const taxa = hostPlantStore.getTaxaForButterflies([butterfly], {
      hostIdLevels: selectedHostIdLevels.value,
      evidenceLevels: selectedHostEvidenceLevels.value,
    })
    const slugs = new Set(
      taxa
        .filter(taxon => taxon.occurrence_count > 0 && ['species', 'genus'].includes(taxon.rank))
        .map(taxon => taxon.slug)
    )
    nextByButterfly.set(butterfly, slugs)
  }

  const nextAutoSlugs = new Set()
  for (const slugs of nextByButterfly.values()) {
    for (const slug of slugs) nextAutoSlugs.add(slug)
  }

  const manual = hostPlantStore.selectedTaxonSlugs.filter(slug => !previousAutoSlugs.has(slug))
  hostPlantStore.setSelectedTaxa([...manual, ...nextAutoSlugs])
  autoHostPlantSlugsByButterfly.value = nextByButterfly
}, { deep: true })

hostPlantStore.loadMetadata().catch(() => {})

// Aspect ratio options - derived from shared constants
const aspectRatioLabels = {
  '16:9': '16:9 (Widescreen)',
  '4:3': '4:3 (Standard)',
  '1:1': '1:1 (Square)',
  '3:2': '3:2 (Photo)',
  'A4': 'A4 Portrait',
  'A4L': 'A4 Landscape',
}

const aspectRatioOptions = [
  ...Object.entries(ASPECT_RATIOS).map(([key, dims]) => ({
    value: key,
    label: aspectRatioLabels[key] || key,
    ...dims
  })),
  { value: 'custom', label: 'Custom', width: null, height: null },
]

// Get current aspect ratio dimensions
const currentExportDimensions = computed(() => {
  const option = aspectRatioOptions.find(o => o.value === store.exportSettings.aspectRatio)
  if (option && option.value !== 'custom') {
    return { width: option.width, height: option.height }
  }
  return { width: store.exportSettings.customWidth, height: store.exportSettings.customHeight }
})

// Calculate actual export pixel dimensions based on scale multiplier
const exportPixelDimensions = computed(() => {
  const base = currentExportDimensions.value
  const scale = store.exportSettings.dpi / 100
  return {
    width: Math.round(base.width * scale),
    height: Math.round(base.height * scale)
  }
})

// Update export dimensions - switches to custom mode when editing
const updateExportWidth = (value) => {
  const width = parseInt(value, 10)
  if (!isNaN(width) && width >= 100 && width <= 8000) {
    store.exportSettings.aspectRatio = 'custom'
    store.exportSettings.customWidth = width
  }
}

const updateExportHeight = (value) => {
  const height = parseInt(value, 10)
  if (!isNaN(height) && height >= 100 && height <= 8000) {
    store.exportSettings.aspectRatio = 'custom'
    store.exportSettings.customHeight = height
  }
}
</script>

<template>
  <aside class="sidebar">
    <!-- Header -->
    <header class="sidebar-header">
      <a :href="config.repoUrl" target="_blank" rel="noopener noreferrer" class="logo">
        <img :src="config.logoPath" :alt="config.title" class="logo-icon" />
        <div class="logo-text">
          <span class="title">{{ config.title }}</span>
          <span class="subtitle">{{ config.subtitle }}</span>
        </div>
      </a>
      <button
        type="button"
        class="smart-search-tile"
        title="Search across all taxa, countries, mimicry rings, and more"
        @click="$emit('open-global-search')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
        <span class="smart-search-label">Smart Search</span>
        <kbd>⌘K</kbd>
      </button>
    </header>

    <!-- Scrollable Content -->
    <div class="sidebar-content">
      
      <!-- View Toggle -->
      <div class="view-toggle">
        <button 
          :class="{ active: currentView === 'map' }"
          @click="emit('set-view', 'map')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
          Map
        </button>
        <button 
          :class="{ active: currentView === 'table' }"
          @click="emit('set-view', 'table')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
          Table
        </button>
      </div>

      <!-- Record Count Banner -->
      <div class="record-count">
        <span class="count">{{ filteredRecords.toLocaleString() }}</span>
        <span class="label">of {{ totalRecords.toLocaleString() }} records</span>
      </div>

      <!-- Bounding Box Active Indicator -->
      <div v-if="store.boundingBox" class="bbox-indicator">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <rect x="3" y="3" width="18" height="18" rx="0"/>
        </svg>
        <span>Spatial filter active</span>
        <button class="bbox-clear" @click="store.boundingBox = null">Clear</button>
      </div>

      <!-- Quick Actions Row -->
      <div class="quick-actions">
        <button v-if="config.features.imageGallery" class="action-btn" @click="emit('open-gallery')" :disabled="imageCount === 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>Gallery</span>
          <span class="badge" v-if="imageCount > 0">{{ imageCount }}</span>
        </button>
        <button v-if="config.features.mimicrySelector" class="action-btn" @click="emit('open-mimicry')">
          <img src="../assets/Mimicry_bttn.svg" alt="Mimicry" class="mimicry-icon" />
          <span>Mimicry</span>
          <span class="badge" v-if="store.filters.mimicry.length > 0">{{ store.filters.mimicry.length }}</span>
        </button>
        <button
          class="action-btn"
          :class="{ active: store.exportSettings.enabled }"
          @click="store.exportSettings.enabled = !store.exportSettings.enabled"
          v-if="currentView === 'map'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>Preview Export</span>
        </button>
      </div>

      <!-- Export Settings (appears when Preview Export is active) -->
      <div v-if="store.exportSettings.enabled && currentView === 'map'" class="filter-section export-settings-panel">
        <label class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Export Settings
        </label>

        <!-- Aspect Ratio -->
        <div class="setting-row">
          <label>Aspect Ratio</label>
          <select v-model="store.exportSettings.aspectRatio" class="style-select">
            <option v-for="opt in aspectRatioOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Dimensions (editable) -->
        <div class="setting-row">
          <label>Resolution</label>
          <div class="dimension-inputs">
            <div class="dimension-field">
              <input
                type="number"
                class="setting-input dimension-input"
                :value="currentExportDimensions.width"
                @input="updateExportWidth($event.target.value)"
                min="100"
                max="8000"
                @keydown.enter="$event.target.blur()"
              />
              <span class="dimension-label">W</span>
            </div>
            <span class="dimension-x">×</span>
            <div class="dimension-field">
              <input
                type="number"
                class="setting-input dimension-input"
                :value="currentExportDimensions.height"
                @input="updateExportHeight($event.target.value)"
                min="100"
                max="8000"
                @keydown.enter="$event.target.blur()"
              />
              <span class="dimension-label">H</span>
            </div>
          </div>
        </div>

        <!-- Include Options -->
        <div class="setting-row checkbox-group" style="margin-top: 12px;">
          <label class="checkbox-label">
            <input type="checkbox" v-model="store.exportSettings.includeLegend" />
            <span>Include Legend</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="store.exportSettings.includeScaleBar" />
            <span>Include Scale Bar</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="store.exportSettings.includeAttribution" />
            <span>Include Attribution</span>
          </label>
        </div>

        <!-- UI Scale -->
        <div class="setting-row" style="margin-top: 12px;">
          <label>UI Scale <span class="setting-hint">(legend, scale bar size)</span></label>
          <div class="slider-group">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              v-model.number="store.exportSettings.uiScale"
            />
            <span class="slider-value">{{ Math.round(store.exportSettings.uiScale * 100) }}%</span>
          </div>
        </div>

        <!-- Format Selection -->
        <div class="setting-row" style="margin-top: 12px;">
          <label>Format</label>
          <div class="format-toggle">
            <button
              :class="{ active: store.exportSettings.format === 'png' }"
              @click="store.exportSettings.format = 'png'"
            >PNG</button>
            <button
              :class="{ active: store.exportSettings.format === 'jpg' }"
              @click="store.exportSettings.format = 'jpg'"
            >JPG</button>
          </div>
        </div>

        <!-- DPI/Scale Selection -->
        <div class="setting-row" style="margin-top: 12px;">
          <label>Output Scale <span class="setting-hint">({{ exportPixelDimensions.width }}×{{ exportPixelDimensions.height }}px)</span></label>
          <div class="dpi-toggle">
            <button
              :class="{ active: store.exportSettings.dpi === 100 }"
              @click="store.exportSettings.dpi = 100"
            >1×</button>
            <button
              :class="{ active: store.exportSettings.dpi === 150 }"
              @click="store.exportSettings.dpi = 150"
            >1.5×</button>
            <button
              :class="{ active: store.exportSettings.dpi === 200 }"
              @click="store.exportSettings.dpi = 200"
            >2×</button>
            <button
              :class="{ active: store.exportSettings.dpi === 300 }"
              @click="store.exportSettings.dpi = 300"
            >3×</button>
          </div>
        </div>

        <!-- Export Button -->
        <button class="btn-export-now" @click="emit('open-map-export')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export Image
        </button>

        <!-- Export for R Button -->
        <button class="btn-export-r" @click="emit('export-for-r')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export for R (Vector)
        </button>
      </div>

      <!-- FILTERS: unified taxonomy + other filters with tile selectors -->
      <div class="filter-section">
        <label class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
          </svg>
          Filters
        </label>

        <!-- Taxonomy tile row -->
        <div class="filter-tile-group">
          <span class="filter-tile-group-label">Taxonomy</span>
          <div class="filter-tile-row">
            <button
              v-for="level in TAXONOMY_LEVELS"
              :key="level.key"
              type="button"
              class="filter-tile"
              :class="{ active: enabledTaxonomyLevels.has(level.key) }"
              @click="toggleTaxonomyLevel(level.key)"
              :title="`Toggle ${level.label} filter`"
            >
              {{ level.label }}
              <span v-if="taxonomyActiveCount(level.storeKey) > 0" class="filter-tile-count">
                {{ taxonomyActiveCount(level.storeKey) }}
              </span>
            </button>
          </div>
        </div>

        <!-- Active taxonomy filters rendered in broad-to-narrow order -->
        <div class="active-filters-stack">
          <template v-for="level in TAXONOMY_LEVELS" :key="level.key">
            <div v-if="level.key === 'sex' && enabledTaxonomyLevels.has(level.key)" class="filter-stack-item">
              <label class="filter-stack-label">Sex</label>
              <select class="sex-select" v-model="store.filters.sex">
                <option value="all">All (♂ + ♀)</option>
                <option value="male">♂ Male only</option>
                <option value="female">♀ Female only</option>
              </select>
            </div>
            <FilterSelect
              v-else-if="level.key === 'species' && enabledTaxonomyLevels.has(level.key)"
              :label="level.label"
              v-model="selectedSpeciesFilterOptions"
              :options="store.speciesFilterOptions"
              :filter-options="store.filterSpeciesOptions"
              :placeholder="level.placeholder"
              :multiple="true"
              :show-count="true"
            />
            <FilterSelect
              v-else-if="enabledTaxonomyLevels.has(level.key)"
              :label="level.label"
              v-model="store.filters[level.storeKey]"
              :options="store[level.optionsKey]"
              :placeholder="level.placeholder"
              :multiple="true"
              :show-count="level.key === 'species' || level.key === 'subspecies' || level.key === 'genus'"
            />
          </template>
        </div>

        <!-- Others filter tile row -->
        <div class="filter-tile-group">
          <span class="filter-tile-group-label">Other filters</span>
          <div class="filter-tile-row">
            <button
              v-for="other in availableOtherFilters"
              :key="other.key"
              type="button"
              class="filter-tile"
              :class="{ active: enabledOtherFilters.has(other.key) }"
              @click="toggleOtherFilter(other.key)"
              :title="`Toggle ${other.label} filter`"
            >
              {{ other.label }}
              <span v-if="otherFilterActiveCount(other.key) > 0" class="filter-tile-count">
                {{ otherFilterActiveCount(other.key) }}
              </span>
            </button>
          </div>
        </div>

        <!-- Active other filters -->
        <div class="active-filters-stack">
          <!-- CAMID -->
          <div v-if="enabledOtherFilters.has('camid')" class="filter-stack-item">
            <button
              type="button"
              class="filter-section-toggle filter-tile active"
              title="Disable CAMID filter"
              @click="toggleOtherFilter('camid')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <span>{{ otherFilterLabel('camid') }}</span>
              <span v-if="otherFilterActiveCount('camid') > 0" class="filter-tile-count">
                {{ otherFilterActiveCount('camid') }}
              </span>
            </button>
            <p class="filter-stack-hint">Enter or paste IDs (comma/space/newline separated)</p>
            <div class="camid-autocomplete">
              <textarea
                ref="camidTextarea"
                class="camid-textarea"
                placeholder="e.g. CAM012345, CAM012346..."
                :value="camidInput"
                @input="handleCamidInput"
                @keydown="handleCamidKeydown"
                @click="handleCamidClick"
                @focus="handleCamidClick"
                @blur="handleCamidBlur"
                autocomplete="off"
                spellcheck="false"
                rows="1"
              ></textarea>
              <div
                v-if="showCamidDropdown && camidSuggestions.length > 0"
                class="camid-dropdown"
              >
                <button
                  v-for="(suggestion, index) in camidSuggestions"
                  :key="suggestion"
                  class="camid-suggestion"
                  :class="{ selected: index === selectedSuggestionIndex }"
                  @mousedown.prevent="selectCamid(suggestion)"
                >
                  {{ suggestion }}
                </button>
              </div>
            </div>
          </div>

          <!-- Sequencing Status -->
          <div v-if="enabledOtherFilters.has('status')" class="filter-stack-item">
            <button
              type="button"
              class="filter-section-toggle filter-tile active"
              title="Disable sequencing status filter"
              @click="toggleOtherFilter('status')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
              <span>{{ otherFilterLabel('status') }}</span>
              <span v-if="otherFilterActiveCount('status') > 0" class="filter-tile-count">
                {{ otherFilterActiveCount('status') }}
              </span>
            </button>
            <FilterSelect
              v-model="store.filters.status"
              :options="store.uniqueStatuses"
              placeholder="All Statuses"
              :multiple="true"
            />
          </div>

          <!-- Country -->
          <div v-if="enabledOtherFilters.has('country')" class="filter-stack-item">
            <button
              type="button"
              class="filter-section-toggle filter-tile active"
              title="Disable country filter"
              @click="toggleOtherFilter('country')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>
              <span>{{ otherFilterLabel('country') }}</span>
              <span v-if="otherFilterActiveCount('country') > 0" class="filter-tile-count">
                {{ otherFilterActiveCount('country') }}
              </span>
            </button>
            <FilterSelect
              v-model="store.filters.country"
              :options="store.uniqueCountries"
              placeholder="All Countries"
              :multiple="true"
              :show-count="false"
            />
          </div>

          <!-- Sex -->

          <!-- Time Range (tile-driven) -->
          <div v-if="enabledOtherFilters.has('timerange')" class="filter-stack-item">
            <button
              type="button"
              class="filter-section-toggle filter-tile active"
              title="Disable time range filter"
              @click="toggleOtherFilter('timerange')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>{{ otherFilterLabel('timerange') }}</span>
              <span v-if="otherFilterActiveCount('timerange') > 0" class="filter-tile-count">
                {{ otherFilterActiveCount('timerange') }}
              </span>
            </button>
            <TimeSlider />
            <div class="exact-dates-section">
              <button
                class="subsection-toggle"
                @click="showExactDates = !showExactDates"
                :class="{ expanded: showExactDates }"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
                Exact Dates
              </button>
              <div v-show="showExactDates" class="subsection-content">
                <DateFilter />
              </div>
            </div>
          </div>

          <!-- Genomic Data (GoaT) (tile-driven) -->
          <div
            v-if="enabledOtherFilters.has('goat') && config.features.goatIntegration"
            class="filter-stack-item"
          >
            <button
              type="button"
              class="filter-section-toggle filter-tile active"
              title="Disable GoaT filter"
              @click="toggleOtherFilter('goat')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2c4 4 10 4 10 10s-6 6-10 10"/><path d="M17 2c-4 4-10 4-10 10s6 6 10 10"/><path d="M8 6h8"/><path d="M8 18h8"/></svg>
              <span>{{ otherFilterLabel('goat') }}</span>
              <span v-if="otherFilterActiveCount('goat') > 0" class="filter-tile-count">
                {{ otherFilterActiveCount('goat') }}
              </span>
              <span v-if="store.goatLoading" class="active-badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; margin-left: 6px;">
                Loading...
              </span>
            </button>

            <div class="goat-filter-group">
              <label class="goat-filter-label">GoaT Coverage</label>
              <div class="goat-toggle-group">
                <button
                  :class="{ active: store.filters.goatCoverage === 'all' }"
                  @click="store.filters.goatCoverage = 'all'"
                >All</button>
                <button
                  :class="{ active: store.filters.goatCoverage === 'in_goat' }"
                  @click="store.filters.goatCoverage = 'in_goat'"
                >In GoaT</button>
                <button
                  :class="{ active: store.filters.goatCoverage === 'not_in_goat' }"
                  @click="store.filters.goatCoverage = 'not_in_goat'"
                >Not in GoaT</button>
              </div>
            </div>

            <div class="goat-filter-group">
              <label class="goat-filter-label">Genome Data Source</label>
              <div class="goat-checkboxes">
                <label class="source-checkbox">
                  <input
                    type="checkbox"
                    :checked="store.filters.goatDataSource.includes('direct')"
                    @change="toggleGoatSource('direct')"
                  />
                  <span>Direct (measured)</span>
                </label>
                <label class="source-checkbox">
                  <input
                    type="checkbox"
                    :checked="store.filters.goatDataSource.includes('estimated')"
                    @change="toggleGoatSource('estimated')"
                  />
                  <span>Estimated (phylogenetic)</span>
                </label>
              </div>
            </div>

            <div class="goat-filter-group">
              <label class="goat-filter-label">Chromosome Number (2n)</label>
              <div class="chr-range-inputs">
                <input
                  type="number"
                  class="chr-input"
                  placeholder="Min"
                  v-model="goatChromosomeMinInput"
                  @change="store.filters.goatChromosomeMin = goatChromosomeMinInput ? Number(goatChromosomeMinInput) : null"
                  :min="store.chromosomeRange.min"
                  :max="store.chromosomeRange.max"
                />
                <span class="chr-separator">–</span>
                <input
                  type="number"
                  class="chr-input"
                  placeholder="Max"
                  v-model="goatChromosomeMaxInput"
                  @change="store.filters.goatChromosomeMax = goatChromosomeMaxInput ? Number(goatChromosomeMaxInput) : null"
                  :min="store.chromosomeRange.min"
                  :max="store.chromosomeRange.max"
                />
              </div>
            </div>

            <p v-if="store.goatLoaded && store.goatMeta" class="filter-hint">
              {{ store.goatMeta.totalSpecies.toLocaleString() }} species from GoaT
            </p>
            <p v-else-if="!store.goatLoaded && !store.goatLoading" class="filter-hint">
              GoaT data not available
            </p>
          </div>

        </div>
      </div>

      <!-- Species Distribution Models -->
      <div v-if="currentView === 'map' && sdmStore.hasData" class="filter-section">
        <label class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          Species Distribution Models
        </label>
        <div class="active-filters-stack">
          <div
            v-if="enabledOtherFilters.has('sdm')"
            class="filter-stack-item"
          >
            <FilterSelect
              label="Model Species"
              v-model="sdmStore.selectedSpecies"
              :options="sdmStore.availableSpecies"
              placeholder="Select up to 2 species..."
              :multiple="true"
            />

            <p v-if="sdmStore.selectedSpecies.length > 2" class="filter-hint" style="color: var(--error-color, #f87171);">
              Max 2 species for overlay comparison
            </p>

            <div v-if="sdmStore.selectedSpecies.length > 0" class="sdm-legend">
              <div class="sdm-legend-item" v-for="(sp, idx) in sdmStore.selectedSpecies.slice(0, 2)" :key="sp">
                <div class="sdm-legend-header">
                  <span class="sdm-legend-species">{{ sp }}</span>
                  <span v-if="sdmStore.getSDMInfo(sp)" class="sdm-confidence-badge" :class="sdmStore.getSDMInfo(sp).confidence">
                    {{ sdmStore.getSDMInfo(sp).confidence }}
                  </span>
                </div>
                <div class="sdm-gradient-bar" :class="idx === 0 ? 'warm' : 'cool'"></div>
                <div class="sdm-gradient-scale">
                  <span>Low</span>
                  <span>Habitat suitability</span>
                  <span>High</span>
                </div>
                <div v-if="sdmStore.getSDMInfo(sp)" class="sdm-model-info">
                  <div class="sdm-info-grid">
                    <span class="sdm-info-label">Records</span>
                    <span class="sdm-info-value">{{ sdmStore.getSDMInfo(sp).n_records }}</span>
                    <span class="sdm-info-label">AUC</span>
                    <span class="sdm-info-value">{{ sdmStore.getSDMInfo(sp).auc }}</span>
                    <span class="sdm-info-label">Boyce</span>
                    <span class="sdm-info-value">{{ sdmStore.getSDMInfo(sp).boyce || '—' }}</span>
                    <span class="sdm-info-label">Tier</span>
                    <span class="sdm-info-value">{{ sdmStore.getSDMInfo(sp).tier }}</span>
                    <span class="sdm-info-label">Algorithms</span>
                    <span class="sdm-info-value">{{ (sdmStore.getSDMInfo(sp).algorithms_used || []).join(', ') || '—' }}</span>
                  </div>
                </div>
                <div v-if="sdmStore.getSDMInfo(sp)?.env_summary?.length" class="sdm-env-section">
                  <button
                    type="button"
                    class="sdm-response-toggle"
                    :class="{ active: expandedSdmResponsePlots.has(sp) }"
                    @click="toggleSdmResponsePlots(sp)"
                  >
                    <span>Suitability response plots</span>
                    <span>{{ sdmStore.getSDMInfo(sp).env_summary.length }} variables</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  <div v-if="expandedSdmResponsePlots.has(sp)" class="sdm-env-list">
                    <div
                      v-for="env in sdmStore.getSDMInfo(sp).env_summary.slice(0, 5)"
                      :key="env.variable"
                      class="sdm-env-card"
                    >
                      <div class="sdm-env-header">
                        <span class="sdm-env-name">{{ env.label }}</span>
                        <span class="sdm-env-range">{{ env.optimal_range[0] }}–{{ env.optimal_range[1] }}{{ env.unit }}</span>
                      </div>
                      <div class="sdm-chart-wrap">
                        <span class="sdm-y-label">Suitability</span>
                        <svg class="sdm-sparkline" viewBox="0 0 200 40" preserveAspectRatio="none">
                          <polyline
                            :points="env.response_mean.map((v, i) => `${i * 200 / (env.response_mean.length - 1)},${40 - v * 40}`).join(' ')"
                            fill="none"
                            stroke="var(--color-accent, #4ade80)"
                            stroke-width="1.5"
                          />
                          <polygon
                            :points="[
                              ...env.response_mean.map((v, i) => `${i * 200 / (env.response_mean.length - 1)},${40 - (v + (env.response_std?.[i] || 0)) * 40}`),
                              ...env.response_mean.map((v, i) => `${(env.response_mean.length - 1 - i) * 200 / (env.response_mean.length - 1)},${40 - (env.response_mean[env.response_mean.length - 1 - i] - (env.response_std?.[env.response_mean.length - 1 - i] || 0)) * 40}`),
                            ].join(' ')"
                            fill="var(--color-accent, #4ade80)"
                            fill-opacity="0.15"
                          />
                        </svg>
                      </div>
                      <div class="sdm-x-axis">
                        <span>{{ Math.round(env.gradient[0] * 10) / 10 }}</span>
                        <span class="sdm-x-axis-label">{{ env.label }} ({{ env.unit || 'index' }})</span>
                        <span>{{ Math.round(env.gradient[env.gradient.length - 1] * 10) / 10 }}</span>
                      </div>
                      <div class="sdm-env-footer">
                        <span class="sdm-env-importance" :style="{ width: (env.importance * 100) + '%' }"></span>
                        <span class="sdm-env-conf">{{ Math.round(env.confidence * 100) }}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="sdmStore.selectedSpecies.length > 0" class="sdm-opacity-row">
              <span class="sdm-opacity-label">Opacity</span>
              <input
                type="range" min="0.1" max="1" step="0.1"
                :value="sdmStore.opacity"
                @input="sdmStore.setOpacity(parseFloat($event.target.value))"
              />
              <span class="sdm-opacity-value">{{ Math.round(sdmStore.opacity * 100) }}%</span>
            </div>

            <label
              v-if="sdmStore.selectedSpecies.length > 0"
              class="sdm-extent-row"
              title="When enabled, predictions are shown across the full Neotropics, including areas outside each species' known range. Disable to show only the modelled accessible area for each species."
            >
              <input
                type="checkbox"
                :checked="sdmStore.showFullExtent"
                @change="sdmStore.setShowFullExtent($event.target.checked)"
              />
              <span>Show full Neotropics</span>
            </label>

            <p class="filter-hint">
              {{ sdmStore.nSpecies }} species modelled · Tiered ensemble
            </p>
          </div>
        </div>
      </div>

      <!-- Host Plant Filters -->
      <div class="filter-section">
        <label class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 20A7 7 0 0 1 4 13c0-4 3-7 8-9 5 2 8 5 8 9a7 7 0 0 1-7 7"/><path d="M12 14v8"/><path d="M8 14c1.5 1 3 1 4 0 1 1 2.5 1 4 0"/></svg>
          Host Plant Filters
        </label>
        <div class="active-filters-stack">
          <div
            v-if="enabledOtherFilters.has('hostplants')"
            class="filter-stack-item"
          >
            <div class="host-confidence-group">
              <label class="filter-stack-label">Host ID level</label>
              <div class="host-confidence-toggle">
                <button
                  v-for="level in hostPlantStore.hostIdLevels"
                  :key="level.key"
                  type="button"
                  :class="{ active: selectedHostIdLevels.includes(level.key) }"
                  @click="toggleHostPlantIdLevel(level.key)"
                  :title="level.description"
                >
                  <span class="confidence-label">{{ level.label }}</span>
                  <span class="confidence-description">{{ level.description }}</span>
                </button>
              </div>
              <label class="filter-stack-label">Evidence</label>
              <div class="host-confidence-toggle">
                <button
                  v-for="level in hostPlantStore.evidenceLevels"
                  :key="level.key"
                  type="button"
                  :class="{ active: selectedHostEvidenceLevels.includes(level.key) }"
                  @click="toggleHostEvidenceLevel(level.key)"
                  :title="level.description"
                >
                  <span class="confidence-label">{{ level.label }}</span>
                  <span class="confidence-description">{{ level.description }}</span>
                </button>
              </div>
            </div>

            <p v-if="hostPlantStore.loading" class="filter-hint">Loading host plant metadata...</p>
            <p v-else-if="hostPlantTaxaForSelection.length === 0" class="filter-hint">
              No occurrence-backed host plant associations at this evidence level.
            </p>

            <FilterSelect
              v-if="hostPlantButterflyOptions.length > 0"
              label="Butterfly species"
              v-model="selectedHostButterflyOptions"
              :options="hostPlantButterflyOptions"
              placeholder="Search butterfly species..."
              :multiple="true"
            />

            <FilterSelect
              v-if="hostPlantOptions.length > 0"
              label="Host plant taxa"
              v-model="selectedHostPlantOptions"
              :options="hostPlantOptions"
              placeholder="Search host plants..."
              :multiple="true"
              :filter-options="hostPlantStore.filterOccurrenceTaxonOptions"
            />

            <p
              v-if="selectedButterfliesForHostPlants.length > 0 && hostPlantTaxaForSelection.length > 0 && hostPlantOptions.length === 0"
              class="filter-hint"
            >
              Associations found, but no GBIF occurrence layer has been generated for those host taxa yet.
            </p>

            <div v-if="hostPlantStore.selectedTaxonSlugs.length > 0" class="sdm-opacity-row">
              <span class="sdm-opacity-label">Opacity</span>
              <input
                type="range"
                min="0.15"
                max="1"
                step="0.05"
                v-model.number="hostPlantStore.opacity"
              />
              <span class="sdm-opacity-value">{{ Math.round(hostPlantStore.opacity * 100) }}%</span>
            </div>

            <p v-if="currentView !== 'map'" class="filter-hint">
              Host plant selections are used by the map overlay; the Host Plants table summarizes all associations.
            </p>

            <p class="filter-hint">
              {{ hostPlantStore.manifest?.metadata?.gbif_download_doi_note || 'GBIF citation metadata unavailable.' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Data Source tiles (immediate toggle) -->
      <div class="filter-section">
        <div class="source-header">
          <label class="section-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
            </svg>
            Data Source
          </label>
          <button
            type="button"
            class="source-bulk-link"
            @click="toggleAllGbif"
            :title="gbifAllSelected ? 'Deselect all GBIF sources' : 'Select all GBIF sources'"
          >
            {{ gbifAllSelected ? '− All GBIF' : '+ All GBIF' }}
          </button>
        </div>
        <div class="source-tile-row">
          <button
            v-for="source in SOURCE_TILE_ORDER"
            :key="source"
            type="button"
            class="filter-tile source-tile"
            :class="{ active: sourceIsActive(source), loading: sourceIsLoading(source) }"
            @click="toggleSource(source)"
            :title="sourceTooltip(source)"
          >
            <span class="source-tile-content">
              {{ SOURCE_SHORT_LABELS[source] || source }}
              <span v-if="sourceRecordCount(source) > 0" class="filter-tile-count">
                {{ sourceRecordCount(source) >= 1000
                    ? (sourceRecordCount(source) / 1000).toFixed(1) + 'k'
                    : sourceRecordCount(source) }}
              </span>
            </span>
            <span
              v-if="sourceProgressValue(source) !== null"
              class="source-tile-progress"
              :style="{ transform: `scaleX(${sourceProgressValue(source)})` }"
            />
          </button>
        </div>
        <p class="filter-hint" v-if="store.filters.source.length === 0" style="margin-top: 6px;">
          No sources selected — showing all data
        </p>
      </div>

      <!-- Map-specific Settings (Scatter, Clustering, Legend, Point Style) -->
      <SidebarMapSettings v-if="currentView === 'map'" />

      <!-- Remember Settings -->
      <div class="filter-section remember-settings">
        <div class="setting-row toggle-row">
          <div class="setting-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>Remember Settings</span>
          </div>
          <button
            class="toggle-button"
            :class="{ active: persistenceStore.enabled }"
            @click="togglePersistence"
            :title="persistenceStore.enabled ? 'Settings will be saved on page refresh' : 'Settings will reset on page refresh'"
          >
            {{ persistenceStore.enabled ? 'ON' : 'OFF' }}
          </button>
        </div>
        <p class="filter-hint" style="margin-top: 4px;">
          {{ persistenceStore.enabled ? 'All settings saved to browser' : 'Settings reset on refresh' }}
        </p>
      </div>

    </div>

    <DatabaseUpdateSection v-if="config.features.databaseUpdate" />

    <!-- Footer Actions -->
    <footer class="sidebar-footer">
      <div class="footer-row">
        <button class="btn-reset" @click="store.resetAllFilters">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          Reset
        </button>

        <button class="btn-share" @click="copyShareUrl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98"/>
          </svg>
          Share
        </button>

        <button class="btn-export" @click="emit('open-export')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export
        </button>
      </div>

      <!-- Toast notification -->
      <Transition name="toast">
        <div v-if="showCopiedToast" class="toast">
          URL copied to clipboard!
        </div>
      </Transition>
    </footer>
  </aside>
</template>

<style scoped src="./sidebar-styles.css"></style>
