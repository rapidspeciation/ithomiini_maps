<script setup>
import { ref, shallowRef, computed, onMounted, provide, watch } from 'vue'
import { useDataStore } from './stores/data'
import { usePlanningStore } from './stores/planning'
import { useMobileLayout } from './composables/useMobileLayout'
import Sidebar from './components/Sidebar.vue'
import MapEngine from './components/MapEngine.vue'
import DataTable from './components/DataTable.vue'
import ExportPanel from './components/ExportPanel.vue'
import MimicrySelector from './components/MimicrySelector.vue'
import ImageGallery from './components/ImageGallery.vue'
import CommandPaletteDialog from './components/sidebar/CommandPaletteDialog.vue'
import { exportForR } from './utils/rExport'
import { captureMapImage } from './utils/mapImageExport'
import { buildExportResult, describeURLParams } from './utils/exportMetadata'
import { runConsistentExport } from './utils/scriptedExport'
import { MAP_STYLES } from './utils/mapStyles'
import { useLegendStore } from './stores/legend'
import { checkAllTiers, extractGoogleDriveFileId } from './utils/imageProxy'
import { log } from './utils/logger'
import { searchWithView } from './utils/viewParam'

const store = useDataStore()
const mobileLayout = useMobileLayout()
provide('mobileLayout', mobileLayout)
const { isMobile } = mobileLayout

const showMobileSidebar = ref(false)
const planning = usePlanningStore()
watch(() => planning.showComparison, visible => {
  if (visible && isMobile.value) showMobileSidebar.value = false
})
const commandPaletteRef = ref(null)

// View state
const currentView = ref('map') // 'map' or 'table'

// «7,850 of 7,850 records» for the phone map, as in the sidebar's banner.
const phoneRecordCount = computed(() => {
  const total = store.allFeatures.length
  const shown = store.filteredGeoJSON?.features.length ?? 0
  return { text: `${shown.toLocaleString()} of ${total.toLocaleString()} records`, filtered: shown < total }
})

// Modal states
const showExportPanel = ref(false)
const showMimicrySelector = ref(false)
const showImageGallery = ref(false)
const exportPanelInitialTab = ref('export') // 'export' for data, 'citation' for citation

// Map reference for export
const mapRef = shallowRef(null)
const mapEngineRef = ref(null)

// View control
const setView = (view) => {
  currentView.value = view
  // Shared links open the view they were copied from.
  const search = searchWithView(window.location.search, view)
  if (search !== window.location.search) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
  }
}

// Modal controls
const openExport = () => {
  exportPanelInitialTab.value = 'export'
  showExportPanel.value = true
}
const directExportForR = async () => {
  if (!mapRef.value) {
    alert('Map not available. Please ensure you are on the Map view.')
    return
  }
  try {
    await exportForR(mapRef.value)
  } catch (e) {
    log.export.error('[Export] R export failed:', e)
    alert('Export failed: ' + e.message)
  }
}
const closeExport = () => { showExportPanel.value = false }

const openMimicrySelector = () => { showMimicrySelector.value = true }
const closeMimicrySelector = () => { showMimicrySelector.value = false }

const imageGalleryMode = ref('butterflies')
const openImageGallery = (mode = 'butterflies') => {
  imageGalleryMode.value = mode === 'host-plants' ? 'host-plants' : 'butterflies'
  showImageGallery.value = true
}
const closeImageGallery = () => { showImageGallery.value = false }

// One capture path for the Export Image button and window.ithomiiniMapsExport().
const renderMapImage = (options) => captureMapImage(mapRef.value, { ...store.exportSettings }, options)

