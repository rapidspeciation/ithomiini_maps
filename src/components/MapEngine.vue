<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDataStore } from '../stores/data'
import { useLegendStore } from '../stores/legend'
import PointPopup from './PointPopup.vue'
import PlantPopup from './PlantPopup.vue'
import { Legend } from './Legend'
import { ASPECT_RATIOS } from '../utils/constants'
import {
  MAP_STYLES,
  getStylesByTheme,
  getBasemapPair,
  useLocationSearch,
  useExportPreview,
  useScatterVisualization,
  useDataLayer,
  useStyleSwitcher,
  useCountryBoundaries,
  useBoundingBoxSelection
} from '../composables/useMapEngine'
import { useSDMLayer } from '../composables/useSDMLayer'
import { useHostPlantLayer } from '../composables/useHostPlantLayer'
import { useThemeStore } from '../stores/theme'
import { getThemeOptions } from '../themes/presets'
import { Sun, Moon, Palette } from 'lucide-vue-next'

const store = useDataStore()
const legendStore = useLegendStore()
const themeStore = useThemeStore()
const emit = defineEmits(['map-ready', 'open-gallery'])
const mapWrapper = ref(null) // Parent wrapper element
const mapContainer = ref(null)
const pointPopupContainer = ref(null)
const map = ref(null)
let popup = null

// Wrapper size (the available space) for accurate export preview calculations
const wrapperSize = ref({ width: 1600, height: 900 })
let wrapperResizeObserver = null
let mapContainerResizeObserver = null

// Enhanced popup state for multi-point locations
const showEnhancedPopup = ref(false)
const popupDocked = ref(false)
const enhancedPopupData = ref({
  popupType: 'point',
  coordinates: { lat: 0, lng: 0 },
  points: [],
  occurrence: null,
  taxon: null,
  isCluster: false,
  clusterStats: null
})

// Initialize composables
const {
  searchQuery,
  searchResults,
  isSearching,
  showSearchResults,
  searchInputRef,
  onSearchInput,
  selectSearchResult,
  handleClickOutside,
  clearSearch,
  cleanup: cleanupSearch
} = useLocationSearch(map)

const { legendTransformOrigin } = useExportPreview(wrapperSize)
const { updateScatterVisualization } = useScatterVisualization(map)

// Popup handler for data layer
const handleShowPopup = (data) => {
  if (popup) popup.remove()
  showEnhancedPopup.value = false

  enhancedPopupData.value = {
    popupType: data.type === 'plant' ? 'plant' : 'point',
    coordinates: data.coordinates,
    points: data.points || [],
    occurrence: data.occurrence || null,
    occurrences: data.occurrences || null,
    taxon: data.taxon || null,
    initialSpecies: data.initialSpecies || null,
    initialSubspecies: data.initialSubspecies || null,
    isCluster: data.isCluster || false,
    clusterStats: data.clusterStats || null
  }

  nextTick(() => {
    showEnhancedPopup.value = true

    if (popupDocked.value) {
      // In docked mode, pan map to show the point (offset for panel width)
      const panelWidth = 400
      const mapWidth = map.value.getContainer().clientWidth
      const offsetX = -panelWidth / 2
      map.value.easeTo({
        center: data.lngLat,
        offset: [offsetX, 0],
        duration: 300,
      })
      return
    }

    nextTick(() => {
      if (pointPopupContainer.value) {
        popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: true,
          maxWidth: '500px',
          className: 'custom-popup enhanced-popup'
        })
          .setLngLat(data.lngLat)
          .setDOMContent(pointPopupContainer.value)
          .addTo(map.value)

        popup.on('close', () => {
          showEnhancedPopup.value = false
          if (clearClusterExtentCircle) clearClusterExtentCircle()
        })
      }
    })
  })
}

const closeEnhancedPopup = () => {
  showEnhancedPopup.value = false
  if (popup) popup.remove()
  if (clearClusterExtentCircle) clearClusterExtentCircle()
}

