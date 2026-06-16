<script setup>
import { computed, ref } from 'vue'
import { STATUS_COLORS } from '../utils/constants'
import { getProxyState, setProxyMode } from '../utils/imageProxy'
import GallerySearchSelect from './GallerySearchSelect.vue'

const props = defineProps({
  currentSpecimen: Object,
  currentSpecimenKey: String,
  selectedSpecies: String,
  selectedSubspecies: String,
  speciesList: Array,
  subspeciesList: Array,
  individualsList: Array,
  totalSpecies: Number,
  totalIndividuals: Number,
  totalSubspeciesCount: Number,
  allFilteredTotal: Number,
  allFilteredWithoutImages: Number,
  coordinates: Object,
  locationName: String,
  mode: {
    type: String,
    default: 'butterflies',
  },
  photoOrderOptions: {
    type: Array,
    default: () => [],
  },
  dateOrder: {
    type: String,
    default: 'desc',
  },
  // On mobile the sidebar is a slide-in drawer controlled by the parent.
  mobileOpen: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'select-species',
  'select-subspecies',
  'select-individual',
  'view-on-map',
  'move-photo-order',
  'set-date-order',
  'set-gallery-mode',
  'close-mobile',
])

const subspeciesCount = computed(() => props.subspeciesList?.length || 0)
const isHostPlants = computed(() => props.mode === 'host-plants')
const primaryLabel = computed(() => isHostPlants.value ? 'Host Taxa' : 'Species')
const secondaryLabel = computed(() => isHostPlants.value ? 'Occurrence Sets' : 'Subspecies')
const individualLabel = computed(() => isHostPlants.value ? 'Occurrences' : 'Individuals')
const speciesOptions = computed(() =>
  (props.speciesList || []).map(sp => ({
    value: sp.species,
    label: `${sp.species} (${sp.count})`,
    meta: sp.meta,
    searchText: sp.searchText || sp.species,
  }))
)
const subspeciesOptions = computed(() =>
  (props.subspeciesList || []).map(ssp => ({
    value: ssp.name,
    label: `${ssp.name} (${ssp.count})`,
    searchText: ssp.name,
  }))
)
const individualOptions = computed(() =>
  (props.individualsList || []).map(ind => ({
    value: ind.gallery_id || `${ind.id || ''}|${ind.image_url || ''}`,
    label: ind.id,
    meta: ind.observation_date || ind.country || '',
    searchText: [ind.id, ind.observation_date, ind.country, ind.source].filter(Boolean).join(' '),
  }))
)
const hostButterflySummary = computed(() => {
  const names = props.currentSpecimen?.associated_butterflies || []
  if (names.length === 0) return null
  return names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5} more` : '')
})

const showImageCache = ref(false)
const proxyState = getProxyState()
const proxyOptions = [
  { value: 'auto', label: 'Auto', desc: 'wsrv.nl \u2192 lh3 \u2192 thumbnail' },
  { value: 'wsrv', label: 'wsrv.nl', desc: 'Cached, fastest' },
  { value: 'lh3', label: 'Google CDN', desc: 'Direct, highest quality' },
  { value: 'thumbnail', label: 'Thumbnail', desc: 'Direct, lower quality' },
  { value: 'off', label: 'Off', desc: 'Original image URLs, no cache service' },
]
function statusClass(tier) {
  const s = proxyState.tierStatus.value[tier]
  if (s === 'ok') return 'status-ok'
  if (s === 'blocked') return 'status-blocked'
  return 'status-unknown'
}
</script>

<template>
  <div class="gallery-sidebar" :class="{ 'gallery-sidebar--open': mobileOpen }">
    <button class="gallery-sidebar-close" @click="emit('close-mobile')" aria-label="Close panel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="gallery-mode-toggle">
      <button
        class="mode-btn"
        :class="{ active: mode === 'butterflies' }"
        @click="emit('set-gallery-mode', 'butterflies')"
      >
        Butterflies
      </button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'host-plants' }"
        @click="emit('set-gallery-mode', 'host-plants')"
      >
        Host Plants
      </button>
    </div>

    <!-- Species Section -->
    <div class="sidebar-section">
      <div class="section-header">
        <span class="count-badge">{{ totalSpecies }}</span>
        <span class="section-label">{{ primaryLabel }}</span>
      </div>
      <GallerySearchSelect
        :model-value="selectedSpecies || ''"
        :options="speciesOptions"
        :placeholder="isHostPlants ? 'Search host taxa...' : 'Search species...'"
        @update:model-value="emit('select-species', $event || null)"
      />
    </div>

    <!-- Subspecies Section -->
    <div v-if="subspeciesList?.length > 0" class="sidebar-section">
      <div class="section-header">
        <span class="count-badge">{{ subspeciesCount }}</span>
        <span class="section-label">{{ secondaryLabel }}</span>
      </div>
      <GallerySearchSelect
        :model-value="selectedSubspecies || ''"
        :options="subspeciesOptions"
        :placeholder="isHostPlants ? 'Search sets...' : 'Search subspecies...'"
        @update:model-value="emit('select-subspecies', $event || null)"
      />
    </div>

    <!-- Individuals Section -->
    <div class="sidebar-section">
      <div class="section-header">
        <span class="count-badge">{{ individualsList?.length || 0 }}</span>
        <span class="section-label">{{ individualLabel }}</span>
      </div>
      <GallerySearchSelect
        v-if="individualsList?.length > 1"
        :model-value="currentSpecimenKey || ''"
        :options="individualOptions"
        :placeholder="isHostPlants ? 'Search occurrences...' : 'Search individuals...'"
        monospace
        @update:model-value="emit('select-individual', $event)"
      />
      <div v-else class="single-individual-id">
        {{ currentSpecimen?.id || 'N/A' }}
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div v-if="isHostPlants" class="sidebar-section photo-order-section">
      <div class="section-header">
        <span class="section-label">Photo order</span>
      </div>
      <div class="photo-order-list">
        <div
          v-for="(option, index) in photoOrderOptions"
          :key="option.key"
          class="photo-order-row"
          :class="`context-${option.key}`"
        >
          <span class="photo-order-name">{{ option.label }}</span>
          <div class="photo-order-actions">
            <button
              class="order-move-btn"
              :disabled="index === 0"
              title="Move earlier"
              @click="emit('move-photo-order', option.key, -1)"
            >
              ↑
            </button>
            <button
              class="order-move-btn"
              :disabled="index === photoOrderOptions.length - 1"
              title="Move later"
              @click="emit('move-photo-order', option.key, 1)"
            >
              ↓
            </button>
          </div>
        </div>
      </div>
      <select
        class="date-order-select"
        :value="dateOrder"
        @change="emit('set-date-order', $event.target.value)"
      >
        <option value="desc">Newest first</option>
        <option value="asc">Oldest first</option>
      </select>
    </div>

    <div v-if="isHostPlants" class="sidebar-divider"></div>

    <!-- Details Section -->
    <div class="sidebar-details">
      <!-- Observation Date -->
      <div v-if="currentSpecimen?.observation_date" class="detail-row">
        <span class="detail-label">Date:</span>
        <span class="detail-value">{{ currentSpecimen.observation_date }}</span>
      </div>

      <div v-if="isHostPlants && currentSpecimen?.host_taxon_rank" class="detail-row">
        <span class="detail-label">Rank:</span>
        <span class="detail-value">{{ currentSpecimen.host_taxon_rank }}</span>
      </div>

      <div v-if="isHostPlants && currentSpecimen?.host_family" class="detail-row">
        <span class="detail-label">Family:</span>
        <span class="detail-value">{{ currentSpecimen.host_family }}</span>
      </div>

      <div v-if="isHostPlants && currentSpecimen?.duplicate_image_record_count > 1" class="detail-row">
        <span class="detail-label">Image:</span>
        <span class="detail-value">{{ currentSpecimen.duplicate_image_record_count }} records share this image</span>
      </div>

      <div v-if="isHostPlants && hostButterflySummary" class="detail-row">
        <span class="detail-label">Hosts:</span>
        <span class="detail-value">{{ hostButterflySummary }}</span>
      </div>

      <!-- Mimicry Ring -->
      <div v-if="!isHostPlants && currentSpecimen?.mimicry_ring && currentSpecimen.mimicry_ring !== 'Unknown'" class="detail-row">
        <span class="detail-label">Mimicry:</span>
        <span class="detail-value">{{ currentSpecimen.mimicry_ring }}</span>
      </div>

      <!-- Source -->
      <div class="detail-row">
        <span class="detail-label">Source:</span>
        <span class="detail-value">{{ currentSpecimen?.source || 'Unknown' }}</span>
      </div>

      <!-- Status -->
      <div v-if="!isHostPlants" class="detail-row">
        <span class="detail-label">Status:</span>
        <span
          class="detail-value status-badge"
          :style="{ color: STATUS_COLORS[currentSpecimen?.sequencing_status] || '#6b7280' }"
        >
          <span class="status-dot" :style="{ background: STATUS_COLORS[currentSpecimen?.sequencing_status] || '#6b7280' }"></span>
          {{ currentSpecimen?.sequencing_status || 'Unknown' }}
        </span>
      </div>

      <!-- Country -->
      <div v-if="currentSpecimen?.country && currentSpecimen.country !== 'Unknown'" class="detail-row">
        <span class="detail-label">Country:</span>
        <span class="detail-value">{{ currentSpecimen.country }}</span>
      </div>

      <!-- Location -->
      <div v-if="locationName" class="detail-row">
        <span class="detail-label">Location:</span>
        <span class="detail-value location-name">{{ locationName }}</span>
      </div>

      <!-- Coordinates -->
      <div v-if="coordinates" class="detail-row">
        <span class="detail-label">Coords:</span>
        <span class="detail-value coords">{{ coordinates.lat.toFixed(4) }}, {{ coordinates.lng.toFixed(4) }}</span>
      </div>

      <!-- Observation URL Link -->
      <a
        v-if="currentSpecimen?.observation_url"
        :href="currentSpecimen.observation_url"
        target="_blank"
        rel="noopener noreferrer"
        class="observation-link"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        <span v-if="currentSpecimen?.source === 'iNaturalist'">View on iNaturalist</span>
        <span v-else>View on GBIF</span>
      </a>

      <!-- View on Map Button -->
      <button
        v-if="coordinates"
        class="view-on-map-btn"
        @click="emit('view-on-map')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        View on Map
      </button>
    </div>

    <div class="sidebar-divider"></div>

    <!-- Search Summary -->
    <div class="search-summary">
      <div class="summary-title">Search Summary</div>
      <div class="summary-stats-grid">
        <div class="stat-row">
          <span class="stat-label">{{ isHostPlants ? 'Host taxa:' : 'Species:' }}</span>
          <span class="stat-value">{{ totalSpecies }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">{{ isHostPlants ? 'Occurrence sets:' : 'Subspecies:' }}</span>
          <span class="stat-value">{{ totalSubspeciesCount }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">With images:</span>
          <span class="stat-value">{{ totalIndividuals }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Without images:</span>
          <span class="stat-value">{{ allFilteredWithoutImages }}</span>
        </div>
        <div class="stat-row total-row">
          <span class="stat-label">{{ isHostPlants ? 'Total records:' : 'Total individuals:' }}</span>
          <span class="stat-value">{{ allFilteredTotal }}</span>
        </div>
      </div>
    </div>

    <!-- Image Cache -->
    <div class="sidebar-section collapsible-section">
      <button class="collapse-toggle"
        @click="showImageCache = !showImageCache"
        :class="{ expanded: showImageCache }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
        Image cache
      </button>
      <div v-show="showImageCache" class="collapse-content">
        <label class="proxy-option" v-for="opt in proxyOptions" :key="opt.value">
          <input type="radio" name="gallery-proxy-mode"
            :value="opt.value"
            :checked="proxyState.mode.value === opt.value"
            @change="setProxyMode(opt.value)" />
          <div class="proxy-option-content">
            <div class="proxy-option-header">
              <span class="proxy-option-name">{{ opt.label }}</span>
              <span v-if="opt.value !== 'auto'" class="proxy-status-dot"
                    :class="statusClass(opt.value)" />
            </div>
            <small class="proxy-option-desc">{{ opt.desc }}</small>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-sidebar {
  width: 340px;
  min-width: 340px;
  flex-shrink: 0;
  background: #1a1a2e;
  border-right: 1px solid #3d3d5c;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.photo-order-section {
  gap: 8px;
}

.photo-order-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.photo-order-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-left-width: 3px;
  border-radius: 6px;
}

.photo-order-row.context-field {
  border-left-color: #4ade80;
}

.photo-order-row.context-ambiguous {
  border-left-color: #60a5fa;
}

.photo-order-row.context-preserved {
  border-left-color: #facc15;
}

.photo-order-name {
  color: #e0e0e0;
  font-size: 0.78rem;
  line-height: 1.2;
}

.photo-order-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.order-move-btn {
  width: 26px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  cursor: pointer;
}

.order-move-btn:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.order-move-btn:disabled {
  opacity: 0.28;
  cursor: default;
}

.date-order-select {
  width: 100%;
  min-height: 34px;
  padding: 7px 9px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.78rem;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
}

.gallery-mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  background: rgba(10, 10, 24, 0.35);
  border: 1px solid #3d3d5c;
  border-radius: 8px;
}

.mode-btn {
  min-height: 42px;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #aaa;
  font-size: 0.9rem;
  cursor: pointer;
}

.mode-btn.active {
  background: #4ade80;
  color: #111827;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.count-badge {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 20px;
  text-align: center;
}

.section-label {
  font-size: 0.7rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-select {
  width: 100%;
  padding: 8px 10px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.8rem;
  font-style: italic;
  cursor: pointer;
  transition: all 0.2s;
}

.sidebar-select:hover {
  border-color: #5d5d7c;
}

.sidebar-select:focus {
  outline: none;
  border-color: #4ade80;
  box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.15);
}

.sidebar-select.individual-select {
  font-style: normal;
  font-family: monospace;
}

.single-individual-id {
  padding: 8px 10px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #14b8a6;
  font-size: 0.8rem;
  font-family: monospace;
}

.sidebar-divider {
  height: 1px;
  background: #3d3d5c;
  margin: 4px 0;
}

.sidebar-details {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.75rem;
}

.detail-label {
  color: #888;
  flex-shrink: 0;
  min-width: 50px;
}

.detail-value {
  color: #e0e0e0;
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

.observation-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(74, 222, 128, 0.1);
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 5px;
  color: #4ade80;
  font-size: 0.75rem;
  text-decoration: none;
  transition: all 0.2s;
  cursor: pointer;
}

.observation-link:hover {
  background: rgba(74, 222, 128, 0.2);
  border-color: rgba(74, 222, 128, 0.5);
  color: #86efac;
}

.observation-link svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.view-on-map-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 5px;
  color: #60a5fa;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.view-on-map-btn:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: rgba(59, 130, 246, 0.6);
  color: #93c5fd;
}

.view-on-map-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.location-name {
  font-style: italic;
}

.coords {
  font-family: monospace;
  font-size: 0.7rem;
}

.search-summary {
  background: rgba(74, 222, 128, 0.05);
  border: 1px solid rgba(74, 222, 128, 0.15);
  border-radius: 6px;
  padding: 10px;
}

.summary-title {
  font-size: 0.7rem;
  color: #4ade80;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.summary-stats-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
}

.stat-row .stat-label {
  color: #888;
}

.stat-row .stat-value {
  color: #4ade80;
  font-weight: 600;
}

.stat-row.total-row {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(74, 222, 128, 0.15);
}

.stat-row.total-row .stat-value {
  font-size: 0.9rem;
}

/* Collapsible Section */
.collapsible-section {
  border-top: 1px solid #3d3d5c;
  padding-top: 8px;
}

.collapse-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  background: none;
  border: none;
  color: #aaa;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
}

.collapse-toggle:hover { color: #e0e0e0; }

.collapse-toggle svg {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.collapse-toggle.expanded svg {
  transform: rotate(90deg);
}

.collapse-content {
  padding-top: 4px;
}

/* Proxy Options */
.proxy-option {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
}

.proxy-option:hover {
  background: rgba(255, 255, 255, 0.05);
}

.proxy-option input[type="radio"] {
  margin-top: 3px;
  accent-color: #4ade80;
  cursor: pointer;
}

.proxy-option-name {
  font-size: 0.78rem;
  color: #e0e0e0;
}

.proxy-option-desc {
  font-size: 0.68rem;
  color: #888;
  display: block;
  margin-top: 1px;
}

.proxy-option-header {
  display: flex;
  align-items: center;
  gap: 5px;
}

.proxy-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.status-ok { background: #4ade80; }
.status-blocked { background: #ef4444; }
.status-unknown { background: #666; }

/* Close button only shown in the mobile drawer */
.gallery-sidebar-close {
  display: none;
}

/* Responsive: the sidebar becomes a slide-in drawer instead of being hidden,
   so all gallery filters/search/details stay available on mobile. */
@media (max-width: 768px) {
  .gallery-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 60;
    width: min(86vw, 360px);
    max-width: 360px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 28px rgba(0, 0, 0, 0.5);
  }

  .gallery-sidebar--open {
    transform: translateX(0);
  }

  /* The mode toggle is surfaced outside the drawer on mobile, so hide the
     in-drawer copy to avoid duplication. */
  .gallery-sidebar .gallery-mode-toggle {
    display: none;
  }

  .gallery-sidebar-close {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--color-border, #3d3d5c);
    border-radius: 8px;
    background: var(--color-bg-primary, #1a1a2e);
    color: var(--color-text-secondary, #aaa);
    cursor: pointer;
    z-index: 2;
  }

  .gallery-sidebar-close svg {
    width: 18px;
    height: 18px;
  }
}
</style>