// Capture is serialized so concurrent clicks cannot race pixel ratio restoration.
const isExportingMap = ref(false)
const directExportMap = async () => {
  if (isExportingMap.value) return
  if (!mapRef.value || currentView.value !== 'map') {
    alert('Open the map view before exporting an image.')
    return
  }
  isExportingMap.value = true
  try {
    const { blob, width, height, format } = await renderMapImage()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `wings_atlas_map_${width}x${height}_${Date.now()}.${format}`
    link.href = url
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    log.export.error('Image export failed:', error)
    alert('Export failed: ' + error.message)
  } finally {
    isExportingMap.value = false
  }
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
  reader.onerror = () => reject(reader.error || new Error('The picture could not be read.'))
  reader.readAsDataURL(blob)
})

/**
 * ?export=1 only: the picture the Export Image button would download, as
 * base64, with what it shows (docs/field-sites.md). Waits for its own readiness.
 */
const linkParams = describeURLParams(window.location.search, { styleKeys: Object.keys(MAP_STYLES) })
let pendingExport = null
// Store state the picture depends on; any change bumps the counter (sync, so a change
// and its undo during one capture still count).
let storeChanges = 0
if (store.exportMode) {
  const legendStore = useLegendStore()
  watch(() => [store.displayGeoJSON, store.colorPlan, store.colorBy, store.colorByAttribute, store.basemap,
    JSON.stringify(store.filters), legendStore.hiddenItems.join('\u0000')], () => { storeChanges++ }, { flush: 'sync' })
}
const exportForScript = async () => {
  const deadline = performance.now() + 40000
  while (store.loading || !store.allFeatures.length || store.sourceLoading.size > 0 || !mapRef.value || !mapEngineRef.value) {
    if (performance.now() > deadline) throw new Error('The map data did not finish loading for export.')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (currentView.value !== 'map') setView('map')
  const engine = mapEngineRef.value
  const { output, snapshot, attempts } = await runConsistentExport({
    prepare: () => engine.prepareExport({ timeoutMs: Math.max(1000, deadline - performance.now()) }),
    capture: hooks => renderMapImage(hooks),
    version: () => `${storeChanges}|${engine.exportStateVersion()}`,
    // Every field, read together at the captured state; nothing is read after the capture.
    snapshot: async () => {
      const state = await engine.collectExportState()
      const hidden = new Set(useLegendStore().hiddenItems)
      const features = (store.displayGeoJSON?.features || []).filter(f => !hidden.has(f.properties[store.colorByAttribute]))
      return buildExportResult({
        pngBase64: null, width: null, height: null,
        params: linkParams,
        basemap: state.basemap,
        colorBy: store.colorBy,
        title: state.title,
        titleTruncated: state.titleTruncated,
        view: state.view,
        features,
        plan: store.colorPlan,
        legendTruncated: state.legendTruncated,
        markers: state.markers,
        labels: state.labels,
        overlays: state.overlays,
        project: state.project,
        legendPlacement: state.legendPlacement,
      })
    },
  })
  return { ...snapshot, png_base64: await blobToBase64(output.blob), width: output.width, height: output.height,
    capture_attempts: attempts }
}
if (store.exportMode) {
  window.ithomiiniMapsExport = () => {
    pendingExport ??= exportForScript().finally(() => { pendingExport = null })
    return pendingExport
  }
}

// Receive map instance from MapEngine
const onMapReady = (map) => {
  mapRef.value = map
}

// Provide modal openers to children
provide('openMimicrySelector', openMimicrySelector)
provide('openImageGallery', openImageGallery)
provide('openExport', openExport)
provide('directExportMap', directExportMap)
provide('setView', setView)

onMounted(async () => {
  await store.loadMapData()

  // Probe all 3 image tiers using the first available Drive file ID
  const firstWithImage = store.allFeatures.find(f => f.image_url)
  if (firstWithImage) {
    const fileId = extractGoogleDriveFileId(firstWithImage.image_url)
    if (fileId) checkAllTiers(fileId)
  }

  // Check URL for view param
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') === 'table') {
    currentView.value = 'table'
  }
})
</script>