const toggleDock = () => {
  popupDocked.value = !popupDocked.value

  if (popupDocked.value) {
    if (popup) {
      popup.remove()
      popup = null
    }
    showEnhancedPopup.value = true

    nextTick(() => {
      if (map.value && enhancedPopupData.value.coordinates) {
        const panelWidth = 340
        map.value.easeTo({
          center: [enhancedPopupData.value.coordinates.lng, enhancedPopupData.value.coordinates.lat],
          offset: [-panelWidth / 2, 0],
          duration: 300,
        })
      }
    })
  } else {
    const data = enhancedPopupData.value
    showEnhancedPopup.value = false

    nextTick(() => {
      showEnhancedPopup.value = true
      nextTick(() => {
        if (pointPopupContainer.value && map.value) {
          popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: true,
            maxWidth: '500px',
            className: 'custom-popup enhanced-popup'
          })
            .setLngLat([data.coordinates.lng, data.coordinates.lat])
            .setDOMContent(pointPopupContainer.value)
            .addTo(map.value)

          popup.on('close', () => {
            showEnhancedPopup.value = false
            if (clearClusterExtentCircle) clearClusterExtentCircle()
          })
        }
      })
    })
  }
}

const { addDataLayer, fitBoundsToData, clearClusterExtentCircle, recreateClusterExtentCircle, updateClusterExtentColors, setStyleChanging } = useDataLayer(map, { onShowPopup: handleShowPopup })
const { currentStyle, switchStyle } = useStyleSwitcher(map, addDataLayer, {
  recreateClusterExtentCircle,
  setStyleChanging,
  onStyleReady: () => {
    if (showBoundaries.value) {
      addBoundariesLayer({ fromStyleSwitch: true })
    }
    recreateBboxVisualization()
    updateHostPlantLayer()
  }
})
const { showBoundaries, toggleBoundaries, addBoundariesLayer } = useCountryBoundaries(map, currentStyle)
const { updateLayer: updateSDMLayer, cursorValue: sdmCursorValue, cursorPos: sdmCursorPos } = useSDMLayer(map)
const { updateLayer: updateHostPlantLayer } = useHostPlantLayer(map, { onShowPopup: handleShowPopup })
const {
  isDrawing: isBboxDrawing,
  enableDrawing: enableBboxDrawing,
  clearBoundingBox,
  recreateBboxVisualization,
  clearBboxVisualization
} = useBoundingBoxSelection(map)

// Helper: check if map is operational (has a parsed style we can add layers to).
// Uses getStyle() instead of isStyleLoaded() because the latter returns false
// while GeoJSON source tiles are still being processed, blocking legitimate
// data updates even though the map can accept addSource/addLayer calls.
const isMapReady = () => {
  if (!map.value) return false
  try {
    return !!map.value.getStyle()
  } catch {
    return false
  }
}

// Watch for theme/mode changes to update cluster extent circle colors
watch(
  () => [themeStore.currentTheme, themeStore.currentMode],
  () => {
    // Use nextTick to ensure CSS variables are updated
    nextTick(() => {
      if (updateClusterExtentColors) {
        updateClusterExtentColors()
      }
    })
  }
)

// Map layer dropdown
const showMapLayerDropdown = ref(false)
const stylesByTheme = getStylesByTheme()
const mapLayerDropdownRef = ref(null)

// Theme dropdown
const showThemeDropdown = ref(false)
const themeDropdownRef = ref(null)
const themeOptions = getThemeOptions()

// Select a map style from dropdown
const selectMapStyle = (styleKey) => {
  switchStyle(styleKey)
  showMapLayerDropdown.value = false
}

// Select a theme from dropdown
const selectTheme = (themeKey) => {
  themeStore.setTheme(themeKey)
  showThemeDropdown.value = false
}

// Get current theme name
const currentThemeName = computed(() => {
  return themeStore.availableThemes[themeStore.currentTheme]?.name || 'Emerald'
})

