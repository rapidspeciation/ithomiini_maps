<script setup>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
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
  useDataLayer,
  useStyleSwitcher,
  useCountryBoundaries,
  useBoundingBoxSelection
} from '../composables/useMapEngine'
import { useSDMLayer } from '../composables/useSDMLayer'
import { useHostPlantLayer } from '../composables/useHostPlantLayer'
import { usePlanningStore } from '../stores/planning'
import { parseSharedMapView } from '../utils/sharedMapView'
import { EXPORT_BBOX_MAX_ZOOM, EXPORT_BBOX_PADDING, EXPORT_FRAME, exportSites, exportTitle, occlusionScore, overlayRects, parseBbox } from '../utils/exportMetadata'
import { clusterCircleRadius } from '../utils/clusterComposition'
import { MERGED_SIZE_CAP, markerSizeFactor } from '../utils/sites'
import { waitForMapIdle } from '../utils/mapImageExport'
import { readClusterLeaves } from '../utils/clusterLeaves'
import { useLocalityLayer } from '../composables/useLocalityLayer'
import { useClusterComposition } from '../composables/useClusterComposition'
import { HEATMAP_RAMPS, visibleSiteRadius } from '../composables/useDataLayer'
import SiteComparison from './SiteComparison.vue'
import { useThemeStore } from '../stores/theme'
import { getThemeOptions } from '../themes/presets'
import { Palette } from 'lucide-vue-next'
import ThemeModeSwitch from './ThemeModeSwitch.vue'
import ThemeToggleButton from './ThemeToggleButton.vue'

const store = useDataStore()
const legendStore = useLegendStore()
const planning = usePlanningStore()
const themeStore = useThemeStore()
const emit = defineEmits(['map-ready', 'open-gallery'])
const mapWrapper = ref(null) // Parent wrapper element
const mapContainer = ref(null)
const pointPopupContainer = ref(null)
// MapLibre owns its internal render state; Vue only observes replacement.
const map = shallowRef(null)
let popup = null
// Satellite imagery reads like a dark basemap for label contrast.
const isDarkBasemap = () => MAP_STYLES[currentStyle.value]?.theme === 'night' || currentStyle.value === 'satellite'
// ?export=1: site labels stay clear of the title strip, legend, scale bar and credits.
const localityLayer = useLocalityLayer(map, { isDarkBasemap, obstacles: () => (store.exportMode ? exportOverlays() : []) })
const clusterComposition = useClusterComposition(map)
const sharedView = parseSharedMapView(new URLSearchParams(window.location.search).get('map_view'))
// `bbox=w,s,e,n` frames the map once (it never filters); it wins over map_view.
const linkedBbox = parseBbox(new URLSearchParams(window.location.search).get('bbox'))
const frameFromLink = Boolean(sharedView || linkedBbox)
let mapLoaded = false
// The linked bbox keeps framing the map (e.g. once the hidden map gets its size) until the visitor moves it.
let bboxActive = Boolean(linkedBbox)
// True while fitLinkedBbox itself moves the camera, so its own moveend keeps the bbox.
let ownFit = false
const legendRef = ref(null)
let legendChoice = null
let siteRegistry = null
let layerUpdates = 0

// Wrapper size (the available space) for accurate export preview calculations
const wrapperSize = ref({ width: 1600, height: 900 })
let wrapperResizeObserver = null
let mapContainerResizeObserver = null

// Enhanced popup state for multi-point locations
const showEnhancedPopup = ref(false)
const showNoRecords = computed(() =>
  !store.loading && store.sourceLoading.size === 0 && !store.exportSettings.enabled &&
  store.filteredGeoJSON?.features?.length === 0
)
const popupDocked = ref(false)
const activeDock = computed(() => {
  if (store.exportSettings.enabled) return null
  if (planning.showComparison && !planning.comparisonMinimized) return 'comparison'
  if (popupDocked.value && showEnhancedPopup.value) return 'detail'
  return null
})
watch(activeDock, () => nextTick(() => map.value?.resize()))
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


