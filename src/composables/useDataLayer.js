import { ref } from 'vue'
import maplibregl from 'maplibre-gl'
import { useDataStore } from '../stores/data'
import { useLegendStore } from '../stores/legend'
import { generateSpeciesBorderColors } from '../utils/colors'
import { withHeatmapWeights } from '../utils/heatmap'
import { readClusterLeaves } from '../utils/clusterLeaves'
import { computeClusterStats } from '../utils/clusterStats'
import { OTHER_COLOR, INDIVIDUAL_RAMPS } from '../utils/colorPlan'
import { drawSitePie, groupRecordsBySite, pieSignature, summarizeSites } from '../utils/sites'
import {
  generateColoredShapeImage,
  getColoredShapeImageName
} from '../utils/shapes'
import {
  removeLayerAndSource,
  generateCirclePolygon,
  getThemeAccentColor,
  colorToRgba
} from '../utils/mapHelpers'
import { generateRangePolygons, generateHexBins, invalidateRangeCache } from '../utils/rangePolygons'
import { DYNAMIC_COLORS } from '../utils/constants'
import { log } from '../utils/logger'

/** Category colours for range-mode record points (not aggregated into sites). */
export function buildPointColorExpression({ colorMap, colorAttribute, speciesColorMap, collapsedSpecies }) {
  const entries = Object.entries(colorMap)
  let expression = entries.length === 0
    ? OTHER_COLOR
    : ['match', ['get', colorAttribute], ...entries.flat(), OTHER_COLOR]

  if (collapsedSpecies.length > 0) {
    expression = ['case', ...collapsedSpecies.flatMap(species => [
      ['==', ['get', 'scientific_name'], species], speciesColorMap[species] || OTHER_COLOR
    ]), expression]
  }
  return expression
}

const CLUSTER_RADII = [12, 16, 20, 25, 32]
const POINT_CIRCLE_SCALE_STOPS = [[3, 0.375], [6, 0.625], [10, 1], [14, 1.5]]
const BORDER_SCALE_STOPS = [[3, 0.33], [10, 1]]
// Site icons are 32 CSS px square, so icon-size 1 renders a 16 px radius.
const SITE_ICON_RADIUS = 16
const clusterOutlineName = radius => `cluster-outline-${radius}`

/** Clusters sum the individuals of their sites; thresholds match clusterCircleRadius. */
export function buildClusterOutlineExpression() {
  return ['step', ['get', 'individuals'],
    clusterOutlineName(12), 20, clusterOutlineName(16),
    50, clusterOutlineName(20), 100, clusterOutlineName(25),
    500, clusterOutlineName(32)]
}

function interpolateZoom(stops, zoom) {
  const upper = stops.findIndex(([at]) => zoom <= at)
  if (upper === -1) return stops[stops.length - 1][1]
  if (upper === 0) return stops[0][1]
  const [startZoom, startValue] = stops[upper - 1]
  const [endZoom, endValue] = stops[upper]
  return startValue + (endValue - startValue) * (zoom - startZoom) / (endZoom - startZoom)
}

/** Outer radius of a site marker in screen pixels, including half its border. */
export function visibleSiteRadius(style, zoom, sizeFactor = 1) {
  const circleRadius = style.pointSize * 0.9 * interpolateZoom(POINT_CIRCLE_SCALE_STOPS, zoom) * sizeFactor
  const borderWidth = (style.borderWidth || 0) * interpolateZoom(BORDER_SCALE_STOPS, zoom)
  return circleRadius + borderWidth / 2
}

/** Radius expression shared by site circles, icons and hover rings. */
function siteRadiusExpression(style, extra = 0) {
  const base = style.pointSize * 0.9
  return ['interpolate', ['linear'], ['zoom'],
    ...POINT_CIRCLE_SCALE_STOPS.flatMap(([zoom, scale]) => [
      zoom, ['+', ['*', base * scale, ['get', 'size_factor']], extra],
    ])]
}

/** Individuals mode: one native circle per site, filled from the ramp. */
export function buildSiteCirclePaint(style) {
  return {
    'circle-radius': siteRadiusExpression(style),
    'circle-color': ['get', 'fill'],
    'circle-opacity': style.fillOpacity,
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'],
      ...BORDER_SCALE_STOPS.flatMap(([zoom, scale]) => [zoom, style.borderWidth * scale])],
    'circle-stroke-color': style.borderColor,
    'circle-stroke-opacity': style.borderOpacity,
  }
}

