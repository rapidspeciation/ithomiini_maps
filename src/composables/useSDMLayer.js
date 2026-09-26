/**
 * Composable for rendering SDM prediction rasters on the MapLibre map.
 * Uses sdmStore.selectedSpecies (independent from occurrence filter).
 *
 * - 1 species → single warm heatmap
 * - 2 species → dual overlay (warm + cool) for range comparison
 */
import { watch, computed, ref } from 'vue'
import { useSDMStore } from '../stores/sdm'
import { removeLayerAndSource } from '../utils/mapHelpers'
import { log } from '../utils/logger'

const SDM_LAYER_PREFIX = 'sdm-layer'
const SDM_SOURCE_PREFIX = 'sdm-source'
const SCIENTIFIC_LAYERS = new Set([
  'range-fill', 'range-outline', 'range-points', 'heatmap-layer',
  'cluster-extent-dynamic', 'cluster-extent-dynamic-outline',
  'cluster-points-layer', 'clusters', 'cluster-count',
  'points-layer', 'points-highlight',
])

function firstScientificLayer(map) {
  return map.getStyle()?.layers?.find(layer =>
    SCIENTIFIC_LAYERS.has(layer.id) || layer.id.startsWith('host-plant-layer')
  )?.id
}

// Nodata in the GeoTIFFs is -9999. Values 0..1 are suitability.
// Minimum visible threshold: values below this are transparent.
const SUITABILITY_MIN = 0.05

// Colourblind-safe sequential ramps. Each ramp is single-hue and increases
// monotonically in darkness/saturation, so the low and high ends stay clearly
// distinguishable under all common colour-vision deficiencies (the previous
// yellow→red / cyan→purple ramps were hard to read at the extremes). For the
// two-species overlay we pair orange (species 1) with blue (species 2): the
// canonical colourblind-safe contrast pair (Wong 2011, Nature Methods).
const RAMP_STOPS = {
  warm: [ // orange
    [0.0, [255, 245, 224]],
    [0.3, [253, 192, 134]],
    [0.6, [230, 140, 0]],
    [1.0, [140, 60, 0]],
  ],
  cool: [ // blue
    [0.0, [222, 235, 247]],
    [0.3, [140, 190, 224]],
    [0.6, [0, 114, 178]],
    [1.0, [8, 48, 107]],
  ],
}

// Linear interpolation across the ramp stops for a normalised value v ∈ [0,1].
function interpolateRamp(stops, v) {
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const t = t1 === t0 ? 0 : (v - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ]
    }
  }
  return stops[stops.length - 1][1].slice()
}

function makeRamp(stops) {
  return (value, alpha) => {
    if (value < SUITABILITY_MIN || value <= -9990 || isNaN(value)) return [0, 0, 0, 0]
    const v = Math.min(1, Math.max(0, value))
    const [r, g, b] = interpolateRamp(stops, v)
    // Fade alpha in near the low-suitability threshold so faint predictions
    // don't form a hard edge against the basemap.
    const fade = v < 0.3
      ? 0.35 + 0.65 * (v - SUITABILITY_MIN) / (0.3 - SUITABILITY_MIN)
      : 1
    return [r, g, b, Math.round(alpha * 255 * fade)]
  }
}

const COLOR_RAMPS = {
  warm: makeRamp(RAMP_STOPS.warm),
  cool: makeRamp(RAMP_STOPS.cool),
}

