<script setup>
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useHostPlantStore } from '../stores/hostPlants'
import FallbackImage from './FallbackImage.vue'
import { getImageUrlCandidates } from '../utils/imageProxy'

const store = useDataStore()
const hostPlantStore = useHostPlantStore()
const props = defineProps({
  coordinates: {
    type: Object,
    required: true,
  },
  occurrence: {
    type: Object,
    required: true,
  },
  // All occurrences of this host taxon at the same site (defaults to the
  // single clicked occurrence). Drives the "occurrences per site" count.
  occurrences: {
    type: Array,
    default: null,
  },
  taxon: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close', 'toggle-dock', 'open-gallery'])

// Occurrences at this site (always at least the clicked one).
const siteOccurrences = computed(() =>
  props.occurrences?.length ? props.occurrences : [props.occurrence]
)
const occurrenceCount = computed(() => siteOccurrences.value.length)

// Which occurrence's details are currently shown.
const selectedIndex = ref(0)
watch(siteOccurrences, () => { selectedIndex.value = 0 })
const activeOccurrence = computed(() =>
  siteOccurrences.value[selectedIndex.value] || props.occurrence
)

const occurrenceLabel = (occ, idx) =>
  occ?.gbifID || occ?.catalogNumber || occ?.recordedBy || `Occurrence ${idx + 1}`

const gbifUrl = computed(() => {
  if (!activeOccurrence.value?.gbifID) return null
  return `https://www.gbif.org/occurrence/${activeOccurrence.value.gbifID}`
})

const displayName = computed(() =>
  activeOccurrence.value.scientificName
  || activeOccurrence.value.species
  || props.taxon.canonical_name
)

const plantPhoto = computed(() => hostPlantStore.getPhotoForOccurrence(activeOccurrence.value))

const plantImageCandidates = computed(() =>
  plantPhoto.value?.url ? getImageUrlCandidates(plantPhoto.value.url, { width: 400 }) : []
)

// When every source fails the card shows the host plant marker again and stops offering the photo.
const photoFailed = ref(false)
watch(() => plantPhoto.value?.url, () => { photoFailed.value = false })
const hasPhoto = computed(() => Boolean(plantPhoto.value?.url) && !photoFailed.value)
const galleryBtn = ref(null)

const rankLabel = computed(() => props.taxon.rank || 'host taxon')

const openGallery = (fromPhoto = false) => {
  // Focus comes back to the gallery button when the gallery closes.
  if (fromPhoto === true) galleryBtn.value?.focus({ preventScroll: true })
  const occ = activeOccurrence.value
  store.gallerySelection = {
    mode: 'host-plants',
    hostTaxon: props.taxon.canonical_name || occ.host_taxon_name || occ.species,
    occurrenceId: occ.gbifID,
  }
  emit('open-gallery', 'host-plants')
}
</script>

<template>
  <div class="point-popup plant-popup">
    <div class="popup-actions">
      <button type="button" class="popup-action-btn" @click="emit('toggle-dock')" title="Dock to right panel" aria-label="Dock to right panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 3v18"/>
        </svg>
      </button>
      <button type="button" class="popup-action-btn" @click="emit('close')" title="Close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="popup-layout">
      <div class="popup-left-section">
        <div class="plant-marker-card" :class="{ 'photo-openable': hasPhoto }" @click="hasPhoto && openGallery(true)">
          <FallbackImage
            v-if="hasPhoto"
            :candidates="plantImageCandidates"
            :alt="displayName"
            loading="lazy"
            @error="photoFailed = true"
          />
          <template v-else>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M32 8 58 54H6Z" fill="currentColor" stroke="white" stroke-width="4" stroke-linejoin="round"/>
          </svg>
          <span>Host plant occurrence</span>
          </template>
          <div v-if="hasPhoto && !plantPhoto.sameOccurrence" class="photo-indicator">
            Same host plant
          </div>
          <button
            ref="galleryBtn"
            class="open-gallery-btn"
            type="button"
            title="Open host plant gallery"
            aria-label="Open host plant gallery"
            @click.stop="openGallery"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h6v6"/>
              <path d="M10 14 21 3"/>
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>
            </svg>
          </button>
        </div>

        <div class="individuals-section">
          <div class="section-header">
            <span v-if="occurrenceCount > 1" class="count-badge">{{ occurrenceCount }}</span>
            <span class="section-label">{{ occurrenceCount === 1 ? 'Occurrence' : 'Occurrences at site' }}</span>
          </div>
          <select
            v-if="occurrenceCount > 1"
            class="occurrence-select"
            v-model.number="selectedIndex"
          >
            <option v-for="(occ, idx) in siteOccurrences" :key="idx" :value="idx">
              {{ occurrenceLabel(occ, idx) }}
            </option>
          </select>
          <div v-else class="single-individual-id">
            {{ activeOccurrence.gbifID || 'GBIF record' }}
          </div>
        </div>

        <div class="details-section">
          <div v-if="activeOccurrence.eventDate" class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">{{ activeOccurrence.eventDate }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Source:</span>
            <span class="detail-value">{{ activeOccurrence.datasetName || activeOccurrence.publisher || 'GBIF' }}</span>
          </div>
          <a
            v-if="gbifUrl"
            :href="gbifUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="observation-link"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View on GBIF
          </a>
        </div>
      </div>

      <div class="popup-right-section">
        <div class="taxonomy-section">
          <div class="section-header">
            <span class="section-label">Host {{ rankLabel }}</span>
          </div>
          <div class="taxonomy-select taxonomy-display">
            {{ displayName }}
          </div>
        </div>

        <div class="divider"></div>

        <div class="location-summary">
          <div class="summary-title">Location Summary</div>
          <div v-if="activeOccurrence.country" class="detail-row">
            <span class="detail-label">Country:</span>
            <span class="detail-value">{{ activeOccurrence.country }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Coordinates:</span>
            <span class="detail-value coords">
              {{ coordinates.lat.toFixed(4) }}, {{ coordinates.lng.toFixed(4) }}
            </span>
          </div>
          <div v-if="activeOccurrence.publisher" class="detail-row">
            <span class="detail-label">Publisher:</span>
            <span class="detail-value">{{ activeOccurrence.publisher }}</span>
          </div>

          <div class="location-stats">
            <div class="stat">
              <span class="stat-value">1</span>
              <span class="stat-label">plant taxon</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ occurrenceCount }}</span>
              <span class="stat-label">{{ occurrenceCount === 1 ? 'record' : 'records' }}</span>
            </div>
          </div>
        </div>

        <p class="plant-caveat">
          GBIF plant occurrences are context records and do not prove local host use.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.point-popup {
  position: relative;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border-radius: 10px;
  padding: 12px;
  min-width: 380px;
  max-width: 480px;
  box-shadow: 0 4px 20px var(--color-shadow-color);
  border: 1px solid var(--color-border);
}

/* Dock and close stay in view when a tall card scrolls: a sticky row of no height at the top of the card, at the
   same place as before (8 px from the top and right edges). The margins cancel out, so nothing below moves. */
.popup-actions {
  position: sticky;
  top: 8px;
  height: 0;
  margin: -4px -4px 4px 0;
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  z-index: 10;
}

.popup-action-btn {
  flex: none;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Opaque, the card's own colour: scrolled content passes under the buttons, not through them. */
  background: var(--color-bg-primary);
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.popup-action-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.popup-action-btn svg {
  width: 14px;
  height: 14px;
}

.popup-layout {
  display: flex;
  gap: 10px;
}

.popup-left-section {
  flex-shrink: 0;
  width: 150px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plant-marker-card {
  position: relative;
  width: 150px;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-accent-text);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.plant-marker-card svg {
  width: 48px;
  height: 48px;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
}

.plant-marker-card span {
  max-width: 110px;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  text-align: center;
}

.plant-marker-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-indicator {
  position: absolute;
  bottom: 6px;
  left: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: var(--color-text-muted);
  font-size: 0.65rem;
  padding: 3px 6px;
  border-radius: 3px;
  text-align: center;
  pointer-events: none;
}

.open-gallery-btn {
  position: absolute;
  left: 8px;
  bottom: 8px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: var(--color-info-fill);
  color: var(--color-on-info);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: transform 0.15s, background 0.15s;
}

.open-gallery-btn:hover {
  background: #1e40af;
  transform: translateY(-1px);
}

.open-gallery-btn svg {
  width: 17px;
  height: 17px;
  filter: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.count-badge {
  background: var(--color-accent-subtle);
  color: var(--color-accent-text);
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 20px;
  text-align: center;
}

.section-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.single-individual-id,
.taxonomy-select {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 0.8rem;
}

.single-individual-id {
  color: var(--color-text-primary);
  font-family: monospace;
}

.occurrence-select {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  color: var(--color-info-text);
  font-family: monospace;
  font-size: 0.78rem;
  cursor: pointer;
}

.taxonomy-display {
  font-style: italic;
}

.details-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.75rem;
}

.detail-label {
  color: var(--color-text-muted);
  flex-shrink: 0;
  min-width: 55px;
}

.detail-value {
  color: var(--color-text-primary);
  word-break: break-word;
}

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

.divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.location-summary {
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent-subtle);
  border-radius: 6px;
  padding: 8px;
}

.summary-title {
  font-size: 0.7rem;
  color: var(--color-accent-text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
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
  border-top: 1px solid var(--color-accent-subtle);
}

.stat {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent-text);
}

.stat-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.observation-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent-subtle);
  border-radius: 5px;
  color: var(--color-accent-text);
  font-size: 0.75rem;
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
}

.observation-link:hover {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent);
  color: var(--color-accent-hover);
}

.observation-link svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.plant-caveat {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.68rem;
  font-style: italic;
  line-height: 1.35;
}
</style>

<style src="./popup-shared.css"></style>