// Toggle light/dark mode and switch basemap accordingly
const toggleThemeMode = () => {
  const newMode = themeStore.isDarkMode ? 'light' : 'dark'

  // Get the paired basemap for the new mode
  const pairedBasemap = getBasemapPair(currentStyle.value, newMode)

  // Switch theme mode
  themeStore.toggleMode()

  // If basemap has a pair, switch to it (onStyleReady callback handles boundaries)
  if (pairedBasemap !== currentStyle.value) {
    switchStyle(pairedBasemap)
  }
}

// Get current style name
const currentStyleName = computed(() => {
  return MAP_STYLES[currentStyle.value]?.name || 'Dark'
})

// Close dropdown when clicking outside
const handleMapLayerClickOutside = (event) => {
  if (mapLayerDropdownRef.value && !mapLayerDropdownRef.value.contains(event.target)) {
    showMapLayerDropdown.value = false
  }
  if (themeDropdownRef.value && !themeDropdownRef.value.contains(event.target)) {
    showThemeDropdown.value = false
  }
}

// Sync legendStore showLegend with dataStore legendSettings
watch(() => store.legendSettings.showLegend, (show) => {
  legendStore.showLegend = show
}, { immediate: true })

// Compute map container styles for export aspect ratio
const mapContainerStyle = computed(() => {
  if (!store.exportSettings.enabled) {
    return {} // Full size when not in export mode
  }

  const ratio = store.exportSettings.aspectRatio
  let targetWidth, targetHeight

  if (ratio === 'custom') {
    targetWidth = store.exportSettings.customWidth
    targetHeight = store.exportSettings.customHeight
  } else if (ASPECT_RATIOS[ratio]) {
    targetWidth = ASPECT_RATIOS[ratio].width
    targetHeight = ASPECT_RATIOS[ratio].height
  } else {
    return {}
  }

  const targetAspectRatio = targetWidth / targetHeight
  const wrapperWidth = wrapperSize.value.width
  const wrapperHeight = wrapperSize.value.height
  const wrapperAspectRatio = wrapperWidth / wrapperHeight

  // Calculate actual pixel dimensions that fit within wrapper while maintaining aspect ratio
  let mapWidth, mapHeight
  if (targetAspectRatio >= wrapperAspectRatio) {
    // Target is wider - constrain by width, calculate height
    mapWidth = wrapperWidth
    mapHeight = wrapperWidth / targetAspectRatio
  } else {
    // Target is taller - constrain by height, calculate width
    mapHeight = wrapperHeight
    mapWidth = wrapperHeight * targetAspectRatio
  }

  return {
    width: `${mapWidth}px`,
    height: `${mapHeight}px`
  }
})


// Lifecycle
onMounted(() => {
  initMap()
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('click', handleMapLayerClickOutside)

  // Set up ResizeObserver on WRAPPER for calculating export preview dimensions
  if (mapWrapper.value) {
    wrapperSize.value = {
      width: mapWrapper.value.clientWidth,
      height: mapWrapper.value.clientHeight
    }

    wrapperResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        wrapperSize.value = {
          width: entry.contentRect.width,
          height: entry.contentRect.height
        }
      }
    })
    wrapperResizeObserver.observe(mapWrapper.value)
  }

  // Set up ResizeObserver on MAP CONTAINER to trigger MapLibre resize when container dimensions change
  // This is critical: MapLibre needs to resize its canvas when the container size changes
  if (mapContainer.value) {
    mapContainerResizeObserver = new ResizeObserver(() => {
      // Tell MapLibre to resize its canvas to match the new container dimensions
      if (map.value) {
        map.value.resize()
      }
    })
    mapContainerResizeObserver.observe(mapContainer.value)
  }
})

onUnmounted(() => {
  if (map.value) {
    map.value.remove()
    map.value = null
  }
  if (wrapperResizeObserver) {
    wrapperResizeObserver.disconnect()
    wrapperResizeObserver = null
  }
  if (mapContainerResizeObserver) {
    mapContainerResizeObserver.disconnect()
    mapContainerResizeObserver = null
  }
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('click', handleMapLayerClickOutside)
  cleanupSearch()
})