/** Category mode: pie or shape icons, scaled to the same radius as circles. */
export function buildSiteIconSize(style) {
  const base = style.pointSize * 0.9
  return ['interpolate', ['linear'], ['zoom'],
    ...POINT_CIRCLE_SCALE_STOPS.map(([zoom, scale]) => {
      const border = style.borderWidth * interpolateZoom(BORDER_SCALE_STOPS, zoom) / 2
      return [zoom, ['/', ['+', ['*', base * scale, ['get', 'size_factor']], border], SITE_ICON_RADIUS]]
    }).flat()]
}

export function buildRangePointCirclePaint({ radii, colorMap, colorAttribute,
  speciesColorMap, collapsedSpecies, opacity, strokeWidth, strokeOpacity }) {
  return {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], ...radii.flat()],
    'circle-color': buildPointColorExpression({
      colorMap, colorAttribute, speciesColorMap, collapsedSpecies,
    }),
    'circle-opacity': opacity,
    'circle-stroke-width': strokeWidth,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-opacity': strokeOpacity,
  }
}

/** GeoJSON for site markers; large sites sort first so small ones stay visible on top. */
export function siteFeatureCollection(sites, iconFor = null) {
  return {
    type: 'FeatureCollection',
    features: sites.map(site => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: site.coordinates },
      properties: {
        site_key: site.key,
        individuals: site.individuals,
        record_count: site.recordCount,
        species_count: site.speciesCount,
        size_factor: site.sizeFactor,
        sort_key: -site.individuals,
        fill: site.fill || OTHER_COLOR,
        collection_location: site.locality,
        country: site.country,
        ...(iconFor ? { marker_icon: iconFor(site) } : {}),
      },
    })),
  }
}

