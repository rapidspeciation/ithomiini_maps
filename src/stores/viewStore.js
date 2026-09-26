import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import { getStorage, setStorage } from '../utils/storageHelpers'
import { usePointGrouping } from './dataPointGrouping'
import { useColorMapping } from './dataColorPalette'
import { useLegendStore } from './legend'
import { useFilterStore } from './filterStore'
import { usePlanningStore } from './planning'

export const useViewStore = defineStore('view', () => {
  const filterStore = useFilterStore()
  const { filteredGeoJSON: filteredGeoJSONRef } = storeToRefs(filterStore)

  const clusteringEnabled = ref(getStorage('app-clustering-enabled', false))
  const clusterSettings = ref({
    compositionRings: true,
    ...getStorage('app-cluster-settings', {
      radiusPixels: 80,
      showClusterPoints: true,
    }),
  })

  const visualizationMode = ref(getStorage('app-visualization-mode', 'points'))
  const DEFAULT_HEATMAP_SETTINGS = { radius: 40, intensity: 1, opacity: 0.7 }
  const heatmapSettings = ref(getStorage('app-heatmap-settings', DEFAULT_HEATMAP_SETTINGS))

  const DEFAULT_RANGE_SETTINGS = {
    method: 'hexbin',
    groupBy: 'species',
    bufferKm: 50,
    minPoints: 5,
    opacity: 0.45,
    showPoints: true,
    hexSize: 50,
  }
  const rangeSettings = ref({ ...DEFAULT_RANGE_SETTINGS, ...getStorage('app-range-settings', DEFAULT_RANGE_SETTINGS) })
  // Site markers scale with individuals unless the user prefers equal sizes.
  const sizeByIndividuals = ref(getStorage('map-size-by-individuals', true))
  // Set by the map when the basemap changes; picks the individuals colour ramp.
  const basemapIsDark = ref(true)
  const colorBy = ref(getStorage('map-color-by', 'subspecies'))

  // Site markers overlap at regional zooms; a translucent fill keeps stacked
  // sites readable while the border stays crisp.
  const DEFAULT_FILL_OPACITY = 0.75
  const mapStyle = ref(getStorage('map-style', {
    pointSize: 10,
    borderWidth: 2,
    borderColor: '#ffffff',
    fillOpacity: DEFAULT_FILL_OPACITY,
    borderOpacity: 0.85,
  }))
  // The previous default was 0.9; move untouched settings to the new default.
  if (mapStyle.value.fillOpacity === 0.9) mapStyle.value.fillOpacity = DEFAULT_FILL_OPACITY
  const styleVersion = ref(0)

  const legendSettings = ref({
    position: 'bottom-left',
    textSize: 0.8,
    showLegend: true,
    maxItems: 15,
  })

  const defaultExportSettings = {
    enabled: false,
    aspectRatio: '16:9',
    customWidth: 1920,
    customHeight: 1080,
    showCoordinates: true,
    includeLegend: true,
    includeScaleBar: true,
    includeAttribution: true,
    uiScale: 1.0,
    format: 'png',
    dpi: 150,
  }
  const storedExportSettings = getStorage('app-export-settings', defaultExportSettings)
  storedExportSettings.enabled = false
  const exportSettings = ref(storedExportSettings)

  const mapView = ref(getStorage('map-view', {
    center: [-60, -5],
    zoom: 4,
    bearing: 0,
    pitch: 0,
  }))

  watch(visualizationMode, mode => {
    clusteringEnabled.value = mode === 'clusters'
  })

  const {
    getPointsAtCoordinates,
    groupPointsBySpecies,
    getSpeciesWithPhotos,
    displayGeoJSON,
  } = usePointGrouping(filteredGeoJSONRef)

  const colorByAttribute = computed(() => {
    const mapping = {
      status: 'sequencing_status',
      subspecies: 'subspecies',
      species: 'scientific_name',
      genus: 'genus',
      mimicry: 'mimicry_ring',
      source: 'source',
    }
    return mapping[colorBy.value] || 'sequencing_status'
  })

  const {
    speciesSubspeciesMap,
    colorPlan,
    maxSiteIndividuals,
    speciesColorMap,
    baseColorMap,
    activeColorMap,
    coloredLabels,
    legendTitle,
  } = useColorMapping(colorBy, displayGeoJSON, colorByAttribute)

  const appendVisualizationURLParams = (params) => {
    if (visualizationMode.value !== 'points') params.set('viz', visualizationMode.value)
    if (clusterSettings.value.compositionRings === false) params.set('cluster_style', 'plain')
    if (visualizationMode.value === 'ranges') {
      const rs = rangeSettings.value
      if (rs.method !== 'hexbin') params.set('range_method', rs.method)
      if (rs.method === 'hulls' && rs.groupBy !== 'species') params.set('range_group', rs.groupBy)
      if (rs.method === 'hulls' && rs.bufferKm !== 50) params.set('range_buffer', rs.bufferKm)
      if (rs.method === 'hulls' && rs.minPoints !== 5) params.set('range_min', rs.minPoints)
      if (rs.method === 'hexbin' && rs.hexSize !== 50) params.set('range_hex', rs.hexSize)
      if (rs.opacity !== 0.45) params.set('range_opacity', Math.round(rs.opacity * 100))
    }
  }

  const syncURLState = () => {
    const params = new URLSearchParams()
    const existing = new URLSearchParams(window.location.search)
    for (const key of ['view', 'map_view']) {
      if (existing.has(key)) params.set(key, existing.get(key))
    }
    const collapsed = useLegendStore().collapsedSpecies || []
    if (collapsed.length) params.set('legend_closed', JSON.stringify(collapsed))
    filterStore.appendFilterURLParams(params)
    appendVisualizationURLParams(params)
    // Resolve the planning store only when syncing, after both stores finish setup.
    usePlanningStore().appendURLParams(params)

    const newURL = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname
    window.history.replaceState({}, '', newURL)
  }

  const restoreVisualizationFromURL = () => {
    const params = new URLSearchParams(window.location.search)
    usePlanningStore().restoreFromURL(params)
    if (params.get('cluster_style') === 'plain') clusterSettings.value.compositionRings = false
    else if (params.get('cluster_style') === 'composition') clusterSettings.value.compositionRings = true

    try {
      const closed = JSON.parse(params.get('legend_closed') || 'null')
      if (Array.isArray(closed)) useLegendStore().collapsedSpecies = closed.filter(s => typeof s === 'string').slice(0, 500)
    } catch { /* Ignore invalid shared display settings. */ }
    if (params.get('viz')) visualizationMode.value = params.get('viz')
    if (params.get('range_method')) rangeSettings.value.method = params.get('range_method')
    if (params.get('range_group')) rangeSettings.value.groupBy = params.get('range_group')
    if (params.get('range_buffer')) rangeSettings.value.bufferKm = Number(params.get('range_buffer'))
    if (params.get('range_min')) rangeSettings.value.minPoints = Number(params.get('range_min'))
    if (params.get('range_opacity')) rangeSettings.value.opacity = Number(params.get('range_opacity')) / 100
    if (params.get('range_hex')) rangeSettings.value.hexSize = Number(params.get('range_hex'))
  }

  const resetVisualizationState = () => {
    visualizationMode.value = 'points'
    rangeSettings.value = { ...DEFAULT_RANGE_SETTINGS }
  }

  watch(() => filterStore.filters, syncURLState, { deep: true })
  watch(() => useLegendStore().collapsedSpecies, syncURLState, { deep: true })
  watch(visualizationMode, syncURLState)
  watch(() => clusterSettings.value.compositionRings, syncURLState)
  watch(rangeSettings, syncURLState, { deep: true })

  watch(clusteringEnabled, value => setStorage('app-clustering-enabled', value))
  watch(clusterSettings, value => setStorage('app-cluster-settings', value), { deep: true })
  watch(sizeByIndividuals, value => setStorage('map-size-by-individuals', value))
  watch(visualizationMode, value => setStorage('app-visualization-mode', value))
  watch(heatmapSettings, value => setStorage('app-heatmap-settings', value), { deep: true })
  watch(rangeSettings, value => setStorage('app-range-settings', value), { deep: true })
  watch(colorBy, value => setStorage('map-color-by', value))
  watch(mapStyle, value => setStorage('map-style', value), { deep: true })
  // basemapIsDark is not listed: a basemap switch already rebuilds the data
  // layer once the new style has loaded, and rebuilding mid-load loses it.
  watch([colorBy, mapStyle, sizeByIndividuals], () => { styleVersion.value++ }, { deep: true })
  watch(mapView, value => setStorage('map-view', value), { deep: true })
  watch(exportSettings, value => {
    const toStore = { ...value }
    toStore.enabled = false
    setStorage('app-export-settings', toStore)
  }, { deep: true })

  return {
    clusteringEnabled,
    clusterSettings,
    visualizationMode,
    DEFAULT_HEATMAP_SETTINGS,
    heatmapSettings,
    DEFAULT_RANGE_SETTINGS,
    rangeSettings,
    sizeByIndividuals,
    basemapIsDark,
    colorBy,
    mapStyle,
    styleVersion,
    legendSettings,
    exportSettings,
    mapView,
    getPointsAtCoordinates,
    groupPointsBySpecies,
    getSpeciesWithPhotos,
    displayGeoJSON,
    colorByAttribute,
    speciesSubspeciesMap,
    colorPlan,
    maxSiteIndividuals,
    speciesColorMap,
    baseColorMap,
    activeColorMap,
    coloredLabels,
    legendTitle,
    appendVisualizationURLParams,
    syncURLState,
    restoreVisualizationFromURL,
    resetVisualizationState,
  }
})