// Map initialization
const initMap = () => {
  const styleConfig = MAP_STYLES[currentStyle.value]

  map.value = new maplibregl.Map({
    container: mapContainer.value,
    style: styleConfig.style,
    center: [-60, -5],
    zoom: 4,
    attributionControl: false,
    maxZoom: 18,
    minZoom: 2,
    canvasContextAttributes: {
      preserveDrawingBuffer: true
    }
  })

  map.value.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.value.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }), 'bottom-right')
  map.value.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
  map.value.addControl(new maplibregl.FullscreenControl(), 'top-right')

  map.value.on('load', async () => {
    // Shape images are generated on-demand in addDataLayer
    addDataLayer()
    updateHostPlantLayer()
    updateSDMLayer()
    emit('map-ready', map.value)
  })

  // Close cluster popup when cluster data is recalculated
  // When zooming, MapLibre fires sourcedata events with tile property - we detect when
  // new tiles are loaded at a different zoom level than when popup was opened
  let clusterPopupZoom = null

  map.value.on('sourcedata', (e) => {
    if (e.sourceId !== 'points-source') return

    // If clustering is on and we have a cluster popup open, check for tile zoom changes
    if (store.clusteringEnabled && showEnhancedPopup.value && enhancedPopupData.value.isCluster) {
      if (e.tile && e.isSourceLoaded) {
        const tileZoom = e.tile.tileID?.overscaledZ
        if (clusterPopupZoom !== null && tileZoom !== clusterPopupZoom) {
          closeEnhancedPopup()
          clusterPopupZoom = null
        }
      }
    }
  })

  // Track zoom level when cluster popup opens
  watch(showEnhancedPopup, (isOpen) => {
    if (isOpen && enhancedPopupData.value.isCluster) {
      clusterPopupZoom = Math.floor(map.value.getZoom())
    } else {
      clusterPopupZoom = null
    }
  })
}

// Track previous data length to detect actual data changes
let previousDataLength = 0
let previousScatterState = false

// Handle open gallery from popup
const handleOpenGallery = (mode = 'butterflies') => {
  closeEnhancedPopup()
  emit('open-gallery', mode)
}

// Debounced addDataLayer to batch rapid successive calls
let addDataLayerTimer = null
let pendingLayerOptions = null
const debouncedAddDataLayer = (options = {}) => {
  // Merge options: skipZoom is false if ANY call wants zoom
  if (pendingLayerOptions) {
    pendingLayerOptions.skipZoom = pendingLayerOptions.skipZoom && (options.skipZoom !== false)
  } else {
    pendingLayerOptions = { ...options }
  }
  if (addDataLayerTimer) clearTimeout(addDataLayerTimer)
  addDataLayerTimer = setTimeout(() => {
    const opts = pendingLayerOptions || {}
    pendingLayerOptions = null
    addDataLayerTimer = null
    if (performance.PERF_DEBUG) console.time('[Perf] addDataLayer')
    addDataLayer(opts)
    if (performance.PERF_DEBUG) console.timeEnd('[Perf] addDataLayer')
  }, 50)
}

// Watch for displayGeoJSON changes
watch(
  () => store.displayGeoJSON,
  (newData) => {
    const newLength = newData?.features?.length || 0

    if (!isMapReady()) return

    const currentScatterState = store.scatterOverlappingPoints

    const scatterJustToggled = currentScatterState !== previousScatterState
    previousScatterState = currentScatterState

    const dataLengthChanged = newLength !== previousDataLength
    previousDataLength = newLength

    const shouldSkipZoom = !dataLengthChanged || scatterJustToggled || clusteringJustToggled

    // Reset the clustering flag after we've used it
    if (clusteringJustToggled) {
      clusteringJustToggled = false
    }

    debouncedAddDataLayer({ skipZoom: shouldSkipZoom })

    if (store.scatterOverlappingPoints) {
      updateScatterVisualization()
    }
  }
)

// Watch for scatter toggle changes
watch(
  () => store.scatterOverlappingPoints,
  () => {
    if (!isMapReady()) return
    updateScatterVisualization()
  }
)

// Track clustering toggle to prevent zoom
let clusteringJustToggled = false