export function useSDMLayer(map) {
  const sdmStore = useSDMStore()
  const cursorValue = ref(null)
  const cursorPos = ref({ x: 0, y: 0 })
  const loadedRasters = new Map()
  const displayedSlots = [null, null]
  // Up to two visible species need four split TIFFs. Keep a little room for a
  // recent selection, but do not retain every raster a visitor has viewed.
  const tiffCache = new Map()
  const MAX_CACHED_TIFFS = 8
  let renderGeneration = 0

  const activeSpecies = computed(() => {
    if (!sdmStore.enabled || !sdmStore.hasData) return []
    return sdmStore.selectedSpecies.filter(sp => sdmStore.hasSDMForSpecies(sp)).slice(0, 2)
  })

  function hasMapStyle(targetMap) {
    try { return !targetMap.getStyle || !!targetMap.getStyle() }
    catch { return false }
  }

  function removeAllLayers() {
    if (!map.value) return
    for (let i = 0; i < 2; i++) {
      try { removeLayerAndSource(map.value, `${SDM_LAYER_PREFIX}-${i}`, `${SDM_SOURCE_PREFIX}-${i}`) }
      catch { /* */ }
      displayedSlots[i] = null
    }
    loadedRasters.clear()
  }

  async function fetchTiffValues(url) {
    if (tiffCache.has(url)) {
      const cached = tiffCache.get(url)
      tiffCache.delete(url)
      tiffCache.set(url, cached)
      return cached
    }
    const pending = (async () => {
      const response = await fetch(url)
      if (!response.ok) return null
      const GeoTIFF = await import('geotiff')
      const arrayBuffer = await response.arrayBuffer()
      const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer)
      const image = await tiff.getImage()
      const data = await image.readRasters()
      const width = image.getWidth()
      const height = image.getHeight()
      const origin = image.getOrigin()
      const resolution = image.getResolution()
      const bbox = [
        origin[0],
        origin[1] + resolution[1] * height,
        origin[0] + resolution[0] * width,
        origin[1],
      ]
      return { values: data[0], width, height, bbox }
    })()
    tiffCache.set(url, pending)
    while (tiffCache.size > MAX_CACHED_TIFFS) tiffCache.delete(tiffCache.keys().next().value)
    try { return await pending }
    catch (error) {
      if (tiffCache.get(url) === pending) tiffCache.delete(url)
      throw error
    }
  }

  async function prepareGeoTIFF(speciesName, colorRamp, showFullExtent) {
    try {
      const basePath = import.meta.env.BASE_URL || '/'
      const safeName = speciesName.replace(/ /g, '_').toLowerCase()
      const coreUrl = `${basePath}data/sdm/species/${safeName}_ensemble_core.tif`
      const extUrl = `${basePath}data/sdm/species/${safeName}_ensemble_extension.tif`
      const fallbackUrl = `${basePath}data/sdm/species/${safeName}_ensemble.tif`

      // Try core/extension split first (new pipeline). Fall back to the
      // single full-ensemble raster if the split files aren't available
      // (legacy data, partial deploys).
      let coreData = await fetchTiffValues(coreUrl)
      let extData = coreData && showFullExtent ? await fetchTiffValues(extUrl) : null
      const usingSplit = !!coreData

      if (!usingSplit) {
        coreData = await fetchTiffValues(fallbackUrl)
        if (!coreData) { log.map.warn(`SDM: Could not load ${fallbackUrl}`); return }
      }

      const { width, height, bbox } = coreData
      // Merge core + extension into a single value buffer. Core wins where
      // it has data; extension fills the rest. Both rasters share the same
      // grid (they're co-registered by construction in step 5).
      const values = new Float32Array(coreData.values.length)
      for (let i = 0; i < values.length; i++) {
        const c = coreData.values[i]
        if (c > -9990 && !isNaN(c)) {
          values[i] = c
        } else if (extData) {
          const e = extData.values[i]
          values[i] = (e > -9990 && !isNaN(e)) ? e : -9999
        } else {
          values[i] = -9999
        }
      }

      // Reproject from equirectangular (EPSG:4326) to Web Mercator (EPSG:3857)
      // so the raster aligns with MapLibre's basemap. Without this, the canvas is
      // drawn as if each row is equal-height in lat — but Mercator stretches rows
      // more toward the poles. This causes a latitude-dependent shift.
      const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
      const topMerc = mercY(bbox[3])
      const bottomMerc = mercY(bbox[1])
      const outHeight = height
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = outHeight
      const ctx = canvas.getContext('2d')
      const imageData = ctx.createImageData(width, outHeight)

      const latStep = (bbox[3] - bbox[1]) / height
      for (let outY = 0; outY < outHeight; outY++) {
        // Convert output canvas row (Mercator Y) back to latitude, then to source row
        const frac = outY / outHeight
        const mercVal = topMerc - frac * (topMerc - bottomMerc)
        const lat = (Math.atan(Math.sinh(mercVal)) * 180) / Math.PI
        const srcY = Math.min(height - 1, Math.max(0, Math.floor((bbox[3] - lat) / latStep)))

        for (let x = 0; x < width; x++) {
          const srcIdx = srcY * width + x
          const [r, g, b, a] = colorRamp(values[srcIdx], 1)
          const dstIdx = (outY * width + x) * 4
          imageData.data[dstIdx] = r
          imageData.data[dstIdx + 1] = g
          imageData.data[dstIdx + 2] = b
          imageData.data[dstIdx + 3] = a
        }
      }

      ctx.putImageData(imageData, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')

      return { speciesName, values, width, height, bbox, dataUrl }
    } catch (e) {
      log.map.error('SDM: Error loading GeoTIFF:', e)
    }
  }

  async function updateLayer() {
    const generation = ++renderGeneration
    const targetMap = map.value
    cursorValue.value = null
    const species = [...activeSpecies.value]
    if (!targetMap || !hasMapStyle(targetMap)) return

    const showFullExtent = sdmStore.showFullExtent
    const pending = []
    for (let index = 0; index < 2; index++) {
      const layerId = `${SDM_LAYER_PREFIX}-${index}`
      const sourceId = `${SDM_SOURCE_PREFIX}-${index}`
      const current = displayedSlots[index]
      try {
        if (species[index] && current?.speciesName === species[index] &&
            current.showFullExtent === showFullExtent &&
            targetMap.getLayer(layerId) && targetMap.getSource(sourceId)) continue
      } catch { return } // A style swap can briefly remove MapLibre's style object.

      try { removeLayerAndSource(targetMap, layerId, sourceId) } catch { /* */ }
      if (current) loadedRasters.delete(current.speciesName)
      displayedSlots[index] = null
      if (species[index]) {
        pending.push({
          index,
          raster: prepareGeoTIFF(species[index], index === 0 ? COLOR_RAMPS.warm : COLOR_RAMPS.cool, showFullExtent)
        })
      }
    }
    if (pending.length === 0) { updateOpacity(); return }
    const rasters = await Promise.all(pending.map(item => item.raster))
    // A style change or selection can happen while the TIFF is in flight.
    if (generation !== renderGeneration || map.value !== targetMap || !hasMapStyle(targetMap)) return
    rasters.forEach((raster, pendingIndex) => {
      if (!raster) return
      const index = pending[pendingIndex].index
      const { speciesName, values, width, height, bbox, dataUrl } = raster
      const sourceId = `${SDM_SOURCE_PREFIX}-${index}`
      const layerId = `${SDM_LAYER_PREFIX}-${index}`
      try {
        targetMap.addSource(sourceId, {
          type: 'image', url: dataUrl,
          coordinates: [[bbox[0], bbox[3]], [bbox[2], bbox[3]], [bbox[2], bbox[1]], [bbox[0], bbox[1]]]
        })
        const beforeLayer = firstScientificLayer(targetMap)
        targetMap.addLayer({
          id: layerId, type: 'raster', source: sourceId,
          paint: { 'raster-opacity': sdmStore.opacity, 'raster-fade-duration': 300 }
        }, beforeLayer)
        loadedRasters.set(speciesName, { values, width, height, bbox })
        displayedSlots[index] = { speciesName, showFullExtent }
        log.map.info(`SDM: Loaded ${speciesName} (${width}x${height})`)
      } catch (error) {
        log.map.error('SDM: Error adding raster layer:', error)
      }
    })
  }

  function invalidatePending() {
    // The map style is about to be replaced. A pending decode must not add
    // its image source to the new style before that style's overlays are ready.
    renderGeneration++
    cursorValue.value = null
  }

  function updateOpacity() {
    if (!map.value || !hasMapStyle(map.value)) return
    for (let index = 0; index < 2; index++) {
      const layerId = `${SDM_LAYER_PREFIX}-${index}`
      try {
        if (map.value.getLayer(layerId))
          map.value.setPaintProperty(layerId, 'raster-opacity', sdmStore.opacity)
      } catch { return } // The style will be reconciled by onStyleIdle.
    }
  }

  function getSuitabilityAt(lng, lat) {
    const species = activeSpecies.value
    if (species.length === 0) return null

    const results = []
    for (const sp of species) {
      const raster = loadedRasters.get(sp)
      if (!raster) continue

      const { values, width, height, bbox } = raster
      const col = Math.floor((lng - bbox[0]) / (bbox[2] - bbox[0]) * width)
      const row = Math.floor((bbox[3] - lat) / (bbox[3] - bbox[1]) * height)

      if (col < 0 || col >= width || row < 0 || row >= height) continue

      const val = values[row * width + col]
      if (val <= -9990 || isNaN(val) || val < SUITABILITY_MIN) continue
      results.push({ species: sp, value: val })
    }

    return results.length > 0 ? results : null
  }

  function onMouseMove(e) {
    if (activeSpecies.value.length === 0) { cursorValue.value = null; return }
    cursorValue.value = getSuitabilityAt(e.lngLat.lng, e.lngLat.lat)
    cursorPos.value = { x: e.point.x, y: e.point.y }
  }

  watch(activeSpecies, (species) => {
    updateLayer()
    if (map.value) {
      map.value.off('mousemove', onMouseMove)
      if (species.length > 0) map.value.on('mousemove', onMouseMove)
    }
    if (species.length === 0) cursorValue.value = null
  }, { deep: true })

  watch(() => sdmStore.opacity, updateOpacity)
  watch(() => sdmStore.showFullExtent, () => { if (activeSpecies.value.length > 0) updateLayer() })

  sdmStore.loadMetadata()

  return { removeAllLayers, updateLayer, invalidatePending, cursorValue, cursorPos }
}