<template>
  <div class="app-container">
    <!-- Sidebar with filters -->
    <Sidebar
      @open-export="openExport"
      @open-mimicry="openMimicrySelector"
      @open-gallery="openImageGallery"
      @open-map-export="directExportMap"
      @export-for-r="directExportForR"
      @open-global-search="commandPaletteRef?.open()"
      :current-view="currentView"
      @set-view="setView"
    />
    
    <!-- Main content area -->
    <main class="main-content">
      <!-- View Toggle (visible on mobile) -->
      <div class="view-toggle-bar">
        <button 
          :class="{ active: currentView === 'map' }"
          @click="setView('map')"
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
          @click="setView('table')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
          Table
        </button>
        <button 
          class="btn-gallery-mobile"
          @click="openImageGallery"
          title="Open Gallery"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
        <button 
          class="btn-export-mobile"
          @click="openExport"
          title="Export Data"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
      </div>

      <!-- Loading state -->
      <div v-if="store.loading" class="loading-overlay">
        <div class="loading-content">
          <div class="spinner"></div>
          <p class="loading-text">Loading distribution data...</p>
          <p class="loading-subtext">Preparing records</p>
        </div>
      </div>

      <!-- Map View -->
      <MapEngine
        ref="mapEngineRef"
        v-show="!store.loading && currentView === 'map'"
        class="view-container"
        @map-ready="onMapReady"
        @open-gallery="openImageGallery"
      />

      <!-- Table View -->
      <DataTable 
        v-if="!store.loading && currentView === 'table'"
        class="view-container"
      />
    </main>

    <!-- MODALS -->
    
    <!-- Export Panel Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div 
          v-if="showExportPanel" 
          class="modal-overlay"
          @click.self="closeExport"
        >
          <ExportPanel :map="mapRef" :initial-tab="exportPanelInitialTab" @close="closeExport" />
        </div>
      </Transition>
    </Teleport>

    <!-- Mimicry Selector Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showMimicrySelector"
          class="modal-overlay"
          @click.self="closeMimicrySelector"
        >
          <MimicrySelector @close="closeMimicrySelector" />
        </div>
      </Transition>
    </Teleport>

    <!-- Image Gallery (Full screen) -->
    <Teleport to="body">
      <Transition name="fade">
        <ImageGallery 
          v-if="showImageGallery" 
          :initial-mode="imageGalleryMode"
          @close="closeImageGallery" 
        />
      </Transition>
    </Teleport>

    <!-- Command Palette Dialog (Ctrl+K / Cmd+K) -->
    <CommandPaletteDialog ref="commandPaletteRef" />

    <!-- Mobile: floating menu button + quick action pills -->
    <template v-if="isMobile">
      <button
        v-show="!showMobileSidebar"
        class="mobile-menu-btn"
        @click="showMobileSidebar = true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        <span>Menu</span>
      </button>

      <!-- Mobile sidebar overlay (reuses desktop Sidebar) -->
      <Transition name="mobile-sidebar">
        <div v-if="showMobileSidebar" class="mobile-sidebar-overlay" @click.self="showMobileSidebar = false">
          <aside class="mobile-sidebar-panel">
            <!-- Close sits in the top-right corner, above the Smart Search
                 tile; the header is padded so nothing is covered. -->
            <button class="mobile-sidebar-close" @click="showMobileSidebar = false" aria-label="Close menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <Sidebar
              :current-view="currentView"
              @set-view="(v) => { setView(v); showMobileSidebar = false }"
              @open-export="() => { openExport(); showMobileSidebar = false }"
              @open-mimicry="() => { openMimicrySelector(); showMobileSidebar = false }"
              @open-gallery="() => { openImageGallery(); showMobileSidebar = false }"
              @open-map-export="() => { directExportMap(); showMobileSidebar = false }"
              @export-for-r="() => { directExportForR(); showMobileSidebar = false }"
              @open-global-search="() => { showMobileSidebar = false; commandPaletteRef?.open() }"
            />
          </aside>
        </div>
      </Transition>

      <!-- Phones: how many records the map shows (the count and filters otherwise live only in the Menu) -->
      <button
        v-if="currentView === 'map' && !store.exportSettings.enabled && !showMobileSidebar && !showImageGallery"
        type="button"
        class="mobile-record-count"
        :class="{ 'is-filtered': phoneRecordCount.filtered }"
        :aria-label="`${phoneRecordCount.text}. Open the menu to change filters`"
        @click="showMobileSidebar = true"
      >
        {{ phoneRecordCount.text }}
      </button>

      <!-- Mobile quick actions (top bar; replaces the location search row) -->
      <div class="mobile-quick-bar" :class="{ 'mobile-quick-bar--hidden': showMobileSidebar || showImageGallery }">
        <template v-if="!store.exportSettings.enabled">
          <button class="mobile-pill" :class="{ 'mobile-pill--active': currentView === 'map' }" @click="setView('map')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
            <span>Map</span>
          </button>
          <button class="mobile-pill" :class="{ 'mobile-pill--active': currentView === 'table' }" @click="setView('table')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            <span>Table</span>
          </button>
          <button class="mobile-pill" @click="openImageGallery">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Gallery</span>
          </button>
          <button class="mobile-pill" @click="commandPaletteRef?.open()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>Search</span>
          </button>
          <button class="mobile-pill" @click="openMimicrySelector">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/><path d="M12 8v8m-4-4h8"/></svg>
            <span>Mimicry</span>
          </button>
          <button class="mobile-pill" @click="store.exportSettings.enabled = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Export</span>
          </button>
        </template>
        <template v-else>
          <button class="mobile-pill mobile-pill--close" @click="store.exportSettings.enabled = false" aria-label="Close export preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button class="mobile-pill mobile-pill--primary" @click="directExportMap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download</span>
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style>
/* Global Reset */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.main-content {
  flex: 1;
  min-width: 0;
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
}