// Watch clusteringEnabled to toggle clustering on/off
// Since displayGeoJSON no longer changes when clustering toggles (no pre-aggregation),
// we need to explicitly call addDataLayer here
watch(
  () => store.clusteringEnabled,
  (enabled) => {
    clusteringJustToggled = true
    if (!isMapReady()) return
    debouncedAddDataLayer({ skipZoom: true })
  },
  { flush: 'sync' }
)

// Watch for clustering settings changes (for radius, etc.)
watch(
  () => store.clusterSettings,
  () => {
    if (!isMapReady()) return
    debouncedAddDataLayer({ skipZoom: true })
  },
  { deep: true }
)

// Watch for visualization mode changes (points <-> heatmap)
watch(
  () => store.visualizationMode,
  () => {
    if (!isMapReady()) return
    debouncedAddDataLayer({ skipZoom: true })
  }
)

// Watch for heatmap settings changes
watch(
  () => store.heatmapSettings,
  () => {
    if (!isMapReady()) return
    if (store.visualizationMode === 'heatmap') {
      debouncedAddDataLayer({ skipZoom: true })
    }
  },
  { deep: true }
)

// Watch for range settings changes
watch(
  () => store.rangeSettings,
  () => {
    if (!isMapReady()) return
    if (store.visualizationMode === 'ranges') {
      debouncedAddDataLayer({ skipZoom: true })
    }
  },
  { deep: true }
)

// Watch for bounding box cleared externally (e.g., from sidebar reset)
watch(
  () => store.boundingBox,
  (val) => {
    if (!val) clearBboxVisualization()
  }
)

// Watch for styling/color/shape changes that require map layer rebuild
watch(
  [() => store.styleVersion, () => legendStore.styleVersion],
  () => {
    if (!isMapReady()) return
    debouncedAddDataLayer({ skipZoom: true })
  }
)

// Watch for focusPoint changes
watch(
  () => store.focusPoint,
  (point) => {
    if (!point || !map.value) return

    if (popup) popup.remove()
    showEnhancedPopup.value = false

    map.value.flyTo({
      center: [point.lng, point.lat],
      zoom: 12,
      duration: 1500
    })

    map.value.once('moveend', () => {
      const pointsAtLocation = store.getPointsAtCoordinates(point.lat, point.lng)

      enhancedPopupData.value = {
        coordinates: { lat: point.lat, lng: point.lng },
        points: pointsAtLocation.length > 0 ? pointsAtLocation : [point.properties],
        initialSpecies: point.properties?.scientific_name,
        initialSubspecies: point.properties?.subspecies
      }

      showEnhancedPopup.value = true

      // Wait for the popup DOM element to render before attaching to map
      nextTick(() => {
        if (pointPopupContainer.value) {
          popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: true,
            maxWidth: '500px',
            className: 'custom-popup enhanced-popup'
          })
            .setLngLat([point.lng, point.lat])
            .setDOMContent(pointPopupContainer.value)
            .addTo(map.value)

          popup.on('close', () => {
            showEnhancedPopup.value = false
          })
        }
      })

      store.focusPoint = null
    })
  }
)
</script>

