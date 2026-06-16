<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { getThumbnailUrl } from '../utils/imageProxy'
import { STATUS_COLORS } from '../utils/constants'
import { getGoatUrl } from '../utils/goatHelpers'
import { usePopupSelection } from '../composables/usePopupSelection'
import { countUniqueIndividuals } from '../utils/clusterStats'

const props = defineProps({
  coordinates: {
    type: Object, // { lat, lng }
    required: true
  },
  points: {
    type: Array, // Array of point properties at this location
    required: true
  },
  initialSpecies: {
    type: String,
    default: null
  },
  initialSubspecies: {
    type: String,
    default: null
  },
  // Cluster-specific props
  isCluster: {
    type: Boolean,
    default: false
  },
  clusterStats: {
    type: Object, // { locationCount, countries, countriesFormatted, radiusKm, ... }
    default: null
  }
})

const emit = defineEmits(['close', 'open-gallery', 'toggle-dock'])

const store = useDataStore()

// Group points by species
const groupedBySpecies = computed(() => {
  return store.groupPointsBySpecies(props.points)
})

// Get sorted species list (by count, with photos first)
const speciesList = computed(() => {
  return store.getSpeciesWithPhotos(props.points)
})

const points = computed(() => props.points)

const {
  selectedSpecies,
  selectedSubspecies,
  selectedIndividualIndex,
  subspeciesList,
  individualsList,
  selectSpecies,
  selectSubspecies,
  locationName
} = usePopupSelection(points, groupedBySpecies, speciesList, {
  initialSpecies: computed(() => props.initialSpecies),
  initialSubspecies: computed(() => props.initialSubspecies)
})

// Current individual based on selection
const currentIndividual = computed(() => {
  const list = individualsList.value
  if (list.length === 0) return null
  const idx = Math.min(selectedIndividualIndex.value, list.length - 1)
  return list[idx]
})

// Get photo for current individual (with fallback)
const currentPhoto = computed(() => {
  if (!currentIndividual.value) return null
  return store.getPhotoForItem(currentIndividual.value)
})

// Handle individual selection
const selectIndividual = (index) => {
  selectedIndividualIndex.value = index
}

// Total counts
const totalSpecies = computed(() => Object.keys(groupedBySpecies.value).length)
const totalRecords = computed(() => props.clusterStats?.recordCount ?? props.points.length)
const totalIndividuals = computed(() => props.clusterStats?.individualCount ?? countUniqueIndividuals(props.points))
const hasDuplicateRecords = computed(() => totalRecords.value !== totalIndividuals.value)

// Format radius similar to scale bar (round to nice numbers)
const formattedRadius = computed(() => {
  if (!props.clusterStats?.radiusKm) return null
  const km = props.clusterStats.radiusKm

  if (km < 0.1) {
    // Less than 100m - show in meters
    const m = km * 1000
    if (m >= 10) return Math.round(m) + ' m'
    return m.toFixed(1) + ' m'
  } else if (km < 1) {
    // Less than 1km - show in meters, rounded to nearest 10m
    const m = km * 1000
    if (m >= 100) return Math.round(m / 10) * 10 + ' m'
    return Math.round(m) + ' m'
  } else if (km < 10) {
    // 1-10km - show with one decimal
    return km.toFixed(1) + ' km'
  } else if (km < 100) {
    // 10-100km - round to nearest integer
    return Math.round(km) + ' km'
  } else {
    // 100+km - round to nearest 10km
    return Math.round(km / 10) * 10 + ' km'
  }
})

// Sex counts
const maleCount = computed(() => props.points.filter(p => p.sex === 'male').length)
const femaleCount = computed(() => props.points.filter(p => p.sex === 'female').length)

// Subspecies count for selected species
const subspeciesCount = computed(() => {
  if (!selectedSpecies.value || !groupedBySpecies.value[selectedSpecies.value]) {
    return 0
  }
  return Object.keys(groupedBySpecies.value[selectedSpecies.value].subspecies).length
})

// Individual count for current species+subspecies
const individualsCount = computed(() => individualsList.value.length)
const recordSelectorLabel = computed(() => {
  if (!props.isCluster) return 'Individuals'
  return selectedSubspecies.value ? 'Subspecies Records' : 'Species Records'
})

// Open gallery with current selection
const openGallery = () => {
  // Set gallery selection in store
  store.gallerySelection = {
    species: selectedSpecies.value,
    subspecies: selectedSubspecies.value,
    individualId: currentIndividual.value?.id
  }
  // Emit to open gallery
  emit('open-gallery')
}