.view-container {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
}

/* View Toggle Bar (Desktop: hidden in sidebar, Mobile: visible) */
.view-toggle-bar {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
}

.view-toggle-bar button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.view-toggle-bar button:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.view-toggle-bar button.active {
  background: var(--color-accent);
  color: var(--color-on-accent);
  border-color: var(--color-accent);
}

.view-toggle-bar button svg {
  width: 16px;
  height: 16px;
}

.btn-gallery-mobile {
  margin-left: auto;
}

.btn-export-mobile {
  margin-left: 4px;
}

/* Loading Overlay */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 100%);
  z-index: 100;
}

.loading-content {
  text-align: center;
}

.spinner {
  width: 60px;
  height: 60px;
  margin: 0 auto 24px;
  border: 3px solid rgb(var(--color-text-primary-rgb) / 0.1);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  font-size: 1.2em;
  color: var(--color-text-primary);
  margin-bottom: 8px;
}

.loading-subtext {
  font-size: 0.9em;
  color: var(--color-text-muted);
}

/* Modal Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

/* Modal Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active > *,
.modal-leave-active > * {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > *,
.modal-leave-to > * {
  transform: scale(0.95) translateY(20px);
  opacity: 0;
}

/* Fade transition for gallery */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Responsive Layout */
@media (max-width: 768px) {
  .app-container {
    flex-direction: column;
  }

  .app-container > aside.sidebar {
    display: none;
  }

  .view-toggle-bar {
    display: none;
  }

  .main-content {
    height: 100vh;
  }

  /* Position map top-left controls to the right of the Menu button */
  .map-layer-controls {
    left: 112px !important;
    top: 10px !important;
    margin-top: 0 !important;
  }

  /* The location geocoder is replaced by the top quick-action bar on mobile.
     Its functionality remains available via the menu and Smart Search. */
  .location-search {
    display: none !important;
  }

  /* The quick-action bar now lives at the top, so the scale bar and
     attribution can sit at the bottom without being covered. */
  .maplibregl-ctrl-bottom-left,
  .maplibregl-ctrl-bottom-right {
    bottom: 6px !important;
  }

  /* Table view: its header has real controls, so offset it below the fixed
     top action bar (the map view floats the bar over the canvas instead). */
  .data-table-container {
    padding-top: 104px;
  }

  /* Compact attribution so it doesn't clip */
  .maplibregl-ctrl-attrib {
    max-width: calc(100vw - 140px) !important;
    font-size: 10px !important;
  }
}

