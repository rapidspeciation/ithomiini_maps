import { zipSync, strToU8 } from 'fflate'
import { useDataStore } from '../stores/data'
import { useLegendStore } from '../stores/legend'
import { generateRScript } from './rExport/rScriptGenerator'
import { generateReadme } from './rExport/htmlReadmeGenerators'
import { resolvePointFeatures, resolveRangeFeatures, resolveSiteFeatures, snapshotLegend, snapshotControls } from './rExport/snapshot'
import { groupRecordsBySite, summarizeSites } from './sites'
import { INDIVIDUAL_RAMPS } from './colorPlan'
import { withMapExport } from './mapExportQueue'
import { generateSpeciesBorderColors } from './colors'
import { useHostPlantStore } from '../stores/hostPlants'
import { useSDMStore } from '../stores/sdm'

const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'
const shortHash = commitHash.substring(0, 7)
const SCIENTIFIC_LAYERS = [
  'points-layer', 'points-glow', 'points-highlight', 'clusters', 'cluster-count',
  'cluster-points-layer', 'cluster-extent-dynamic', 'cluster-extent-dynamic-outline',
  'heatmap-layer', 'range-fill', 'range-outline', 'range-points'
]
const overlayLayer = id => id === 'host-plant-layer' || id.startsWith('sdm-layer')
async function renderedFrame(map) {
  map.triggerRepaint()
  await new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); map.off('idle', done); resolve() }
    const timer = setTimeout(() => {
      map.off('idle', done)
      reject(new Error('The map did not finish rendering. Wait for tiles and overlays to load, then export again.'))
    }, 15000)
    map.on('idle', done)
  })
  return map.getCanvas().toDataURL('image/png')
}

async function captureWithoutLayers(map, hiddenIds) {
  const original = []
  try {
    for (const id of hiddenIds) {
      if (!map.getLayer(id)) continue
      original.push([id, map.getLayoutProperty(id, 'visibility')])
      map.setLayoutProperty(id, 'visibility', 'none')
    }
    return await renderedFrame(map)
  } finally {
    for (const [id, visibility] of original) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility || 'visible')
    }
    await renderedFrame(map)
  }
}

const pngBytes = dataUrl => Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0))
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
const interpolate = (zoom, stops) => {
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    if (zoom <= stops[i][0]) {
      const [z0, v0] = stops[i - 1]
      const [z1, v1] = stops[i]
      return v0 + (v1 - v0) * (zoom - z0) / (z1 - z0)
    }
  }
  return stops.at(-1)[1]
}

function pointStyle(store, legendStore, zoom, mode) {
  const style = store.mapStyle
  if (mode === 'ranges') {
    const hex = store.rangeSettings.method === 'hexbin'
    return {
      radius: interpolate(zoom, hex ? [[3, 1], [6, 2], [10, 3], [14, 5]] : [[3, 1.5], [6, 2.5], [10, 4], [14, 6]]),
      fillOpacity: hex ? 0.4 : 0.5, strokeWidth: hex ? 0 : 0.5,
      strokeColor: '#ffffff', strokeOpacity: hex ? 0 : 0.3,
      useShapes: false
    }
  }
  // Site markers share one radius rule; each site multiplies it by its size factor.
  const base = style.pointSize * 0.9
  return {
    radius: interpolate(zoom, [[3, base * 0.375], [6, base * 0.625], [10, base], [14, base * 1.5]]),
    fillOpacity: style.fillOpacity,
    strokeWidth: interpolate(zoom, [[3, style.borderWidth * 0.33], [10, style.borderWidth]]),
    strokeColor: style.borderColor,
    strokeOpacity: style.borderOpacity,
    useShapes: legendStore.shapeSettings.enabled && store.colorPlan.mode === 'categories'
  }
}

function exportSdmLayers(map, layerIds, project) {
  const style = map.getStyle()
  return layerIds.filter(id => id.startsWith('sdm-layer')).map((id, index) => {
    const layer = style.layers.find(item => item.id === id)
    const source = style.sources[layer?.source]
    if (source?.type !== 'image' || !source.url?.startsWith('data:image/png;base64,') || source.coordinates?.length !== 4) {
      throw new Error(`SDM layer ${id} has no self-contained georeferenced PNG source`)
    }
    const corners = source.coordinates.map(position => {
      const point = project(position)
      return [point.x, point.y]
    })
    return { id, filename: `sdm_${index + 1}.png`, corners, geoCorners: source.coordinates,
      opacity: map.getPaintProperty(id, 'raster-opacity') ?? 1, dataUrl: source.url }
  })
}