const goatInfo = computed(() => {
  if (!selectedSpecies.value) return null
  return store.getGoatForSpecies(selectedSpecies.value)
})

const isEstimated = (field) => field?.source === 'ancestor'

const goatSourceLabel = (field) => {
  if (!field || field.source !== 'ancestor') return ''
  return `Estimated from ${field.aggregation_rank || 'relatives'}`
}

const goatTaxonUrl = computed(() => {
  return getGoatUrl(selectedSpecies.value, store.getGoatForSpecies)
})

const bioprojectUrl = computed(() => {
  const bp = goatInfo.value?.bioproject
  if (!bp?.value) return null
  return `https://www.ncbi.nlm.nih.gov/bioproject/${bp.value}`
})
</script>

<template>
  <div class="point-popup">
    <div class="popup-actions">
      <button class="popup-action-btn" @click="emit('toggle-dock')" title="Dock to right panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 3v18"/>
        </svg>
      </button>
      <button class="popup-action-btn" @click="emit('close')" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="popup-layout">
      <!-- Left Column: Photo & Individual Details -->
      <div class="popup-left-section">
        <!-- Photo -->
        <div class="photo-container">
          <img
            v-if="currentPhoto?.url"
            :src="getThumbnailUrl(currentPhoto.url)"
            :alt="currentIndividual?.id || 'Specimen'"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="$event.target.style.display = 'none'"
          />
          <div v-else class="no-photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>No photo</span>
          </div>

          <!-- Photo indicator -->
          <div v-if="!currentPhoto?.sameIndividual && currentPhoto?.url" class="photo-indicator">
            Same species
          </div>

          <!-- Expand button -->
          <button
            v-if="currentPhoto?.url"
            class="expand-btn"
            @click="openGallery"
            title="View in Gallery"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </div>

        <!-- Individuals Dropdown -->
        <div class="individuals-section">
          <div class="section-header">
            <span class="count-badge">{{ individualsCount }}</span>
            <span class="section-label">{{ recordSelectorLabel }}</span>
          </div>
          <select
            v-if="individualsList.length > 1"
            :value="selectedIndividualIndex"
            @change="selectIndividual(Number($event.target.value))"
            class="individual-select"
          >
            <option
              v-for="(ind, idx) in individualsList"
              :key="ind.id"
              :value="idx"
            >
              {{ ind.id }}
            </option>
          </select>
          <!-- Show ID as text when only 1 individual -->
          <div v-else class="single-individual-id">
            {{ currentIndividual?.id || 'N/A' }}
          </div>
        </div>

        <!-- Individual Details -->
        <div class="details-section">
          <!-- Observation Date -->
          <div v-if="currentIndividual?.observation_date" class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">{{ currentIndividual.observation_date }}</span>
          </div>

          <!-- Mimicry Ring -->
          <div v-if="currentIndividual?.mimicry_ring && currentIndividual.mimicry_ring !== 'Unknown'" class="detail-row">
            <span class="detail-label">Mimicry Ring:</span>
            <span class="detail-value">{{ currentIndividual.mimicry_ring }}</span>
          </div>

          <!-- Source -->
          <div class="detail-row">
            <span class="detail-label">Source:</span>
            <span class="detail-value">{{ currentIndividual?.source || 'Unknown' }}</span>
          </div>

          <!-- Status -->
          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span
              class="detail-value status-badge"
              :style="{ color: STATUS_COLORS[currentIndividual?.sequencing_status] || '#6b7280' }"
            >
              <span class="status-dot" :style="{ background: STATUS_COLORS[currentIndividual?.sequencing_status] || '#6b7280' }"></span>
              {{ currentIndividual?.sequencing_status || 'Unknown' }}
            </span>
          </div>

          <!-- Observation URL Link -->
          <a
            v-if="currentIndividual?.observation_url"
            :href="currentIndividual.observation_url"
            target="_blank"
            rel="noopener noreferrer"
            class="observation-link"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span v-if="currentIndividual?.source === 'iNaturalist'">View on iNaturalist</span>
            <span v-else>View on GBIF</span>
          </a>
        </div>

      </div>

      <!-- Right Column: Species, Subspecies & Location -->
      <div class="popup-right-section">
        <!-- Species Section -->
        <div class="taxonomy-section">
          <div class="section-header">
            <span class="count-badge">{{ totalSpecies }}</span>
            <span class="section-label">Species</span>
          </div>
          <select
            :value="selectedSpecies || ''"
            @change="selectSpecies($event.target.value || null)"
            class="taxonomy-select"
          >
            <option
              v-for="sp in speciesList"
              :key="sp.species"
              :value="sp.species"
            >
              {{ sp.species }} ({{ sp.count }})
            </option>
          </select>
        </div>

        <!-- Subspecies Section -->
        <div v-if="subspeciesList.length > 0" class="taxonomy-section">
          <div class="section-header">
            <span class="count-badge">{{ subspeciesCount }}</span>
            <span class="section-label">Subspecies</span>
          </div>
          <select
            :value="selectedSubspecies || ''"
            @change="selectSubspecies($event.target.value || null)"
            class="taxonomy-select"
          >
            <option
              v-for="ssp in subspeciesList"
              :key="ssp.name"
              :value="ssp.name"
            >
              {{ ssp.name }} ({{ ssp.count }})
            </option>
          </select>
        </div>

        <div class="divider"></div>

        <!-- Location/Cluster Summary -->
        <div class="location-summary">
          <div class="summary-title">{{ isCluster ? 'Cluster Summary' : 'Location Summary' }}</div>

          <!-- Cluster-specific: Location count -->
          <div v-if="isCluster && clusterStats" class="detail-row">
            <span
              class="detail-label"
              title="Unique coordinate sites rounded to four decimal places"
            >Sites:</span>
            <span class="detail-value">{{ clusterStats.locationCount }}</span>
          </div>

          <div v-if="isCluster && clusterStats?.individualCount" class="detail-row">
            <span
              class="detail-label"
              title="Unique specimen identifiers where record IDs are available"
            >Individuals:</span>
            <span class="detail-value">{{ clusterStats.individualCount }}</span>
          </div>

          <!-- Regular location: Location name -->
          <div v-else-if="locationName" class="detail-row">
            <span class="detail-label">Location:</span>
            <span class="detail-value location-name">{{ locationName }}</span>
          </div>

          <!-- Cluster: Countries with codes -->
          <div v-if="isCluster && clusterStats?.countriesFormatted" class="detail-row">
            <span class="detail-label">Countries:</span>
            <span class="detail-value">{{ clusterStats.countriesFormatted }}</span>
          </div>

          <!-- Regular location: Single country -->
          <div v-else-if="!isCluster && currentIndividual?.country && currentIndividual.country !== 'Unknown'" class="detail-row">
            <span class="detail-label">Country:</span>
            <span class="detail-value">{{ currentIndividual.country }}</span>
          </div>

          <div class="detail-row">
            <span class="detail-label">{{ isCluster ? 'Center:' : 'Coordinates:' }}</span>
            <span class="detail-value coords">
              {{ coordinates.lat.toFixed(4) }}, {{ coordinates.lng.toFixed(4) }}
            </span>
          </div>

          <!-- Cluster: Geographic radius -->
          <div v-if="isCluster && formattedRadius" class="detail-row">
            <span class="detail-label">Radius:</span>
            <span class="detail-value">{{ formattedRadius }}</span>
          </div>

          <div class="location-stats">
            <div class="stat">
              <span class="stat-value">{{ totalSpecies }}</span>
              <span class="stat-label">species</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ totalIndividuals }}</span>
              <span class="stat-label">individuals</span>
            </div>
            <div v-if="hasDuplicateRecords" class="stat">
              <span class="stat-value">{{ totalRecords }}</span>
              <span class="stat-label">{{ isCluster ? 'cluster records' : 'records' }}</span>
            </div>
          </div>

          <!-- Sex counts (only show if we have sex data) -->
          <div v-if="maleCount > 0 || femaleCount > 0" class="sex-stats">
            <span v-if="maleCount > 0" class="sex-count male">♂ {{ maleCount }}</span>
            <span v-if="femaleCount > 0" class="sex-count female">♀ {{ femaleCount }}</span>
            <span v-if="totalRecords - maleCount - femaleCount > 0" class="sex-count unknown">
              ? {{ totalRecords - maleCount - femaleCount }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="goatInfo && !store.goatLoading" class="goat-section">
      <div class="goat-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="goat-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M8 12h.01M12 12h.01M16 12h.01M8 8h.01M12 8h.01M16 8h.01M8 16h.01M12 16h.01M16 16h.01"/>
        </svg>
        <span class="goat-title">Genomic Data</span>
        <a v-if="goatTaxonUrl" :href="goatTaxonUrl" target="_blank" rel="noopener noreferrer" class="goat-header-link" title="View on GoaT">
          GoaT
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      <div class="goat-grid">
        <div v-if="goatInfo.genome_size" class="goat-field">
          <span class="goat-label">Genome Size</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.genome_size) }">
            {{ store.formatGenomeSize(goatInfo.genome_size.value) }}
            <span v-if="isEstimated(goatInfo.genome_size)" class="est-badge" :title="goatSourceLabel(goatInfo.genome_size)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.chromosome_number" class="goat-field">
          <span class="goat-label">2n</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.chromosome_number) }">
            {{ goatInfo.chromosome_number.value }}
            <span v-if="isEstimated(goatInfo.chromosome_number)" class="est-badge" :title="goatSourceLabel(goatInfo.chromosome_number)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.haploid_number" class="goat-field">
          <span class="goat-label">n</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.haploid_number) }">
            {{ goatInfo.haploid_number.value }}
            <span v-if="isEstimated(goatInfo.haploid_number)" class="est-badge" :title="goatSourceLabel(goatInfo.haploid_number)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.gc_percent" class="goat-field">
          <span class="goat-label">GC%</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.gc_percent) }">
            {{ typeof goatInfo.gc_percent.value === 'number' ? goatInfo.gc_percent.value.toFixed(1) + '%' : goatInfo.gc_percent.value }}
            <span v-if="isEstimated(goatInfo.gc_percent)" class="est-badge" :title="goatSourceLabel(goatInfo.gc_percent)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.busco_completeness" class="goat-field">
          <span class="goat-label">BUSCO</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.busco_completeness) }">
            {{ typeof goatInfo.busco_completeness.value === 'number' ? goatInfo.busco_completeness.value.toFixed(1) + '%' : goatInfo.busco_completeness.value }}
            <span v-if="isEstimated(goatInfo.busco_completeness)" class="est-badge" :title="goatSourceLabel(goatInfo.busco_completeness)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.assembly_level" class="goat-field goat-field-wide">
          <span class="goat-label">Assembly</span>
          <span class="goat-value" :class="{ estimated: isEstimated(goatInfo.assembly_level) }">
            {{ goatInfo.assembly_level.value }}
            <span v-if="isEstimated(goatInfo.assembly_level)" class="est-badge" :title="goatSourceLabel(goatInfo.assembly_level)">(est.)</span>
          </span>
        </div>

        <div v-if="goatInfo.bioproject && goatInfo.bioproject.source === 'direct'" class="goat-field goat-field-wide">
          <span class="goat-label">BioProject</span>
          <a v-if="bioprojectUrl" :href="bioprojectUrl" target="_blank" rel="noopener noreferrer" class="goat-bioproject-link">
            {{ goatInfo.bioproject.value }}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <span v-else class="goat-value">{{ goatInfo.bioproject.value }}</span>
        </div>
      </div>

      <div class="goat-citation">
        Challis et al. 2023, Wellcome Open Research, 8:24
      </div>
    </div>
  </div>