// Keep the popup card within the map while preserving its geographic anchor.
const fitPopupToMap = (currentPopup = popup) => {
  nextTick(() => requestAnimationFrame(() => {
    if (!currentPopup || popup !== currentPopup || window.innerWidth <= 600) return
    const bounds = currentPopup.getElement().getBoundingClientRect()
    const viewport = map.value.getContainer().getBoundingClientRect()
    const overflow = (start, end, min, max) => end > max ? end - max : start < min ? start - min : 0
    const x = overflow(bounds.left, bounds.right, viewport.left + 12, viewport.right - 12)
    const y = overflow(bounds.top, bounds.bottom, viewport.top + 12, viewport.bottom - 12)
    if (x || y) map.value.panBy([x, y], { duration: 0 })
  }))
}

// Popup handler for data layer
const handleShowPopup = (data) => {
  if (popup) popup.remove()
  showEnhancedPopup.value = false
  if (popupDocked.value && planning.showComparison) planning.comparisonMinimized = true

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

        fitPopupToMap(popup)
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
    if (planning.showComparison) planning.comparisonMinimized = true
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

          fitPopupToMap(popup)
          popup.on('close', () => {
            showEnhancedPopup.value = false
            if (clearClusterExtentCircle) clearClusterExtentCircle()
          })
        }
      })
    })
  }
}

const { addDataLayer, fitBoundsToData, clearClusterExtentCircle, recreateClusterExtentCircle, updateClusterExtentColors, setStyleChanging } = useDataLayer(map, { onShowPopup: handleShowPopup, isDarkBasemap, onDataChanged: (data, sites) => {
  siteRegistry = sites
  layerUpdates++
  localityLayer.invalidate(data, sites)
  clusterComposition.invalidate(data, sites)
} })
const { currentStyle, switchStyle } = useStyleSwitcher(map, addDataLayer, {
  // Carto Positron or Dark Matter, as the page
  initialStyle: store.basemap || (themeStore.isDarkMode ? 'dark' : 'light'),
  recreateClusterExtentCircle,
  setStyleChanging,
  onStyleStart: () => invalidatePendingSDM(),
  onStyleReady: () => {
    if (showBoundaries.value) {
      addBoundariesLayer({ fromStyleSwitch: true })
    }
    recreateBboxVisualization()
    updateHostPlantLayer()
  },
  onStyleIdle: () => updateSDMLayer()
})
const { showBoundaries, toggleBoundaries, addBoundariesLayer } = useCountryBoundaries(map, currentStyle)
const { updateLayer: updateSDMLayer, invalidatePending: invalidatePendingSDM, cursorValue: sdmCursorValue, cursorPos: sdmCursorPos } = useSDMLayer(map)
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

// The heatmap key shows the ramp drawn on the current basemap (useDataLayer.js).
const densityRamp = computed(() => `linear-gradient(90deg, ${HEATMAP_RAMPS[isDarkBasemap() ? 'dark' : 'light'].slice(1).join(', ')})`)

// Map layer dropdown
const showMapLayerDropdown = ref(false)
const stylesByTheme = getStylesByTheme()
const mapLayerDropdownRef = ref(null)

// Theme dropdown
const showThemeDropdown = ref(false)
const themeDropdownRef = ref(null)
const themeOptions = getThemeOptions()

// The basemap follows light/dark until the visitor picks one in the layers menu.
const basemapChosen = ref(Boolean(store.basemap))