function exportHostPlants(hostPlantStore, project, zoom) {
  const taxa = hostPlantStore.activeTaxa.filter(taxon => taxon.occurrence_count > 0)
  const colors = ['#16a34a', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6']
  const palette = Object.fromEntries(taxa.map((taxon, index) => [taxon.slug, colors[index % colors.length]]))
  const source = hostPlantStore.getOccurrenceCollectionForTaxa(taxa.map(taxon => taxon.slug))
  const iconSize = interpolate(zoom, [[2, 0.18], [8, 0.34], [12, 0.5]])
  return {
    type: 'FeatureCollection',
    style: { size: 32 * iconSize, opacity: hostPlantStore.opacity, borderColor: '#ffffff', borderWidth: 2 * iconSize },
    features: source.features.map(feature => {
      const point = project(feature.geometry.coordinates)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          display_color: palette[feature.properties.host_taxon_slug] || colors[0],
          screen_x: point.x,
          screen_y: point.y
        }
      }
    })
  }
}

/** Capture displayed map state. Vector data is separate from the captured raster background. */
export function exportForR(map) {
  if (!map) throw new Error('Map not available. Please ensure you are on the Map view.')
  return withMapExport(map, () => exportForRLocked(map))
}

async function exportForRLocked(map) {
  const store = useDataStore()
  const legendStore = useLegendStore()
  const hostPlantStore = useHostPlantStore()
  const sdmStore = useSDMStore()
  const geo = store.filteredGeoJSON
  if (!geo?.features?.length) throw new Error('No data to export')

  const mode = store.visualizationMode
  const rangeMethod = store.rangeSettings.method
  const rasterVisualization = mode === 'heatmap' || mode === 'clusters'
  const container = map.getContainer()
  const canvas = map.getCanvas()
  const width = container.clientWidth
  const height = container.clientHeight
  if (!width || !height) throw new Error('Map canvas has no visible size')
  const project = coordinates => map.project(coordinates)
  const zoom = map.getZoom()
  const bounds = map.getBounds()
  const center = map.getCenter()
  const displayedGeo = store.displayGeoJSON
  const captureSignature = () => JSON.stringify({
    center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
    width: container.clientWidth, height: container.clientHeight,
    style: map.getStyle().name, layerIds: map.getStyle().layers.map(layer => layer.id),
    filters: store.filters, colorBy: store.colorBy, activeColorMap: store.activeColorMap,
    mode: store.visualizationMode,
    range: store.rangeSettings, mapStyle: store.mapStyle,
    colorPlan: store.colorPlan.mode, colored: [...store.coloredLabels], hidden: legendStore.hiddenItems,
    sizeByIndividuals: store.sizeByIndividuals,
    shapes: legendStore.shapeSettings, groupShapes: legendStore.groupShapes,
    legendPosition: legendStore.position, legendSize: legendStore.size,
    host: { selected: hostPlantStore.selectedTaxonSlugs, opacity: hostPlantStore.opacity },
    sdm: { enabled: sdmStore.enabled, selected: sdmStore.selectedSpecies,
      opacity: sdmStore.opacity, showFullExtent: sdmStore.showFullExtent }
  })
  const initialSignature = captureSignature()
  const assertStable = () => {
    if (captureSignature() !== initialSignature || store.filteredGeoJSON !== geo || store.displayGeoJSON !== displayedGeo) {
      throw new Error('Map or filters changed while exporting. Keep this view still and retry the R export.')
    }
  }
  const layerIds = map.getStyle().layers.map(layer => layer.id)
  const overlays = layerIds.filter(overlayLayer)
  const scientific = layerIds.filter(id => SCIENTIFIC_LAYERS.includes(id))
  if (overlays.some(id => id.startsWith('sdm-layer')) && map.getPitch() > 0.01) {
    throw new Error('Editable R export of SDM rasters needs a flat map view. Reset map pitch to 0° and retry.')
  }
  const sdm = exportSdmLayers(map, overlays, project)
  const hasHostLayer = overlays.includes('host-plant-layer')
  const hostPlants = hasHostLayer ? exportHostPlants(hostPlantStore, project, zoom) : null

  // Always include a clean basemap. For active scientific raster overlays, also
  // include a composite frame, labelled as such in the manifest and README.
  const basemap = await captureWithoutLayers(map, [...overlays, ...scientific])
  const background = rasterVisualization
    ? await captureWithoutLayers(map, overlays.filter(id => id === 'host-plant-layer'))
    : basemap
  assertStable()

  const speciesBorderColors = legendStore.speciesStyling.borderColor && store.colorBy === 'subspecies'
    ? generateSpeciesBorderColors(Object.keys(store.speciesSubspeciesMap).sort(), legendStore.speciesBorderColors)
    : {}
  const hidden = new Set(legendStore.hiddenItems)
  const visibleRecords = (displayedGeo?.features || geo.features)
    .filter(feature => !hidden.has(feature.properties[store.colorByAttribute]))
  const shapesEnabled = legendStore.shapeSettings.enabled
  const singleSpecies = site => site.speciesCount === 1 ? site.records[0].properties.scientific_name : null
  const features = mode === 'ranges'
    // Range mode draws small record points beneath the polygons.
    ? resolvePointFeatures(visibleRecords, {
        attribute: store.colorByAttribute,
        palette: store.activeColorMap,
        hiddenItems: legendStore.hiddenItems,
        project
      }).map(feature => ({ ...feature, properties: { ...feature.properties, display_shape: 'circle' } }))
    : resolveSiteFeatures(summarizeSites(groupRecordsBySite(visibleRecords), {
        plan: store.colorPlan,
        ramp: INDIVIDUAL_RAMPS[store.basemapIsDark ? 'dark' : 'light'],
        sizeByIndividuals: store.sizeByIndividuals,
      }).sites, {
        project,
        shapeFor: site => shapesEnabled && singleSpecies(site)
          ? legendStore.getGroupShape(singleSpecies(site)) || 'circle' : 'circle',
        strokeFor: site => {
          const species = singleSpecies(site)
          if (!species) return store.mapStyle.borderColor
          if (shapesEnabled) return legendStore.speciesBorderColors[species] || store.mapStyle.borderColor
          return speciesBorderColors[species] || store.mapStyle.borderColor
        }
      })

  const drawPoints = mode === 'points' || (mode === 'ranges' && store.rangeSettings.showPoints)
  const ranges = mode === 'ranges'
    ? resolveRangeFeatures(geo, store.rangeSettings, store.activeColorMap, project)
    : null
  const dataGeoJSON = {
    type: 'FeatureCollection',
    metadata: { appCommit: commitHash, colorBy: store.colorBy, colorMode: store.colorPlan.mode,
      features: mode === 'ranges' ? 'records' : 'sites' },
    features
  }
  const dataText = JSON.stringify(dataGeoJSON, null, 2)
  // Every filtered occurrence, independent of how the map groups them.
  const recordsText = JSON.stringify({ type: 'FeatureCollection', features: geo.features }, null, 2)
  const dataSha256 = await sha256(new TextEncoder().encode(dataText))
  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    appCommit: commitHash,
    pageUrl: window.location.href,
    source: 'https://rapidspeciation.github.io/ithomiini_maps/',
    sourceManifest: store.manifest || null,
    loadedSources: Array.from(store.loadedSources || []),
    filters: JSON.parse(JSON.stringify(store.filters)),
    dataSha256,
    filteredRecordCount: geo.features.length,
    displayedRecordCount: visibleRecords.length,
    displayedMarkerCount: features.length,
    colorMode: store.colorPlan.mode,
    mode,
    rangeMethod: mode === 'ranges' ? rangeMethod : null,
    colorBy: store.colorBy,
    colorAttribute: store.colorByAttribute,
    basemapStyle: map.getStyle().name || 'See source style in the web app',
    projection: 'MapLibre projected CSS pixel coordinates; geographic source data remain in data.geojson',
    canvas: { width, height, pixelRatio: canvas.width / width },
    bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
    center: { lng: center.lng, lat: center.lat },
    zoom,
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    controls: snapshotControls(container),
    layers: {
      background: 'basemap.png',
      rasterComposite: rasterVisualization ? 'background.png' : null,
      rasterOverlayIds: sdm.map(layer => layer.id),
      rasterVisualizationIds: rasterVisualization ? scientific : [],
      sdmRasters: sdm.map(({ id, filename, corners, geoCorners, opacity }) => ({ id, filename, corners, geoCorners, opacity })),
      editableHostPlants: hostPlants?.features.length || 0,
      hostPlantStyle: hostPlants?.style || null,
      editablePoints: drawPoints ? features.length : 0,
      editableRanges: ranges?.features.length || 0,
      pointStyle: pointStyle(store, legendStore, zoom, mode),
      rangeStyle: mode === 'ranges' ? {
        fillOpacity: store.rangeSettings.opacity,
        outlineWidth: rangeMethod === 'hexbin' ? 0.5 : interpolate(zoom, [[3, 0.3], [8, 0.8], [14, 1.5]]),
        outlineOpacity: rangeMethod === 'hexbin' ? 0.15 : Math.min(0.6, store.rangeSettings.opacity * 0.7)
      } : null
    }
  }
  const legend = snapshotLegend(container)
  const files = {
    'data.geojson': strToU8(dataText),
    'records.geojson': strToU8(recordsText),
    'view_config.json': strToU8(JSON.stringify(manifest, null, 2)),
    'legend.json': strToU8(JSON.stringify(legend, null, 2)),
    'generate_map.R': strToU8(generateRScript()),
    'README.txt': strToU8(generateReadme(manifest)),
    'basemap.png': pngBytes(basemap)
  }
  if (rasterVisualization) files['background.png'] = pngBytes(background)
  for (const layer of sdm) files[layer.filename] = pngBytes(layer.dataUrl)
  if (hostPlants) files['host_plants.geojson'] = strToU8(JSON.stringify(hostPlants, null, 2))
  if (ranges) files['range_polygons.geojson'] = strToU8(JSON.stringify(ranges, null, 2))
  const checksums = {}
  for (const [filename, bytes] of Object.entries(files)) checksums[filename] = await sha256(bytes)
  files['checksums.json'] = strToU8(JSON.stringify({ algorithm: 'SHA-256', files: checksums }, null, 2))
  assertStable()
  const zipped = zipSync(files)
  const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ithomiini_r_export_${shortHash}_${Date.now()}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