function drawClusterOutline(radius) {
  const pixelRatio = 2
  const size = (radius + 3) * 2 * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  context.beginPath()
  context.arc(size / 2, size / 2, (radius - 1) * pixelRatio, 0, Math.PI * 2)
  context.strokeStyle = '#ffffff'
  context.globalAlpha = 0.9
  context.lineWidth = 2 * pixelRatio
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

export function useDataLayer(map, options = {}) {
  const store = useDataStore()
  const legendStore = useLegendStore()
  const { onShowPopup, onDataChanged } = options
  let dataGeneration = 0
  let clusterClickGeneration = 0

  let clusterHandlersRegistered = false
  let pointsHandlersRegistered = false
  let lastHoveredPointId = null
  let rangePopup = null
  let _lastClusterState = null
  let _lastClusterRadius = null
  const registeredMarkerImages = new Set()
  // Site key → summary with its records; replaced on every data or style change.
  let sitesByKey = new Map()

  const siteRegistry = {
    get: key => sitesByKey.get(key),
    list: () => [...sitesByKey.values()],
    /** Expand rendered site features (e.g. cluster leaves) back to their records. */
    records: features => features.flatMap(feature => sitesByKey.get(feature.properties?.site_key)?.records || []),
  }

  const addShapeImage = ({ shape, fill, stroke, width, fillOpacity, strokeOpacity }) => {
    const name = getColoredShapeImageName(shape, fill, stroke, width, fillOpacity, strokeOpacity)
    if (!map.value.hasImage(name)) {
      map.value.addImage(name,
        generateColoredShapeImage(shape, fill, stroke, width, 64, fillOpacity, strokeOpacity),
        { pixelRatio: 2 })
    }
    return name
  }

  const addPieImage = (segments, pieStyle) => {
    const name = `site-pie:${pieSignature(segments)}:${pieStyle.stroke}:${pieStyle.strokeWidth}:${pieStyle.fillOpacity}:${pieStyle.strokeOpacity}`
    if (!map.value.hasImage(name)) {
      const quantized = segments.map(segment => ({ ...segment, fraction: Math.max(1, Math.round(segment.fraction * 24)) }))
      const total = quantized.reduce((sum, segment) => sum + segment.fraction, 0)
      map.value.addImage(name, drawSitePie(quantized.map(segment => ({ ...segment, fraction: segment.fraction / total })), pieStyle),
        { pixelRatio: 2 })
    }
    return name
  }

  // Store current cluster extent parameters for recreation after style change
  const currentExtentParams = ref(null)
  let lastParamsUpdateTime = 0

  // Store cluster features for the selected cluster
  const currentClusterFeatures = ref(null)

  const updateClusterPointsLayer = (features) => {
    if (!map.value || !map.value.isStyleLoaded()) return

    removeLayerAndSource(map.value, 'cluster-points-layer', 'cluster-points-source')

    if (!store.clusterSettings.showClusterPoints || !features || features.length === 0) {
      currentClusterFeatures.value = null
      return
    }

    currentClusterFeatures.value = features

    const geojson = {
      type: 'FeatureCollection',
      features: features.map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: f.properties || {}
      }))
    }

    map.value.addSource('cluster-points-source', {
      type: 'geojson',
      data: geojson
    })

    const accentColor = getThemeAccentColor()
    const hasClustersLayer = map.value.getLayer('clusters')

    map.value.addLayer({
      id: 'cluster-points-layer',
      type: 'circle',
      source: 'cluster-points-source',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          3, 3, 6, 4, 10, 6, 14, 8
        ],
        'circle-color': accentColor,
        'circle-opacity': 0.8,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9
      }
    }, hasClustersLayer ? 'clusters' : undefined)
  }

  const clearClusterPointsLayer = () => {
    currentClusterFeatures.value = null
    if (!map.value) return
    removeLayerAndSource(map.value, 'cluster-points-layer', 'cluster-points-source')
  }

  const recreateClusterPointsLayer = () => {
    if (currentClusterFeatures.value && store.clusterSettings.showClusterPoints) {
      updateClusterPointsLayer(currentClusterFeatures.value)
    }
  }

  const updateClusterExtentCircle = (centerLat, centerLng, radiusKm, clusterFeatures = null) => {
    if (!map.value || !map.value.isStyleLoaded()) return

    currentExtentParams.value = { centerLat, centerLng, radiusKm }
    lastParamsUpdateTime = Date.now()

    if (clusterFeatures) {
      updateClusterPointsLayer(clusterFeatures)
    }

    removeLayerAndSource(map.value, 'cluster-extent-dynamic')
    removeLayerAndSource(map.value, 'cluster-extent-dynamic-outline', 'cluster-extent-dynamic-source')

    if (radiusKm < 0.1) return

    const circleCoords = generateCirclePolygon(centerLng, centerLat, radiusKm)
    const circleGeoJSON = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [circleCoords]
        }
      }]
    }

    map.value.addSource('cluster-extent-dynamic-source', {
      type: 'geojson',
      data: circleGeoJSON
    })

    const accentColor = getThemeAccentColor()
    const fillColor = colorToRgba(accentColor, 0.1)
    const lineColor = colorToRgba(accentColor, 0.5)
    const hasClustersLayer = map.value.getLayer('clusters')

    try {
      map.value.addLayer({
        id: 'cluster-extent-dynamic',
        type: 'fill',
        source: 'cluster-extent-dynamic-source',
        paint: { 'fill-color': fillColor, 'fill-opacity': 1 }
      }, hasClustersLayer ? 'clusters' : undefined)

      map.value.addLayer({
        id: 'cluster-extent-dynamic-outline',
        type: 'line',
        source: 'cluster-extent-dynamic-source',
        paint: { 'line-color': lineColor, 'line-width': 2 }
      }, hasClustersLayer ? 'clusters' : undefined)
    } catch (err) {
      log.map.error('[ClusterExtent] Error adding layers:', err)
    }
  }

  let isStyleChanging = false

  const updateClusterExtentColors = () => {
    if (!map.value || !map.value.isStyleLoaded()) return false
    if (!map.value.getLayer('cluster-extent-dynamic')) return false

    const accentColor = getThemeAccentColor()
    const fillColor = colorToRgba(accentColor, 0.1)
    const lineColor = colorToRgba(accentColor, 0.5)

    try {
      map.value.setPaintProperty('cluster-extent-dynamic', 'fill-color', fillColor)
      map.value.setPaintProperty('cluster-extent-dynamic-outline', 'line-color', lineColor)
      return true
    } catch (err) {
      log.map.error('[ClusterExtent] Error updating colors:', err)
      return false
    }
  }

  const recreateClusterExtentCircle = () => {
    if (!currentExtentParams.value) return

    if (map.value?.getLayer('cluster-extent-dynamic')) {
      if (updateClusterExtentColors()) {
        recreateClusterPointsLayer()
        return
      }
    }

    const { centerLat, centerLng, radiusKm } = currentExtentParams.value
    updateClusterExtentCircle(centerLat, centerLng, radiusKm)
    recreateClusterPointsLayer()
  }

  const setStyleChanging = (value) => {
    isStyleChanging = value
  }

  const clearClusterExtentCircle = () => {
    const timeSinceUpdate = Date.now() - lastParamsUpdateTime

    if (isStyleChanging) return
    if (timeSinceUpdate < 200) return

    currentExtentParams.value = null
    clearClusterPointsLayer()

    if (!map.value) return
    removeLayerAndSource(map.value, 'cluster-extent-dynamic')
    removeLayerAndSource(map.value, 'cluster-extent-dynamic-outline', 'cluster-extent-dynamic-source')
  }

  const addDataLayer = (layerOptions = {}) => {
    const { skipZoom = false } = layerOptions

    if (!map.value) return

    const geojson = store.displayGeoJSON
    if (!geojson) return
    log.perf.start('addDataLayer')

    // Filter out hidden legend items from map data
    let mapData = geojson
    if (legendStore.hiddenItems.length > 0) {
      const colorAttrKey = store.colorByAttribute
      const hiddenSet = new Set(legendStore.hiddenItems)
      const visibleFeatures = geojson.features.filter(
        f => !hiddenSet.has(f.properties[colorAttrKey])
      )
      mapData = { type: 'FeatureCollection', features: visibleFeatures }
    }

    const isHeatmap = store.visualizationMode === 'heatmap'
    const isRanges = store.visualizationMode === 'ranges'
    const collapsedSpecies = store.colorBy === 'subspecies' ? legendStore.collapsedSpecies || [] : []
    const shouldCluster = store.visualizationMode === 'clusters'
    const settings = store.clusterSettings
    const clusterRadiusPixels = settings.radiusPixels
    const style = store.mapStyle
    const colorMap = store.activeColorMap
    const colorAttr = store.colorByAttribute
    const plan = store.colorPlan
    const categoryIcons = plan.mode === 'categories'
    const shapesEnabled = legendStore.shapeSettings.enabled
    const speciesBordersEnabled = legendStore.speciesStyling.borderColor && store.colorBy === 'subspecies'
    const speciesBorderColors = speciesBordersEnabled
      ? generateSpeciesBorderColors(Object.keys(store.speciesSubspeciesMap).sort(), legendStore.speciesBorderColors)
      : legendStore.speciesBorderColors
    const activeMarkerImages = new Set()
    let sourceData = mapData

    // Points and clusters draw one marker per site; heatmap and ranges keep records.
    const siteMode = !isHeatmap && !isRanges
    sitesByKey = new Map()
    if (isHeatmap) {
      sourceData = withHeatmapWeights(mapData)
    } else if (siteMode) {
      const { sites } = summarizeSites(groupRecordsBySite(mapData.features), {
        plan,
        ramp: INDIVIDUAL_RAMPS[store.basemapIsDark ? 'dark' : 'light'],
        sizeByIndividuals: store.sizeByIndividuals,
      })
      sitesByKey = new Map(sites.map(site => [site.key, site]))
      const iconFor = site => {
        const species = site.speciesCount === 1 ? site.records[0].properties.scientific_name : null
        const stroke = species && (speciesBordersEnabled || shapesEnabled)
          ? speciesBorderColors[species] || style.borderColor
          : style.borderColor
        const shape = shapesEnabled && species ? legendStore.getGroupShape(species) || 'circle' : 'circle'
        const name = shape !== 'circle' && site.segments.length === 1
          ? addShapeImage({ shape, fill: site.fill, stroke, width: style.borderWidth,
              fillOpacity: style.fillOpacity, strokeOpacity: style.borderOpacity })
          : addPieImage(site.segments.length ? site.segments : [{ color: OTHER_COLOR, fraction: 1 }], {
              stroke, strokeWidth: style.borderWidth, fillOpacity: style.fillOpacity, strokeOpacity: style.borderOpacity,
            })
        activeMarkerImages.add(name)
        return name
      }
      sourceData = siteFeatureCollection(sites, categoryIcons ? iconFor : null)
    }

    dataGeneration++
    onDataChanged?.(mapData, siteRegistry)
    if (shouldCluster) {
      for (const radius of CLUSTER_RADII) {
        const image = clusterOutlineName(radius)
        if (!map.value.hasImage(image)) map.value.addImage(image, drawClusterOutline(radius), { pixelRatio: 2 })
        activeMarkerImages.add(image)
      }
    }

    // Check if we can update the existing source instead of full rebuild
    const existingSource = map.value.getSource('points-source')
    const nextPointLayerType = siteMode ? (categoryIcons ? 'symbol' : 'circle') : null
    // A circle-to-symbol change cannot reuse tile buckets under the same layer ID.
    const pointLayerTypeChanged = (map.value.getLayer('points-layer')?.type || null) !== nextPointLayerType
    const needsSourceRebuild = !existingSource ||
      (shouldCluster !== _lastClusterState) ||
      (clusterRadiusPixels !== _lastClusterRadius) ||
      pointLayerTypeChanged

    if (rangePopup) { rangePopup.remove(); rangePopup = null }

    if (needsSourceRebuild) {
      // Full rebuild: remove everything and recreate
      ;['clusters', 'cluster-count', 'cluster-extent-dynamic',
        'cluster-extent-dynamic-outline', 'cluster-points-layer',
        'points-layer', 'points-highlight', 'heatmap-layer',
        'range-fill', 'range-outline', 'range-points'
      ].forEach(id => removeLayerAndSource(map.value, id))
      ;['points-source', 'cluster-extent-dynamic-source', 'cluster-points-source',
        'range-source'
      ].forEach(id => removeLayerAndSource(map.value, null, id))

      log.perf.start('addSource (full rebuild)')
      map.value.addSource('points-source', {
        type: 'geojson',
        data: sourceData,
        cluster: shouldCluster,
        clusterMaxZoom: 14,
        clusterRadius: clusterRadiusPixels,
        clusterMinPoints: 2,
        // Cluster markers report individuals, not the number of sites.
        ...(shouldCluster ? { clusterProperties: { individuals: ['+', ['get', 'individuals']] } } : {}),
        generateId: true
      })
      log.perf.end('addSource (full rebuild)')
      _lastClusterState = shouldCluster
      _lastClusterRadius = clusterRadiusPixels
    } else {
      // Site colours, sizes and icons are baked into the source, so every
      // rebuild sends it; there is one feature per site, not per record.
      log.perf.start('setData (fast update)')
      existingSource.setData(sourceData)
      log.perf.end('setData (fast update)')

      // Still need to rebuild layers for styling changes
      ;['clusters', 'cluster-count', 'cluster-extent-dynamic',
        'cluster-extent-dynamic-outline', 'cluster-points-layer',
        'points-layer', 'points-highlight', 'heatmap-layer',
        'range-fill', 'range-outline', 'range-points'
      ].forEach(id => {
        if (map.value.getLayer(id)) map.value.removeLayer(id)
      })
      removeLayerAndSource(map.value, null, 'range-source')
    }

    for (const image of registeredMarkerImages) {
      if (!activeMarkerImages.has(image) && map.value.hasImage(image)) map.value.removeImage(image)
    }
    registeredMarkerImages.clear()
    activeMarkerImages.forEach(image => registeredMarkerImages.add(image))

    // Heatmap visualization mode
    if (isHeatmap) {
      const heatSettings = store.heatmapSettings
      map.value.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'points-source',
        paint: {
          'heatmap-weight': ['get', 'heat_weight'],
          'heatmap-intensity': heatSettings.intensity,
          'heatmap-radius': heatSettings.radius,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(31, 83, 129, 0)',
            0.1, 'rgba(49, 113, 161, 0.3)',
            0.3, '#428fac',
            0.55, '#65b9ac',
            0.8, '#b8dd9b',
            1, '#f6e8a5'
          ],
          'heatmap-opacity': heatSettings.opacity
        }
      })

      if (!skipZoom) {
        fitBoundsToData(geojson)
      }
      log.perf.end('addDataLayer', `${mapData.features.length} features, shapes=${legendStore.shapeSettings.enabled}`)
      return
    }

    const addRangePointCircles = (radii, opacity, strokeWidth, strokeOpacity) => map.value.addLayer({
      id: 'range-points',
      type: 'circle',
      source: 'points-source',
      paint: buildRangePointCirclePaint({ radii, opacity, strokeWidth, strokeOpacity,
        colorMap, colorAttribute: colorAttr, speciesColorMap: store.speciesColorMap, collapsedSpecies }),
    })

    // Range polygon visualization mode
    if (isRanges) {
      const rangeSettings = store.rangeSettings
      const isHexBin = rangeSettings.method === 'hexbin'

      if (isHexBin) {
        const hexGeoJSON = generateHexBins(geojson, rangeSettings)

        if (hexGeoJSON.features.length > 0) {
          map.value.addSource('range-source', {
            type: 'geojson',
            data: hexGeoJSON
          })

          map.value.addLayer({
            id: 'range-fill',
            type: 'fill',
            source: 'range-source',
            paint: {
              'fill-color': [
                'interpolate', ['linear'], ['get', 'density'],
                0, '#FFE57F',
                0.2, '#FFCA28',
                0.4, '#FFA726',
                0.6, '#FF7043',
                0.8, '#F44336',
                1, '#C62828'
              ],
              'fill-opacity': rangeSettings.opacity
            }
          })

          map.value.addLayer({
            id: 'range-outline',
            type: 'line',
            source: 'range-source',
            paint: {
              'line-color': '#000000',
              'line-width': 0.5,
              'line-opacity': 0.15
            }
          })
        }

        if (rangeSettings.showPoints) {
          addRangePointCircles([[3, 1], [6, 2], [10, 3], [14, 5]], 0.4, 0, 0)
        }

        // Hex click popup
        map.value.off('click', 'range-fill')
        map.value.on('click', 'range-fill', (e) => {
          if (!e.features?.length) return
          const props = e.features[0].properties

          if (rangePopup) rangePopup.remove()
          rangePopup = new maplibregl.Popup({ maxWidth: '240px', className: 'custom-popup range-popup' })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="padding:8px;font-size:0.85rem;">` +
              `<strong>${props.count} records</strong>` +
              `</div>`
            )
            .addTo(map.value)
        })

        map.value.on('mouseenter', 'range-fill', () => {
          map.value.getCanvas().style.cursor = 'pointer'
        })
        map.value.on('mouseleave', 'range-fill', () => {
          map.value.getCanvas().style.cursor = ''
        })

      } else {
        // Hull polygon method
        const groupBy = rangeSettings.groupBy

        // Build color map keyed by the groupBy attribute (not the legend's colorBy)
        const GROUP_ATTR = { species: 'scientific_name', subspecies: 'subspecies', genus: 'genus', mimicry: 'mimicry_ring' }
        const rangeAttr = GROUP_ATTR[groupBy] || 'scientific_name'
        const uniqueGroups = [...new Set(
          geojson.features.map(f => f.properties[rangeAttr]).filter(v => v && v !== 'Unknown' && v !== 'NA')
        )].sort()
        const rangeColorMap = {}
        uniqueGroups.forEach((name, i) => {
          rangeColorMap[name] = DYNAMIC_COLORS[i % DYNAMIC_COLORS.length]
        })

        const rangeGeoJSON = generateRangePolygons(geojson, rangeSettings, rangeColorMap)

        if (rangeGeoJSON.features.length > 0) {
          map.value.addSource('range-source', {
            type: 'geojson',
            data: rangeGeoJSON
          })

          const fillColorExpr = ['get', 'color']

          map.value.addLayer({
            id: 'range-fill',
            type: 'fill',
            source: 'range-source',
            paint: {
              'fill-color': fillColorExpr,
              'fill-opacity': rangeSettings.opacity
            }
          })

          map.value.addLayer({
            id: 'range-outline',
            type: 'line',
            source: 'range-source',
            paint: {
              'line-color': fillColorExpr,
              'line-width': [
                'interpolate', ['linear'], ['zoom'],
                3, 0.3, 8, 0.8, 14, 1.5
              ],
              'line-opacity': Math.min(0.6, rangeSettings.opacity * 0.7)
            }
          })
        }

        if (rangeSettings.showPoints) {
          addRangePointCircles([[3, 1.5], [6, 2.5], [10, 4], [14, 6]], 0.5, 0.5, 0.3)
        }

        // Hull polygon click handler
        if (rangeGeoJSON.features.length > 0) {
          map.value.off('click', 'range-fill')
          map.value.on('click', 'range-fill', (e) => {
            if (!e.features?.length) return
            const props = e.features[0].properties

            if (rangePopup) rangePopup.remove()
            rangePopup = new maplibregl.Popup({ maxWidth: '280px', className: 'custom-popup range-popup' })
              .setLngLat(e.lngLat)
              .setHTML(
                `<div style="padding:8px;font-size:0.85rem;">` +
                `<strong style="font-style:italic;">${props.group_name}</strong><br/>` +
                `<span style="opacity:0.7;">${props.point_count.toLocaleString()} records</span><br/>` +
                `<span style="opacity:0.7;">${props.area_km2.toLocaleString()} km²</span>` +
                `</div>`
              )
              .addTo(map.value)
          })

          map.value.on('mouseenter', 'range-fill', () => {
            map.value.getCanvas().style.cursor = 'pointer'
          })
          map.value.on('mouseleave', 'range-fill', () => {
            map.value.getCanvas().style.cursor = ''
          })
        }
      }

      if (!skipZoom) {
        fitBoundsToData(geojson)
      }
      log.perf.end('addDataLayer', `${mapData.features.length} features, shapes=${legendStore.shapeSettings.enabled}`)
      return
    }

    if (shouldCluster) {
      // Keep the circle as the existing hit target and fill; its visible
      // outline is a symbol so locality text collides with the whole marker.
      map.value.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'points-source',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': [
            'step', ['get', 'individuals'],
            12, 20, 16, 50, 20, 100, 25, 500, 32
          ],
          'circle-color': '#34404b',
          'circle-opacity': 0.9,
          'circle-stroke-width': 0
        }
      })

      map.value.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'points-source',
        filter: ['has', 'point_count'],
        layout: {
          'icon-image': buildClusterOutlineExpression(),
          'icon-padding': 0,
          'icon-allow-overlap': true,
          'icon-ignore-placement': false,
          'text-field': ['to-string', ['get', 'individuals']],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 13,
          'text-allow-overlap': true
        },
        paint: { 'text-color': '#ffffff' }
      })
    }

    const unclustered = shouldCluster ? ['!', ['has', 'point_count']] : ['all']
    if (categoryIcons) {
      map.value.addLayer({
        id: 'points-layer',
        type: 'symbol',
        source: 'points-source',
        filter: unclustered,
        layout: {
          'icon-image': ['get', 'marker_icon'],
          'icon-padding': 0,
          'icon-size': buildSiteIconSize(style),
          'icon-allow-overlap': true,
          'icon-ignore-placement': style.fillOpacity === 0 && style.borderOpacity === 0,
          'symbol-sort-key': ['get', 'sort_key'],
        }
      })
    } else {
      map.value.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points-source',
        filter: unclustered,
        layout: { 'circle-sort-key': ['get', 'sort_key'] },
        paint: buildSiteCirclePaint(style),
      })
    }

    // Hover ring just outside the hovered site
    map.value.addLayer({
      id: 'points-highlight',
      type: 'circle',
      source: 'points-source',
      filter: shouldCluster
        ? ['all', ['!', ['has', 'point_count']], ['==', ['id'], -1]]
        : ['==', ['id'], -1],
      paint: {
        'circle-radius': siteRadiusExpression(style, style.borderWidth / 2 + 3),
        'circle-color': 'transparent',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    })

    // Cluster event handlers
    if (shouldCluster) {
      if (clusterHandlersRegistered) {
        map.value.off('click', 'clusters')
        map.value.off('mouseenter', 'clusters')
        map.value.off('mouseleave', 'clusters')
      }
      clusterHandlersRegistered = true

      map.value.on('click', 'clusters', async (e) => {
        const features = map.value.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        if (!features.length) return

        const cluster = features[0]
        const coords = cluster.geometry.coordinates
        const clusterId = cluster.properties.cluster_id
        const pointCount = cluster.properties.point_count
        const clusterLng = coords[0]
        const clusterLat = coords[1]

        const source = map.value.getSource('points-source')
        const generation = dataGeneration
        const click = ++clusterClickGeneration
        let clusterFeatures
        try {
          clusterFeatures = await readClusterLeaves(source, clusterId, pointCount)
        } catch (error) {
          log.map.warn('Cluster membership is no longer available. Select the cluster again.', error)
          return
        }
        if (generation !== dataGeneration || click !== clusterClickGeneration ||
            map.value?.getSource('points-source') !== source || !clusterFeatures.length) return

        const clusterRecords = siteRegistry.records(clusterFeatures)
        const clusterPoints = clusterRecords.map(f => f.properties)

        if (clusterPoints.length > 0 && onShowPopup) {
          const clusterStats = computeClusterStats(clusterRecords, clusterLat, clusterLng)
          updateClusterExtentCircle(clusterLat, clusterLng, clusterStats?.radiusKm || 0, clusterFeatures)

          onShowPopup({
            type: 'cluster',
            coordinates: { lat: clusterLat, lng: clusterLng },
            lngLat: coords,
            points: clusterPoints,
            isCluster: true,
            clusterStats
          })
        }
      })

      map.value.on('mouseenter', 'clusters', () => {
        map.value.getCanvas().style.cursor = 'pointer'
      })

      map.value.on('mouseleave', 'clusters', () => {
        map.value.getCanvas().style.cursor = ''
      })
    }

    // Individual point click
    map.value.off('click', 'points-layer')
    map.value.on('click', 'points-layer', (e) => {
      if (!e.features || e.features.length === 0) return

      const site = sitesByKey.get(e.features[0].properties.site_key)
      if (!site || !onShowPopup) return
      const [lng, lat] = site.coordinates
      onShowPopup({
        type: 'point',
        coordinates: { lat, lng },
        lngLat: site.coordinates,
        points: site.records.map(record => record.properties),
      })
    })

    // Points layer hover effects
    if (!pointsHandlersRegistered) {
      pointsHandlersRegistered = true

      map.value.on('mouseenter', 'points-layer', (e) => {
        map.value.getCanvas().style.cursor = 'pointer'

        if (e.features && e.features.length > 0) {
          const featureId = e.features[0].id
          if (featureId === lastHoveredPointId) return
          lastHoveredPointId = featureId
          const isClustering = store.clusteringEnabled
          const filter = isClustering
            ? ['all', ['!', ['has', 'point_count']], ['==', ['id'], featureId]]
            : ['==', ['id'], featureId]
          map.value.setFilter('points-highlight', filter)
        }
      })

      map.value.on('mouseleave', 'points-layer', () => {
        map.value.getCanvas().style.cursor = ''
        lastHoveredPointId = null
        const isClustering = store.clusteringEnabled
        const filter = isClustering
          ? ['all', ['!', ['has', 'point_count']], ['==', ['id'], -1]]
          : ['==', ['id'], -1]
        map.value.setFilter('points-highlight', filter)
      })
    }

    if (!skipZoom) {
      fitBoundsToData(geojson)
    }
    log.perf.end('addDataLayer', `${mapData.features.length} features, shapes=${legendStore.shapeSettings.enabled}`)
  }

  const fitBoundsToData = (geojson) => {
    if (!geojson || !geojson.features || geojson.features.length === 0) return

    if (geojson.features.length === 1) {
      const coords = geojson.features[0].geometry.coordinates
      map.value.flyTo({ center: coords, zoom: 8, duration: 1000 })
      return
    }

    const bounds = new maplibregl.LngLatBounds()
    geojson.features.forEach(f => bounds.extend(f.geometry.coordinates))

    map.value.fitBounds(bounds, {
      padding: { top: 50, bottom: 50, left: 50, right: 50 },
      maxZoom: 12,
      duration: 1000
    })
  }

  return {
    addDataLayer,
    fitBoundsToData,
    clearClusterExtentCircle,
    recreateClusterExtentCircle,
    updateClusterExtentColors,
    setStyleChanging
  }
}