// Select a map style from dropdown
const selectMapStyle = (styleKey) => {
  basemapChosen.value = true
  store.basemap = styleKey
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

// Toggle light/dark mode; the watcher below swaps the basemap

// Whatever changed the mode (this button, the palette menu, Smart Search, the system), the basemap
// moves to its light or dark pair unless the visitor chose one (onStyleReady handles boundaries).
watch(() => themeStore.currentMode, (mode) => {
  if (basemapChosen.value || !map.value) return
  const pairedBasemap = getBasemapPair(currentStyle.value, mode)
  if (pairedBasemap !== currentStyle.value) switchStyle(pairedBasemap)
})

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
  // ?export=1 always uses one frame, so text has one size in every picture.
  // content-box: the map itself is 760 x 570; the preview border sits outside it.
  if (store.exportMode) return { width: `${EXPORT_FRAME.width}px`, height: `${EXPORT_FRAME.height}px`, boxSizing: 'content-box' }

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
  clusterComposition.cleanup()
  localityLayer.cleanup()
  if (addDataLayerTimer) clearTimeout(addDataLayerTimer)
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
    center: (!linkedBbox && sharedView?.center) || [-60, -5],
    zoom: (!linkedBbox && sharedView?.zoom) || 4,
    // A linked bbox is the starting camera, so tiles load once at that zoom
    // (jumping there right after the first data load broke symbol queries).
    ...(linkedBbox ? { bounds: [[linkedBbox[0], linkedBbox[1]], [linkedBbox[2], linkedBbox[3]]],
      fitBoundsOptions: linkedBboxFit() } : {}),
    attributionControl: false,
    maxZoom: 18,
    minZoom: 2,
    canvasContextAttributes: {
      preserveDrawingBuffer: true
    }
  })

  map.value.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.value.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }), 'bottom-right')
  map.value.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right')
  map.value.addControl(new maplibregl.FullscreenControl(), 'top-right')

  map.value.on('load', async () => {
    // Shape images are generated on-demand in addDataLayer
    localityLayer.attach()
    clusterComposition.attach()
    addDataLayer({ skipZoom: frameFromLink })
    mapLoaded = true
    updateHostPlantLayer()
    updateSDMLayer()
    emit('map-ready', map.value)
  })

  map.value.on('resize', () => { if (bboxActive) fitLinkedBbox({ resize: false }) })

  map.value.on('moveend', () => {
    const center = map.value.getCenter()
    const params = new URLSearchParams(window.location.search)
    // Any move but the bbox fit itself (the visitor, a fly-to, a search) ends the linked
    // frame: share where the map is now. A moveend that left the camera on the fitted
    // frame (a resize refitted by the handler above, a style switch) keeps it.
    if (bboxActive && !ownFit && !atLinkedFrame()) {
      params.delete('bbox')
      bboxActive = false
    }
    params.set('map_view', [center.lng.toFixed(5), center.lat.toFixed(5), map.value.getZoom().toFixed(2)].join(','))
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`)
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

    const dataLengthChanged = newLength !== previousDataLength
    previousDataLength = newLength

    const shouldSkipZoom = frameFromLink || !dataLengthChanged || clusteringJustToggled

    // Reset the clustering flag after we've used it
    if (clusteringJustToggled) {
      clusteringJustToggled = false
    }

    debouncedAddDataLayer({ skipZoom: shouldSkipZoom })
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

          fitPopupToMap(popup)
          popup.on('close', () => {
            showEnhancedPopup.value = false
          })
        }
      })

      store.focusPoint = null
    })
  }
)
watch([() => planning.localitySettings, () => planning.shortlistIds, () => planning.hiddenLabelIds, () => planning.selectedSiteId], () => {
  localityLayer.invalidate()
  localityLayer.refresh()
}, { deep: true })

watch(() => planning.focusRequestId, () => {
  const id = planning.selectedSiteId
  const site = planning.sites.find(s => s.id === id)
  if (!site || !map.value) return
  closeEnhancedPopup()
  map.value.flyTo({ center: site.coordinates, zoom: Math.max(map.value.getZoom(), 11), duration: 600 })
})

// Title strip of ?export=1, composed from the active filters only.
const exportTitleText = computed(() => exportTitle(store.filters))

function linkedBboxFit() {
  return { padding: EXPORT_BBOX_PADDING, maxZoom: EXPORT_BBOX_MAX_ZOOM }
}

function linkedBboxCamera() {
  const [w, s, e, n] = linkedBbox
  const camera = map.value.cameraForBounds([[w, s], [e, n]], linkedBboxFit())
  return camera ? { center: maplibregl.LngLat.convert(camera.center), zoom: camera.zoom } : null
}

/** The camera is the linked bbox's fit for the current size (true when that cannot be computed yet). */
function atLinkedFrame() {
  if (!linkedBbox || !map.value) return false
  const camera = linkedBboxCamera()
  if (!camera) return true
  const m = map.value
  const center = m.getCenter()
  return Math.abs(center.lng - camera.center.lng) < 1e-7 && Math.abs(center.lat - camera.center.lat) < 1e-7 &&
    Math.abs(m.getZoom() - camera.zoom) < 1e-4 && !m.getBearing()
}

/** Re-frame the linked bbox for the measured container, without animation, only if the camera differs. */
function fitLinkedBbox({ resize = true } = {}) {
  if (!linkedBbox || !map.value) return
  const m = map.value
  ownFit = true
  try {
    if (resize) m.resize()
    const camera = linkedBboxCamera()
    if (!camera || atLinkedFrame()) return
    m.jumpTo({ center: camera.center, zoom: camera.zoom, bearing: 0 })
  } finally {
    ownFit = false
  }
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
async function waitUntil(condition, deadline, message) {
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Site labels laid out for the current view and overlays: two clean passes after the map is idle. */
async function settleLabels(deadline) {
  // MapLibre can throw from a symbol query while a source update is still being
  // placed, so a failed pass waits and retries.
  let clean = 0
  let lastError = null
  while (clean < 2) {
    if (performance.now() > deadline) throw new Error(`The site labels did not settle for export: ${lastError?.message || 'unknown error'}`)
    await waitForMapIdle(map.value, Math.max(1000, deadline - performance.now()))
    await nextFrame()
    try {
      await localityLayer.refresh()
      clean++
    } catch (error) {
      lastError = error
      clean = 0
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}

/** How many drawn markers (and their records) the overlays cover at the current placement. */
async function currentOcclusion() {
  const state = await collectExportState()
  const { sites } = exportSites(state.markers, state.labels, null, { frame: state.view.frame, overlays: state.overlays })
  return occlusionScore(sites)
}

const LEGEND_CORNERS = ['bottom-right', 'bottom-left']
const fewerHidden = (a, b) => a.records < b.records || (a.records === b.records && a.sites < b.sites)

/**
 * ?export=1: keep the legend where it is unless it covers a drawn marker or label;
 * then try the bottom corners (the top ones would cover the title strip) and keep the
 * placement that covers the fewest records. Labels are laid out again around it.
 */
async function chooseLegendPlacement(deadline) {
  const legend = legendRef.value
  const start = legend?.exportPlacement?.()
  if (!start) { legendChoice = null; return }
  let best = { placement: start, score: await currentOcclusion() }
  let tried = 1
  if (best.score.sites > 0) {
    for (const corner of LEGEND_CORNERS) {
      legend.setExportCorner(corner)
      await nextTick()
      localityLayer.invalidate()
      await settleLabels(deadline)
      const score = await currentOcclusion()
      tried++
      if (fewerHidden(score, best.score)) best = { placement: legend.exportPlacement(), score }
      if (!score.sites) break
    }
    const now = legend.exportPlacement()
    if (now.corner !== best.placement.corner || now.x !== best.placement.x || now.y !== best.placement.y) {
      legend.restoreExportPlacement(best.placement)
      await nextTick()
      localityLayer.invalidate()
      await settleLabels(deadline)
    }
  }
  legendChoice = { corner: best.placement.corner, placements_tried: tried,
    occluded_sites: best.score.sites, occluded_records: best.score.records }
}

/**
 * Before a scripted export: style and data layer in place, linked bbox framed in
 * the current frame size, the map idle, the legend placed and site labels laid
 * out for this view.
 */
async function prepareExport({ timeoutMs = 30000 } = {}) {
  const deadline = performance.now() + timeoutMs
  await waitUntil(() => mapLoaded && isMapReady() && map.value.isStyleLoaded() && layerUpdates > 0 &&
    !addDataLayerTimer, deadline, 'The map layers did not finish loading for export.')
  fitLinkedBbox()
  await waitUntil(() => !map.value.isMoving(), deadline, 'The map did not stop moving for export.')
  // Labels avoid the overlays as they are now.
  localityLayer.invalidate()
  await settleLabels(deadline)
  if (store.exportMode) await chooseLegendPlacement(deadline)
  await nextFrame()
  await waitForMapIdle(map.value, Math.max(1000, deadline - performance.now()))
}

const OVERLAY_SELECTORS = [
  ['title', '.export-title-strip'],
  ['legend', '.legend-container'],
  ['legend', '.density-legend'],
  ['scale', '.maplibregl-ctrl-scale'],
  ['attribution', '.maplibregl-ctrl-attrib'],
]

/** Title strip, legend, scale bar and credits as boxes in CSS px of the canvas (export metadata). */
function exportOverlays() {
  const m = map.value
  if (!m) return []
  const container = m.getContainer()
  const settings = store.exportSettings
  const boxes = []
  for (const [kind, selector] of OVERLAY_SELECTORS) {
    if (kind === 'legend' && !settings.includeLegend) continue
    if (kind === 'scale' && !settings.includeScaleBar) continue
    if (kind === 'attribution' && !settings.includeAttribution) continue
    for (const node of container.querySelectorAll(selector)) {
      if (getComputedStyle(node).visibility === 'hidden') continue
      boxes.push({ kind, rect: node.getBoundingClientRect() })
    }
  }
  return overlayRects(boxes, m.getCanvas().getBoundingClientRect())
}

/** Outer radius (CSS px) of a drawn marker, as the data layer draws it, with its light halo or ring. */
function drawnMarkerRadius(kind, { sizeFactor = 1, individuals = 1 } = {}) {
  const zoom = map.value.getZoom()
  const style = { pointSize: 10, borderWidth: 0, ...store.mapStyle }
  if (kind === 'cluster') return clusterCircleRadius(individuals) + 4
  const factor = kind === 'merged'
    ? (store.sizeByIndividuals === false ? 1 : markerSizeFactor(individuals, MERGED_SIZE_CAP))
    : (Number(sizeFactor) || 1)
  return visibleSiteRadius(style, zoom, factor) + 1.5
}

/**
 * Everything the captured picture depends on that the map owns, as one string:
 * data layer updates, basemap, camera, frame, overlays, title and placed labels.
 * A different value after the capture means the picture may not match its metadata.
 */
function exportStateVersion() {
  const m = map.value
  if (!m) return ''
  const center = m.getCenter()
  const container = m.getContainer()
  return JSON.stringify([layerUpdates, currentStyle.value, center.lng, center.lat, m.getZoom(), m.getBearing(), m.getPitch(),
    container.clientWidth, container.clientHeight, exportOverlays(), exportTitleState(), localityLayer.placedLabels()])
}

function exportTitleState() {
  const strip = map.value?.getContainer().querySelector('.export-title-strip')
  if (!strip) return { title: null, truncated: false }
  return { title: strip.textContent.trim() || null, truncated: strip.scrollWidth > strip.clientWidth + 1 }
}

/** Rows hidden behind "+ N more" or the legend's scrollbar are not in the picture. */
function legendTruncated(container) {
  if (container.querySelector('.legend-container .legend-more--button')) return true
  const content = container.querySelector('.legend-container .legend-content')
  return Boolean(content && content.scrollHeight > content.clientHeight + 1)
}

/** The drawn camera, markers and labels; called by the capture once the map is settled. */
async function collectExportState() {
  const m = map.value
  const bounds = m.getBounds()
  const center = m.getCenter()
  const container = m.getContainer()
  const view = {
    bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
    center: [center.lng, center.lat],
    zoom: m.getZoom(),
    frame: { width: container.clientWidth, height: container.clientHeight },
    fit: { padding: EXPORT_BBOX_PADDING, max_zoom: EXPORT_BBOX_MAX_ZOOM },
    bbox_requested: linkedBbox,
  }
  const layers = ['points-layer', 'clusters'].filter(id => m.getLayer(id))
  const rendered = layers.length ? m.queryRenderedFeatures({ layers }) : []
  const source = m.getSource('points-source')
  const seen = new Set()
  const markers = []
  for (const feature of rendered) {
    const props = feature.properties || {}
    const isCluster = Boolean(props.cluster)
    const key = isCluster ? `c:${props.cluster_id}` : `s:${props.site_key}`
    if (seen.has(key)) continue
    seen.add(key)
    if (isCluster) {
      const leaves = await readClusterLeaves(source, props.cluster_id, props.point_count)
      const [lng, lat] = feature.geometry.coordinates
      const kind = siteRegistry?.merged ? 'merged' : 'cluster'
      const point = m.project([lng, lat])
      markers.push({ kind, id: props.cluster_id, lng, lat, x: point.x, y: point.y,
        radius: drawnMarkerRadius(kind, { individuals: Number(props.individuals ?? props.point_count) || 1 }),
        records: siteRegistry ? siteRegistry.records(leaves) : [] })
    } else {
      const site = siteRegistry?.get(props.site_key)
      if (!site) continue
      const point = m.project(site.coordinates)
      markers.push({ kind: 'site', id: site.key, lng: site.coordinates[0], lat: site.coordinates[1], x: point.x, y: point.y,
        radius: drawnMarkerRadius('site', { sizeFactor: site.sizeFactor }), records: site.records })
    }
  }
  const title = exportTitleState()
  return {
    view,
    basemap: currentStyle.value,
    markers,
    labels: localityLayer.placedLabels(),
    legendTruncated: legendTruncated(container),
    overlays: exportOverlays(),
    title: title.title,
    titleTruncated: title.truncated,
    legendPlacement: legendChoice,
    // Recorded lng/lat to CSS px of the canvas, at this camera.
    project: lngLat => m.project(lngLat),
  }
}

defineExpose({ prepareExport, collectExportState, exportStateVersion })
</script>

<template>
  <div ref="mapWrapper" class="map-wrapper" :class="{ 'export-mode': store.exportSettings.enabled, 'panel-docked': !!activeDock, 'comparison-docked': activeDock === 'comparison' }">
    <div
      ref="mapContainer"
      class="map"
      :class="{ 'map-export-preview': store.exportSettings.enabled }"
      :style="mapContainerStyle"
    >
      <div v-if="store.visualizationMode === 'heatmap' && (store.exportSettings.includeLegend || !store.exportSettings.enabled)" class="density-legend" role="note" title="Relative to the filtered records, not abundance">
        <strong>Record density</strong>
        <div class="density-ramp" :style="{ background: densityRamp }"></div><div class="density-scale"><span>Lower</span><span>Higher</span></div>
      </div>
      <div v-if="store.exportMode" class="export-title-strip">{{ exportTitleText }}</div>
      <!-- Legend Component (customizable, draggable) -->
      <Legend
        v-if="store.exportSettings.includeLegend || !store.exportSettings.enabled"
        ref="legendRef"
        :container-ref="mapContainer"
      />
    </div>

    <SiteComparison v-if="!store.exportSettings.enabled" />

    <div v-if="showNoRecords" class="map-empty-notice" role="status">
      <span>No records match these filters.</span>
      <button type="button" @click="store.resetAllFilters">Reset filters</button>
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
          @focus-site="planning.focusSite"
          @layout-change="fitPopupToMap()"
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
          @focus-site="planning.focusSite"
        />
      </div>
    </div>

    <!-- Docked detail panel (right sidebar) -->
    <Transition name="panel-slide">
      <div v-if="activeDock === 'detail'" class="detail-panel-dock">
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
            @focus-site="planning.focusSite"
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
            @focus-site="planning.focusSite"
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
          aria-label="Search location"
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
          :aria-label="`Basemap: ${currentStyleName}`"
          :aria-expanded="showMapLayerDropdown"
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
          :aria-label="`Colour palette and light/dark: ${currentThemeName}`"
          :aria-expanded="showThemeDropdown"
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
            <ThemeModeSwitch />
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
      <ThemeToggleButton class="mode-toggle-btn" />
    </div>

  </div>
</template>


<style scoped src="./map-container-styles.css"></style>

<style scoped>
.density-legend { position: absolute; z-index: 3; bottom: 64px; right: 10px; width: 168px; padding: 8px 10px; border-radius: 8px; color: var(--color-text-primary); background: var(--color-bg-secondary); border: 1px solid var(--color-border); font-size: 12px; pointer-events: auto; }
.density-legend strong { display: block; margin-bottom: 8px; }
.density-ramp { height: 9px; border-radius: 3px; }
.density-scale { display: flex; justify-content: space-between; margin-top: 4px; }
@media (max-width: 600px) { .density-legend { right: 8px; width: 144px; } }
.map-empty-notice { position: absolute; z-index: 3; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 12px; width: max-content; max-width: calc(100% - 32px); padding: 10px 12px 10px 16px; border-radius: 8px; color: var(--color-text-primary); background: var(--color-bg-secondary); border: 1px solid var(--color-border); box-shadow: 0 4px 16px rgba(0,0,0,.25); font-size: 13px; }
.map-empty-notice button { flex: none; padding: 6px 10px; border-radius: 6px; color: var(--color-accent-text); background: transparent; border: 1px solid var(--color-accent); font: inherit; cursor: pointer; }
.map-empty-notice button:hover { background: rgb(var(--color-accent-rgb) / 0.12); }
</style>