</template>

<style scoped>
.point-popup {
  position: relative;
  background: var(--color-bg-primary, #1a1a2e);
  color: var(--color-text-primary, #e0e0e0);
  border-radius: 10px;
  padding: 12px;
  min-width: 380px;
  max-width: 480px;
  box-shadow: 0 4px 20px var(--color-shadow-color, rgba(0, 0, 0, 0.5));
  border: 1px solid var(--color-border, #3d3d5c);
}

.popup-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  z-index: 10;
}

.popup-action-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.popup-action-btn:hover {
  background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--color-text-primary, #fff);
}

.popup-action-btn svg {
  width: 14px;
  height: 14px;
}

.popup-layout {
  display: flex;
  gap: 10px;
}

/* Left Column: Photo & Individual Details */
.popup-left-section {
  flex-shrink: 0;
  width: 150px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.photo-container {
  position: relative;
  width: 150px;
  height: 150px;
  background: var(--color-bg-secondary, #252540);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border, #3d3d5c);
}

.photo-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.no-photo {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #666);
  gap: 8px;
}

.no-photo svg {
  width: 40px;
  height: 40px;
  opacity: 0.5;
}

.no-photo span {
  font-size: 0.75rem;
}

.photo-indicator {
  position: absolute;
  bottom: 6px;
  left: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: var(--color-text-muted, #888);
  font-size: 0.65rem;
  padding: 3px 6px;
  border-radius: 3px;
  text-align: center;
}

.expand-btn {
  position: absolute;
  bottom: 6px;
  left: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  border-radius: 5px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
  opacity: 0.7;
}

.expand-btn:hover {
  background: rgba(59, 130, 246, 0.9);
  opacity: 1;
}

.expand-btn svg {
  width: 16px;
  height: 16px;
}

.photo-container:has(.photo-indicator) .expand-btn {
  bottom: 28px;
}

/* Section Header with count badge */
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.count-badge {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.2));
  color: var(--color-accent, #4ade80);
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 20px;
  text-align: center;
}

.section-label {
  font-size: 0.7rem;
  color: var(--color-text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Individuals Section */
.individuals-section {
  display: flex;
  flex-direction: column;
}

.individual-select {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.8rem;
  font-family: monospace;
  cursor: pointer;
  transition: all 0.2s;
}

.individual-select:hover {
  border-color: var(--color-border-light, #5d5d7c);
}

.individual-select:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
  box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
}

.single-individual-id {
  padding: 6px 8px;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-info, #14b8a6);
  font-size: 0.8rem;
  font-family: monospace;
}

/* Details Section */
.details-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border, #3d3d5c);
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.75rem;
}

.detail-label {
  color: var(--color-text-muted, #888);
  flex-shrink: 0;
  min-width: 55px;
}

.detail-value {
  color: var(--color-text-primary, #e0e0e0);
  word-break: break-word;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 5px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Right Column: Species, Subspecies & Location */
.popup-right-section {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.taxonomy-section {
  display: flex;
  flex-direction: column;
}

.taxonomy-select {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.85rem;
  font-style: italic;
  cursor: pointer;
  transition: all 0.2s;
}

.taxonomy-select:hover {
  border-color: var(--color-border-light, #5d5d7c);
}

.taxonomy-select:focus {
  outline: none;
  border-color: var(--color-accent, #4ade80);
  box-shadow: 0 0 0 2px var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
}

.divider {
  height: 1px;
  background: var(--color-border, #3d3d5c);
  margin: 4px 0;
}

.location-summary {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.05));
  border: 1px solid var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
  border-radius: 6px;
  padding: 8px;
}

.summary-title {
  font-size: 0.7rem;
  color: var(--color-accent, #4ade80);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.location-name {
  font-style: italic;
}

.coords {
  font-family: monospace;
  font-size: 0.7rem;
}

.location-stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
}

.stat {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent, #4ade80);
}

.stat-label {
  font-size: 0.7rem;
  color: var(--color-text-muted, #888);
}

/* Observation URL Link */
.observation-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.1));
  border: 1px solid var(--color-accent-subtle, rgba(74, 222, 128, 0.3));
  border-radius: 5px;
  color: var(--color-accent, #4ade80);
  font-size: 0.75rem;
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
}

.observation-link:hover {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.2));
  border-color: var(--color-accent, rgba(74, 222, 128, 0.5));
  color: var(--color-accent-hover, #86efac);
}

.observation-link svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* Sex Stats */
.sex-stats {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
}

.sex-count {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.8rem;
  font-weight: 600;
}

.sex-count.male {
  color: #60a5fa; /* Blue for male */
}

.sex-count.female {
  color: #f472b6; /* Pink for female */
}

.sex-count.unknown {
  color: var(--color-text-muted, #9ca3af); /* Gray for unknown */
}

/* GoaT Genomic Data Section */
.goat-section {
  margin-top: 8px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
}

.goat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.goat-icon {
  width: 14px;
  height: 14px;
  color: #60a5fa;
  flex-shrink: 0;
}

.goat-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #60a5fa;
}

.goat-header-link {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.65rem;
  font-weight: 500;
  color: #60a5fa;
  text-decoration: none;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.2s;
}

.goat-header-link:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
}

.goat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

.goat-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
}

.goat-field-wide {
  grid-column: span 3;
}

.goat-label {
  font-size: 0.6rem;
  color: var(--color-text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.goat-value {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary, #e0e0e0);
  font-variant-numeric: tabular-nums;
}

.goat-value.estimated {
  color: var(--color-text-secondary, #aaa);
}

.est-badge {
  font-size: 0.6rem;
  font-weight: 400;
  color: #f59e0b;
  cursor: help;
}

.goat-bioproject-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: #60a5fa;
  text-decoration: none;
  font-weight: 500;
}

.goat-bioproject-link:hover {
  color: #93c5fd;
  text-decoration: underline;
}

.goat-citation {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(59, 130, 246, 0.15);
  font-size: 0.55rem;
  color: var(--color-text-muted, #666);
  font-style: italic;
}
</style>
