import { zipSync, strToU8 } from 'fflate'
import { useDataStore } from '../stores/data'
import { useLegendStore } from '../stores/legend'
import { applyAbbreviationFormat } from './abbreviations'
import { generateRScript } from './rExport/rScriptGenerator'
import { generateReadme, generateMapHTML } from './rExport/htmlReadmeGenerators'
import { generateRangePolygons } from './rangePolygons'
import { log } from './logger'

// Build info (injected by Vite)
const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'
const shortHash = commitHash.substring(0, 7)

// Generate citation text
const getCitationText = (recordCount) => {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const url = window.location.href

  return `Wings Atlas. Data accessed on ${date}. ` +
    `${recordCount.toLocaleString()} records retrieved. ` +
    `Version: ${shortHash}. ` +
    `Available at: ${url}`
}

/**
 * Export data for R - generates a ZIP file with all necessary files
 * @param {Object} map - The MapLibre map instance
 * @returns {Promise<void>}
 */
export async function exportForR(map) {
  if (!map) {
    throw new Error('Map not available. Please ensure you are on the Map view.')
  }

  const store = useDataStore()
  const geo = store.filteredGeoJSON

  if (!geo || !geo.features || geo.features.length === 0) {
    throw new Error('No data to export')
  }

  // Get map bounds directly (map container is sized to aspect ratio)
  const mapBounds = map.getBounds()
  const center = map.getCenter()
  const zoom = map.getZoom()

  // Prepare GeoJSON with color information
  const colorMap = store.activeColorMap
  const colorBy = store.colorBy

  // Add color to each feature
  const featuresWithColors = geo.features.map(f => {
    const key = f.properties[colorBy] || 'Unknown'
    return {
      ...f,
      properties: {
        ...f.properties,
        display_color: colorMap[key] || '#888888'
      }
    }
  })

  const exportGeoJSON = {
    type: 'FeatureCollection',
    metadata: {
      title: 'Wings Atlas distribution data',
      version: shortHash,
      exportDate: new Date().toISOString(),
      recordCount: geo.features.length,
      colorBy: colorBy,
      source: 'https://rapidspeciation.github.io/ithomiini_maps/'
    },
    features: featuresWithColors
  }

  // Calculate aspect ratio from map container
  const container = map.getContainer()
  const aspectRatio = container.clientWidth / container.clientHeight

  // View configuration (using map bounds directly)
  const viewConfig = {
    bounds: {
      west: mapBounds.getWest(),
      south: mapBounds.getSouth(),
      east: mapBounds.getEast(),
      north: mapBounds.getNorth()
    },
    center: {
      lng: center.lng,
      lat: center.lat
    },
    zoom: zoom,
    colorBy: colorBy,
    aspectRatio: aspectRatio  // Used by R to set correct output dimensions
  }

  // Get legend store settings
  const legendStore = useLegendStore()

  // Legend configuration - preserve order from colorMap (which matches web app display order)
  // Include species name for shape lookup
  // Pass raw subspecies name - let R script calculate prefix based on format choice
  const legendItems = Object.entries(colorMap).map(([label, color]) => {
    // For subspecies coloring, the label is the subspecies name
    // We need to find the parent species to get the shape
    let species = label
    let subspeciesName = label

    if (colorBy === 'subspecies') {
      // Find the species for this subspecies from the GeoJSON
      const feature = store.displayGeoJSON?.features?.find(
        f => f.properties.subspecies === label
      )
      if (feature) {
        species = feature.properties.scientific_name
        subspeciesName = label
      }
    }

    // Get shape for this species
    const shape = legendStore.getGroupShape(species) || 'circle'

    return {
      label: subspeciesName,  // Raw subspecies name - R will apply prefix formatting
      color,
      species,
      shape
    }
  })

  // Build abbreviations map for all species
  const speciesSet = new Set(legendItems.map(item => item.species))
  const abbreviationsMap = {}
  const displayNamesMap = {}

  for (const species of speciesSet) {
    // Get abbreviation (prefix for subspecies)
    const abbrev = legendStore.speciesAbbreviations[species] ||
      applyAbbreviationFormat(species, legendStore.prefixFormat)
    if (abbrev) abbreviationsMap[species] = abbrev

    // Get display name (for group headers)
    const displayName = legendStore.speciesDisplayNames[species] ||
      applyAbbreviationFormat(species, legendStore.displayNameFormat)
    if (displayName) displayNamesMap[species] = displayName
  }

  // Build group shapes map - include ALL species with their shapes
  // R script needs to know shapes for ALL species to render points correctly
  const groupShapesMap = {}
  for (const item of legendItems) {
    // Include all shapes, not just non-circles
    if (item.shape) {
      groupShapesMap[item.species] = item.shape
    }
  }
  // Also include any explicitly set shapes from the store (overrides)
  Object.assign(groupShapesMap, legendStore.groupShapes)

  // Normalize legend position to 0-1 scale for R
  // Web app uses pixel positions, R uses normalized coordinates
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight
  const legendPosX = legendStore.position.x !== null
    ? Math.max(0.01, Math.min(0.9, legendStore.position.x / containerWidth))
    : 0.02
  const legendPosY = legendStore.position.y !== null
    ? Math.max(0.05, Math.min(0.9, 1 - (legendStore.position.y / containerHeight)))
    : 0.08

  // Build grouping info (which subspecies belong to which species)
  const groupingInfo = {}
  for (const item of legendItems) {
    if (!groupingInfo[item.species]) {
      groupingInfo[item.species] = []
    }
    groupingInfo[item.species].push(item.label)  // Raw subspecies name
  }

  const legendConfig = {
    title: store.legendTitle,
    colorBy: colorBy,
    maxItems: legendItems.length,
    colors: colorMap,
    items: legendItems,
    // Legend customization settings
    showHeaders: legendStore.groupingSettings.showHeaders,
    groupBy: legendStore.groupingSettings.enabled ? 'species' : 'none',
    displayNameFormat: legendStore.displayNameFormat,
    prefixFormat: legendStore.prefixFormat,
    shapesEnabled: legendStore.shapeSettings.enabled,
    // Custom values
    displayNames: displayNamesMap,
    abbreviations: abbreviationsMap,
    groupShapes: groupShapesMap,
    // Grouping information (species -> subspecies list)
    groups: groupingInfo,
    // Position (normalized 0-1)
    position: {
      x: legendPosX,
      y: legendPosY
    }
  }

  // Generate R script with legend settings
  const rScript = generateRScript(colorBy, {
    position: legendStore.position,
    showHeaders: legendStore.groupingSettings.showHeaders,
    displayNameFormat: legendStore.displayNameFormat,
    prefixFormat: legendStore.prefixFormat,
    shapesEnabled: legendStore.shapeSettings.enabled
  })

  // Capture basemap as raster (without data points)
  let basemapDataUrl = null
  const dataLayers = ['points-layer', 'points-glow', 'clusters', 'cluster-count',
    'range-fill', 'range-outline', 'range-points']
  const layerVisibility = {}

  try {
    // Temporarily hide data layers to capture just the basemap
    dataLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        layerVisibility[layerId] = map.getLayoutProperty(layerId, 'visibility')
        map.setLayoutProperty(layerId, 'visibility', 'none')
      }
    })

    // Wait for render
    map.triggerRepaint()
    await new Promise(resolve => map.once('idle', resolve))

    // Capture basemap canvas directly (no cropping needed)
    basemapDataUrl = map.getCanvas().toDataURL('image/png')
  } catch (e) {
    log.export.warn('[Export] Could not capture basemap:', e)
  } finally {
    // ALWAYS restore layer visibility, even if capture failed
    dataLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        const originalVisibility = layerVisibility[layerId]
        if (originalVisibility !== undefined) {
          map.setLayoutProperty(layerId, 'visibility', originalVisibility || 'visible')
        } else {
          // If we didn't capture original state, default to visible
          map.setLayoutProperty(layerId, 'visibility', 'visible')
        }
      }
    })

    // Wait for render to restore
    map.triggerRepaint()
    await new Promise(resolve => map.once('idle', resolve))
  }

  // Generate citation text
  const citationText = getCitationText(geo.features.length)

  // Generate HTML file for exact reproduction
  const mapHTML = generateMapHTML(exportGeoJSON, viewConfig, legendConfig, colorBy)

  const isRangesMode = store.visualizationMode === 'ranges'
  let rangePolygonGeoJSON = null
  if (isRangesMode) {
    rangePolygonGeoJSON = generateRangePolygons(geo, store.rangeSettings, colorMap)
  }

  const files = {
    'data.geojson': strToU8(JSON.stringify(exportGeoJSON, null, 2)),
    'view_config.json': strToU8(JSON.stringify(viewConfig, null, 2)),
    'legend.json': strToU8(JSON.stringify(legendConfig, null, 2)),
    'generate_map.R': strToU8(rScript),
    'map.html': strToU8(mapHTML),
    'README.txt': strToU8(generateReadme(citationText, shortHash))
  }

  if (rangePolygonGeoJSON) {
    files['range_polygons.geojson'] = strToU8(JSON.stringify(rangePolygonGeoJSON, null, 2))
  }

  // Add basemap if captured
  if (basemapDataUrl) {
    const basemapBase64 = basemapDataUrl.split(',')[1]
    files['basemap.png'] = Uint8Array.from(atob(basemapBase64), c => c.charCodeAt(0))
  }

  // Generate and download ZIP
  const zipped = zipSync(files)
  const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ithomiini_r_export_${shortHash}_${Date.now()}.zip`
  link.click()
  URL.revokeObjectURL(url)
}