<template>
  <div ref="mapWrapper" class="map-wrapper" :class="{ 'export-mode': store.exportSettings.enabled, 'panel-docked': popupDocked && showEnhancedPopup }">
    <div
      ref="mapContainer"
      class="map"
      :class="{ 'map-export-preview': store.exportSettings.enabled }"
      :style="mapContainerStyle"
    >
      <!-- Legend Component (customizable, draggable) -->
      <Legend
        v-if="store.exportSettings.includeLegend || !store.exportSettings.enabled"
        :container-ref="mapContainer"
        :style="{
          transform: store.exportSettings.enabled ? 'scale(' + store.exportSettings.uiScale + ')' : 'none',
          transformOrigin: legendTransformOrigin
        }"
      />
    </div>

    <!-- Export info badge (shown when in export mode) -->
    <div v-if="store.exportSettings.enabled" class="export-info-badge">
      <span class="export-ratio">{{ store.exportSettings.aspectRatio }}</span>
      <span class="export-dimensions">{{ ASPECT_RATIOS[store.exportSettings.aspectRatio]?.width || store.exportSettings.customWidth }} × {{ ASPECT_RATIOS[store.exportSettings.aspectRatio]?.height || store.exportSettings.customHeight }}</span>
    </div>

    <!-- Popup: rendered via MapLibre popup (undocked) or right panel (docked) -->
    <div v-show="!popupDocked">
      <div ref="pointPopupContainer">
        <PointPopup
          v-if="showEnhancedPopup && !popupDocked && enhancedPopupData.popupType !== 'plant'"
          :coordinates="enhancedPopupData.coordinates"
          :points="enhancedPopupData.points"
          :initial-species="enhancedPopupData.initialSpecies"
          :initial-subspecies="enhancedPopupData.initialSubspecies"
          :is-cluster="enhancedPopupData.isCluster"
          :cluster-stats="enhancedPopupData.clusterStats"
          @close="closeEnhancedPopup"
          @open-gallery="handleOpenGallery"
          @toggle-dock="toggleDock"
        />
        <PlantPopup
          v-else-if="showEnhancedPopup && !popupDocked"
          :coordinates="enhancedPopupData.coordinates"
          :occurrence="enhancedPopupData.occurrence"
          :occurrences="enhancedPopupData.occurrences"
          :taxon="enhancedPopupData.taxon"
          @close="closeEnhancedPopup"
          @open-gallery="handleOpenGallery"
          @toggle-dock="toggleDock"
        />
      </div>
    </div>

    <!-- Docked detail panel (right sidebar) -->
    <Transition name="panel-slide">
      <div v-if="popupDocked && showEnhancedPopup" class="detail-panel-dock">
        <div class="detail-panel-header">
          <span>Detail Panel</span>
          <div class="detail-panel-actions">
            <button @click="toggleDock" class="detail-panel-btn" title="Undock to popup">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M9 3v18"/>
              </svg>
            </button>
            <button @click="closeEnhancedPopup" class="detail-panel-btn" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="detail-panel-body">
          <PointPopup
            v-if="enhancedPopupData.popupType !== 'plant'"
            :coordinates="enhancedPopupData.coordinates"
            :points="enhancedPopupData.points"
            :initial-species="enhancedPopupData.initialSpecies"
            :initial-subspecies="enhancedPopupData.initialSubspecies"
            :is-cluster="enhancedPopupData.isCluster"
            :cluster-stats="enhancedPopupData.clusterStats"
            @close="closeEnhancedPopup"
            @open-gallery="handleOpenGallery"
            @toggle-dock="toggleDock"
          />
          <PlantPopup
            v-else
            :coordinates="enhancedPopupData.coordinates"
            :occurrence="enhancedPopupData.occurrence"
            :occurrences="enhancedPopupData.occurrences"
            :taxon="enhancedPopupData.taxon"
            @close="closeEnhancedPopup"
            @open-gallery="handleOpenGallery"
            @toggle-dock="toggleDock"
          />
        </div>
      </div>
    </Transition>



    <!-- Location Search -->
    <div ref="searchInputRef" class="location-search">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search location..."
          @input="onSearchInput"
          @focus="showSearchResults = searchResults.length > 0"
          @keydown.escape="clearSearch"
        />
        <svg
          v-if="isSearching"
          class="search-spinner"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/>
        </svg>
        <button
          v-else-if="searchQuery"
          class="search-clear"
          @click="clearSearch"
          title="Clear search"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Search Results Dropdown -->
      <div v-if="showSearchResults && searchResults.length > 0" class="search-results">
        <button
          v-for="(result, index) in searchResults"
          :key="index"
          class="search-result-item"
          @click="selectSearchResult(result)"
        >
          <svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span class="result-name">{{ result.name }}</span>
        </button>
      </div>
    </div>

    <!-- Bounding Box Controls -->
    <div v-if="!store.exportSettings.enabled" class="bbox-controls">
      <button
        v-if="!store.boundingBox"
        class="bbox-draw-btn"
        :class="{ drawing: isBboxDrawing }"
        @click="enableBboxDrawing"
        :title="isBboxDrawing ? 'Drawing...' : 'Draw bounding box to filter area'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="0" ry="0" stroke-dasharray="4 2"/>
        </svg>
      </button>
      <button
        v-else
        class="bbox-clear-btn"
        @click="clearBoundingBox"
        title="Clear spatial filter"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        <span>Clear Area</span>
      </button>
    </div>

    <!-- SDM cursor value tooltip -->
    <div
      v-if="sdmCursorValue"
      class="sdm-cursor-tooltip"
      :style="{ left: (sdmCursorPos.x + 15) + 'px', top: (sdmCursorPos.y - 10) + 'px' }"
    >
      <div
        v-for="(item, index) in sdmCursorValue"
        :key="item.species"
        class="sdm-cursor-row"
        :class="index === 0 ? 'warm' : 'cool'"
      >
        <span class="sdm-cursor-dot"></span>
        <span class="sdm-cursor-species">{{ item.species }}</span>
        <span class="sdm-cursor-value">{{ (item.value * 100).toFixed(0) }}%</span>
      </div>
    </div>

    <!-- Map Layer Controls -->
    <div ref="mapLayerDropdownRef" class="map-layer-controls">
      <!-- Base Map Dropdown -->
      <div class="map-layer-dropdown">
        <button
          class="dropdown-trigger"
          @click.stop="showMapLayerDropdown = !showMapLayerDropdown"
        >
          <svg class="layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <span>{{ currentStyleName }}</span>
          <svg class="chevron" :class="{ open: showMapLayerDropdown }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <Transition name="dropdown">
          <div v-if="showMapLayerDropdown" class="dropdown-menu">
            <!-- Day Themes -->
            <div class="theme-group">
              <div class="theme-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                Day
              </div>
              <button
                v-for="style in stylesByTheme.day"
                :key="style.key"
                :class="{ active: currentStyle === style.key }"
                @click="selectMapStyle(style.key)"
              >
                {{ style.name }}
              </button>
            </div>

            <!-- Night Themes -->
            <div class="theme-group">
              <div class="theme-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
                Night
              </div>
              <button
                v-for="style in stylesByTheme.night"
                :key="style.key"
                :class="{ active: currentStyle === style.key }"
                @click="selectMapStyle(style.key)"
              >
                {{ style.name }}
              </button>
            </div>

            <!-- Divider -->
            <div class="dropdown-divider"></div>

            <!-- Overlays -->
            <div class="overlay-section">
              <label class="overlay-toggle">
                <input
                  type="checkbox"
                  :checked="showBoundaries"
                  @change="toggleBoundaries"
                />
                <span>Country Borders</span>
              </label>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Theme Dropdown -->
      <div ref="themeDropdownRef" class="theme-dropdown-container">
        <button
          class="dropdown-trigger theme-trigger"
          @click.stop="showThemeDropdown = !showThemeDropdown"
        >
          <Palette class="layer-icon" />
          <span>{{ currentThemeName }}</span>
          <svg class="chevron" :class="{ open: showThemeDropdown }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <Transition name="dropdown">
          <div v-if="showThemeDropdown" class="dropdown-menu theme-menu">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              :class="{ active: themeStore.currentTheme === option.value }"
              @click="selectTheme(option.value)"
            >
              <div
                class="theme-swatch"
                :style="{ backgroundColor: themeStore.isDarkMode ? option.previewBgDark : option.previewBgLight }"
              >
                <div
                  class="theme-swatch-accent"
                  :style="{ backgroundColor: option.accentColor }"
                />
              </div>
              <span>{{ option.label }}</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- Light/Dark Mode Toggle -->
      <button
        class="mode-toggle-btn"
        :class="{ 'is-light': !themeStore.isDarkMode }"
        @click="toggleThemeMode"
        :title="themeStore.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      >
        <Sun v-if="!themeStore.isDarkMode" class="mode-icon" />
        <Moon v-else class="mode-icon" />
      </button>
    </div>

  </div>
</template>


<style scoped src="./map-container-styles.css"></style>