/* Mobile menu button */
.mobile-menu-btn {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 14px 8px 10px;
  border: 1px solid rgb(var(--color-text-primary-rgb) / 0.12);
  border-radius: 10px;
  background: rgb(var(--color-bg-primary-rgb) / 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--color-text-primary);
  font-size: 0.82rem;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: all 0.2s;
}

.mobile-menu-btn svg {
  width: 18px;
  height: 18px;
}

.mobile-menu-btn:active {
  transform: scale(0.96);
}

/* Close button in the panel's top-right corner, above the Smart Search tile */
.mobile-sidebar-close {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid rgb(var(--color-text-primary-rgb) / 0.14);
  border-radius: 10px;
  background: rgb(var(--color-bg-primary-rgb) / 0.7);
  color: var(--color-text-primary);
  cursor: pointer;
}

.mobile-sidebar-close svg {
  width: 20px;
  height: 20px;
}

.mobile-sidebar-close:active {
  transform: scale(0.96);
}

/* Pad the sidebar header on mobile so the logo and Smart Search sit below the
   close button rather than under it. */
.mobile-sidebar-panel .sidebar-header {
  padding-top: 56px;
}

/* Mobile sidebar overlay */
.mobile-sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
}

.mobile-sidebar-panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(85vw, 400px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--color-bg-secondary);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
}

.mobile-sidebar-panel > .sidebar {
  position: static !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  min-height: 100% !important;
  max-height: none !important;
  font-size: 1.05rem;
}

.mobile-sidebar-enter-active,
.mobile-sidebar-leave-active {
  transition: opacity 0.25s ease;
}

.mobile-sidebar-enter-active .mobile-sidebar-panel,
.mobile-sidebar-leave-active .mobile-sidebar-panel {
  transition: transform 0.25s ease;
}

.mobile-sidebar-enter-from,
.mobile-sidebar-leave-to {
  opacity: 0;
}

.mobile-sidebar-enter-from .mobile-sidebar-panel,
.mobile-sidebar-leave-to .mobile-sidebar-panel {
  transform: translateX(-100%);
}

/* Phones: record count under the pill row, left of the map controls */
.mobile-record-count {
  position: fixed;
  top: 106px;
  left: 10px;
  /* Under the Field sites and detail panels (25, 35), which open over it. */
  z-index: 20;
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--color-border-control);
  border-radius: 999px;
  background: var(--color-bg-overlay);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 8px var(--color-shadow-color);
}

.mobile-record-count.is-filtered {
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Mobile quick action pills (top bar, horizontally scrollable) */
.mobile-quick-bar {
  position: fixed;
  top: 56px;
  left: 10px;
  right: 10px;
  z-index: 100;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  /* The row scrolls sideways: fade its right end so cut-off pills read as «more». */
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  scrollbar-width: none;
  -ms-overflow-style: none;
  transition: opacity 0.2s, transform 0.2s;
}

.mobile-quick-bar::-webkit-scrollbar {
  display: none;
}

.mobile-quick-bar--hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-8px);
}

.mobile-pill--active {
  background: var(--color-accent);
  color: var(--color-on-accent);
  border-color: var(--color-accent);
}

.mobile-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--color-text-primary-rgb) / 0.18);
  border-radius: 999px;
  background: rgb(var(--color-bg-primary-rgb) / 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--color-text-primary);
  font-size: 0.78rem;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.15s;
}

.mobile-pill:active {
  transform: scale(0.96);
}

.mobile-pill svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.mobile-pill--primary {
  background: var(--color-accent);
  color: var(--color-on-accent);
  border-color: var(--color-accent);
}

.mobile-pill--close {
  padding: 8px 10px;
}
</style>
