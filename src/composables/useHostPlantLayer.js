import { watch } from 'vue'
import { useHostPlantStore } from '../stores/hostPlants'
import { removeLayerAndSource } from '../utils/mapHelpers'
import { log } from '../utils/logger'
import { generateColoredShapeImage, getColoredShapeImageName } from '../utils/shapes'

const SOURCE_PREFIX = 'host-plant-source'
const LAYER_PREFIX = 'host-plant-layer'
const SOURCE_ID = 'host-plant-source'
const LAYER_ID = 'host-plant-layer'
const COLORS = ['#16a34a', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6']

export function getHostPlantActiveTaxa(hostPlantStore) {
  return hostPlantStore.activeTaxa.filter(taxon => taxon.occurrence_count > 0)
}

export function useHostPlantLayer(map, options = {}) {
  const hostPlantStore = useHostPlantStore()
  const { onShowPopup } = options
  const layerHandlers = new Map()

  function layerId(slug) {
    return `${LAYER_PREFIX}-${slug}`
  }

  function sourceId(slug) {
    return `${SOURCE_PREFIX}-${slug}`
  }

  function triangleImageName(color) {
    return getColoredShapeImageName('triangle', color, '#ffffff', 2)
  }

  function ensureTriangleImage(color) {
    const imageName = triangleImageName(color)
    if (!map.value.hasImage(imageName)) {
      const imageData = generateColoredShapeImage('triangle', color, '#ffffff', 2, 64)
      map.value.addImage(imageName, imageData, { pixelRatio: 2 })
    }
    return imageName
  }

  function removeAllLayers() {
    if (!map.value) return
    removeLayerHandlers(LAYER_ID)
    try { removeLayerAndSource(map.value, LAYER_ID, SOURCE_ID) }
    catch { /* layer may already be absent */ }
    for (const slug of hostPlantStore.selectedTaxonSlugs) {
      removeLayerHandlers(layerId(slug))
      try { removeLayerAndSource(map.value, layerId(slug), sourceId(slug)) }
      catch { /* layer may already be absent */ }
    }
    const style = map.value.getStyle?.()
    for (const layer of style?.layers || []) {
      if (layer.id.startsWith(LAYER_PREFIX)) {
        const slug = layer.id.replace(`${LAYER_PREFIX}-`, '')
        removeLayerHandlers(layer.id)
        try { removeLayerAndSource(map.value, layer.id, sourceId(slug)) }
        catch { /* layer may already be absent */ }
      }
    }
  }

  // Gather all occurrences of the same host taxon rendered at (or stacked
  // under) the clicked point, deduped by GBIF id / coordinate. Returns at least
  // the clicked occurrence.
  function collectSiteOccurrences(point, clickedProps, clickedCoords) {
    const slug = clickedProps.host_taxon_slug
    const result = []
    const seen = new Set()
    const add = (p, coords) => {
      if (!p || p.host_taxon_slug !== slug) return
      const key = p.gbifID || `${coords?.[0]},${coords?.[1]}`
      if (seen.has(key)) return
      seen.add(key)
      result.push(p)
    }
    try {
      const pad = 8
      const stacked = map.value.queryRenderedFeatures(
        [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]],
        { layers: [LAYER_ID] },
      )
      for (const f of stacked) add(f.properties || {}, f.geometry?.coordinates)
    } catch { /* queryRenderedFeatures can throw if the layer is gone */ }
    add(clickedProps, clickedCoords)
    return result
  }

  function removeLayerHandlers(lid) {
    const handlers = layerHandlers.get(lid)
    if (!handlers || !map.value) return
    map.value.off('click', lid, handlers.click)
    map.value.off('mouseenter', lid, handlers.mouseenter)
    map.value.off('mouseleave', lid, handlers.mouseleave)
    layerHandlers.delete(lid)
  }

  function registerLayerHandlers(lid) {
    if (!map.value) return
    removeLayerHandlers(lid)
    const handlers = {
      click: (event) => {
        if (!event.features || event.features.length === 0 || !onShowPopup) return
        const feature = event.features[0]
        const props = feature.properties || {}
        const coords = feature.geometry.coordinates.slice()
        // Collect every occurrence of the same host taxon stacked at this site
        // so the popup can report the real count instead of always "1".
        const occurrences = collectSiteOccurrences(event.point, props, coords)
        const taxon = hostPlantStore.taxaBySlug.get(props.host_taxon_slug)
        onShowPopup({
          type: 'plant',
          coordinates: {
            lat: Number(props.decimalLatitude ?? coords[1]),
            lng: Number(props.decimalLongitude ?? coords[0]),
          },
          lngLat: coords,
          occurrence: props,
          occurrences,
          taxon,
        })
      },
      mouseenter: () => {
        map.value.getCanvas().style.cursor = 'pointer'
      },
      mouseleave: () => {
        map.value.getCanvas().style.cursor = ''
      },
    }
    map.value.on('click', lid, handlers.click)
    map.value.on('mouseenter', lid, handlers.mouseenter)
    map.value.on('mouseleave', lid, handlers.mouseleave)
    layerHandlers.set(lid, handlers)
  }

  async function addUnifiedLayer() {
    await hostPlantStore.loadMetadata()
    const taxa = getHostPlantActiveTaxa(hostPlantStore)
    await hostPlantStore.loadOccurrences(taxa.map(taxon => taxon.slug))
    if (!map.value) return
    const collection = hostPlantStore.getOccurrenceCollectionForTaxa(taxa.map(taxon => taxon.slug))
    if (collection.features.length === 0) return

    try { removeLayerAndSource(map.value, LAYER_ID, SOURCE_ID) } catch { /* */ }

    map.value.addSource(SOURCE_ID, { type: 'geojson', data: collection })
    const imageExpression = ['match', ['get', 'host_taxon_slug']]
    taxa.forEach((taxon, index) => {
      const color = COLORS[index % COLORS.length]
      imageExpression.push(taxon.slug, ensureTriangleImage(color))
    })
    imageExpression.push(ensureTriangleImage(COLORS[0]))
    map.value.addLayer({
      id: LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'icon-image': imageExpression,
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.18,
          8, 0.34,
          12, 0.5,
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': hostPlantStore.opacity,
      },
    })
    registerLayerHandlers(LAYER_ID)
  }

  async function updateLayer() {
    if (!map.value) return
    removeAllLayers()
    if (!hostPlantStore.enabled) return
    await addUnifiedLayer()
  }

  watch(
    () => [
      hostPlantStore.enabled,
      hostPlantStore.selectedTaxonSlugs.slice().join('|'),
      hostPlantStore.taxa.length,
    ],
    () => { updateLayer().catch(error => log.map.error('Host plants: layer update failed', error)) }
  )

  watch(
    () => hostPlantStore.opacity,
    () => {
      if (!map.value) return
      if (map.value.getLayer(LAYER_ID)) {
        map.value.setPaintProperty(LAYER_ID, 'icon-opacity', hostPlantStore.opacity)
      }
    }
  )

  hostPlantStore.loadMetadata().catch(() => {})

  return { updateLayer, removeAllLayers }
}
