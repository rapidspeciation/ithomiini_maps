import { usePlanningStore } from '../stores/planning'
import { useDataStore } from '../stores/data'
import { groupCollectionSites } from '../utils/collectionSites'
import { readClusterLeaves } from '../utils/clusterLeaves'
import { clusterCircleRadius } from '../utils/clusterComposition'
import { visibleSiteRadius } from './useDataLayer'
import { siteKeyFor } from '../utils/sites'
import { drawLocalityLeader, groupLocalityAnchors, leaderImageSpec, LOCALITY_PALETTES } from '../utils/localityArrows'
import { layoutLocalityLabels } from '../utils/localityLayout'

const SOURCE = 'collection-localities'
const LABELS = 'collection-locality-labels'
const CALLOUT_SOURCE = 'collection-locality-callouts-source'
const CALLOUTS = 'collection-locality-callouts'
const HIGHLIGHT_SOURCE = 'collection-locality-highlight-source'
const HIGHLIGHT = 'collection-locality-highlight'
const LOCALITY_LAYERS = [LABELS, CALLOUTS, HIGHLIGHT]
const collection = features => ({ type: 'FeatureCollection', features })
const interpolateRadius = (stops, zoom) => {
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let index = 1; index < stops.length; index++) {
    const [endZoom, endRadius] = stops[index]
    if (zoom <= endZoom) {
      const [startZoom, startRadius] = stops[index - 1]
      return startRadius + (endRadius - startRadius) * (zoom - startZoom) / (endZoom - startZoom)
    }
  }
  return stops[stops.length - 1][1]
}

/** Native text and leaders share a screen-space placement, then render in MapLibre. */
export function useLocalityLayer(map, { isDarkBasemap = () => false } = {}) {
  const planning = usePlanningStore()
  const store = useDataStore()
  let generation = 0
  let lastKey = ''
  let cachedAnchors = []
  let cachedMarkers = []
  let sites = null
  let siteCounts = new Map()
  let disposed = false
  let selectedAnchorKey = null
  let selectedClusterId = null
  let hovered = null
  let selectedFeature = null
  let suppressBackgroundClick = false
  let preferredPlacements = new Map()
  const registeredImages = new Set()
  let measureCache = new Map()
  let measureContext
  let clusterSummaries = new Map()
  let clusterSource
  let scheduled = false
  let frameId
  let lastHighlightKey = null
  const sourceContents = new Map()

  /** `siteRegistry` (from the data layer) sizes markers and expands cluster leaves. */
  function invalidate(data, siteRegistry) {
    generation++
    lastKey = ''
    if (data) {
      const features = data.features || []
      sites = siteRegistry || null
      cachedAnchors = groupLocalityAnchors(features)
      // One obstacle per drawn marker: sizes follow individuals in point view.
      const siteList = sites?.list() || []
      if (siteList.length) {
        cachedMarkers = siteList.map(site => ({ coordinates: site.coordinates, sizeFactor: site.sizeFactor }))
      } else {
        const seen = new Set()
        cachedMarkers = []
        for (const feature of features) {
          const coordinates = feature.geometry?.coordinates
          if (!Array.isArray(coordinates) || coordinates.length < 2 ||
            !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) continue
          const key = `${coordinates[0]}:${coordinates[1]}`
          if (seen.has(key)) continue
          seen.add(key)
          cachedMarkers.push({ coordinates, sizeFactor: 1 })
        }
      }
      siteCounts = new Map(groupCollectionSites(features).map(site => [site.id, site.recordCount]))
      hovered = null
      clusterSummaries.clear()
      measureCache.clear()
    }
  }

  function ensureSource(id, features, update = true, wait = false) {
    const m = map.value
    const source = m.getSource(id)
    const previous = sourceContents.get(id)
    if (source) {
      if (!update || (features.length === 0 && previous?.source === source && previous.empty)) return
      sourceContents.set(id, { source, empty: features.length === 0 })
      return source.setData(collection(features), wait)
    }
    m.addSource(id, { type: 'geojson', data: collection(features) })
    sourceContents.set(id, { source: m.getSource(id), empty: features.length === 0 })
  }

  function markerBeforeId() {
    const m = map.value
    const markerIds = ['cluster-count', 'points-layer', 'range-points']
    const actualOrder = m.getStyle?.()?.layers?.map(layer => layer.id) || markerIds
    return actualOrder.find(id => markerIds.includes(id) && m.getLayer(id))
  }

  function ensureLayerOrder(before) {
    const m = map.value
    const styleIds = m.getStyle?.()?.layers?.map(layer => layer.id)
    const first = styleIds?.indexOf(LABELS) ?? -1
    const second = styleIds?.indexOf(CALLOUTS) ?? -1
    const marker = before ? styleIds?.indexOf(before) ?? -1 : Infinity
    if (first >= 0 && second > first && second < marker &&
      (styleIds?.indexOf(HIGHLIGHT) ?? -1) > second) return
    if (before) {
      m.moveLayer(LABELS, before)
      m.moveLayer(CALLOUTS, before)
    } else {
      m.moveLayer(LABELS)
      m.moveLayer(CALLOUTS)
    }
    m.moveLayer(HIGHLIGHT)
  }

  async function render(labels, callouts, renderKey = lastKey) {
    const m = map.value
    if (!m?.isStyleLoaded()) { lastKey = ''; return }
    const activeImages = new Set()
    for (const feature of [...labels, ...callouts]) {
      const props = feature.properties
      activeImages.add(props.arrowImage)
      if (!m.hasImage(props.arrowImage)) {
        const { pixelRatio, ...image } = drawLocalityLeader({
          length: props.arrowLength, radius: props.arrowRadius, emphasized: !!props.selected,
          theme: props.arrowTheme,
        })
        m.addImage(props.arrowImage, image, { pixelRatio })
      }
      registeredImages.add(props.arrowImage)
    }
    const updates = [ensureSource(SOURCE, labels, true, true),
      ensureSource(CALLOUT_SOURCE, callouts, true, true)]
    if (!m.getSource(HIGHLIGHT_SOURCE)) lastHighlightKey = null
    ensureSource(HIGHLIGHT_SOURCE, [], false)
    const before = markerBeforeId()
    const textLayout = {
      'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
      'text-size': 12, 'text-anchor': 'center', 'text-justify': 'center',
      'text-offset': ['get', 'textOffset'], 'text-max-width': 30, 'text-padding': 4,
      'text-allow-overlap': true, 'text-ignore-placement': false, 'text-optional': false,
      'icon-image': ['get', 'arrowImage'], 'icon-size': 1, 'icon-anchor': 'top',
      'icon-rotate': ['get', 'arrowRotation'], 'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport', 'icon-allow-overlap': true,
      'icon-ignore-placement': true, 'icon-optional': false, 'icon-padding': 0,
      'symbol-sort-key': ['get', 'priority'],
    }
    const palette = LOCALITY_PALETTES[theme()]
    const textPaint = { 'text-color': palette.text, 'text-halo-color': palette.halo,
      'text-halo-width': 1.5, 'text-halo-blur': 0.5 }
    if (!m.getLayer(LABELS)) m.addLayer({
      id: LABELS, source: SOURCE, type: 'symbol', layout: textLayout, paint: textPaint,
    }, before)
    if (!m.getLayer(CALLOUTS)) m.addLayer({
      id: CALLOUTS, source: CALLOUT_SOURCE, type: 'symbol', layout: textLayout, paint: textPaint,
    }, before)
    if (!m.getLayer(HIGHLIGHT)) m.addLayer({
      id: HIGHLIGHT, source: HIGHLIGHT_SOURCE, type: 'circle',
      paint: {
        'circle-radius': ['get', 'radius'], 'circle-color': '#ffffff', 'circle-opacity': 0,
        'circle-stroke-color': '#f5c441', 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0.95,
      },
    })
    ensureLayerOrder(before)
    updateHighlight()
    try { await Promise.all(updates) } catch { return }
    if (disposed || renderKey !== lastKey) return
    // Retain a modest atlas across zoom levels, pruning only after new sources have loaded.
    if (registeredImages.size > 128) {
      for (const id of registeredImages) {
        if (registeredImages.size <= 128) break
        if (activeImages.has(id)) continue
        if (m.hasImage(id)) m.removeImage(id)
        registeredImages.delete(id)
      }
    }
  }

  // Layers are recreated after every basemap switch, so paint reads the theme once per style.
  function theme() {
    return isDarkBasemap() ? 'dark' : 'light'
  }

  function measure(text) {
    if (measureCache.has(text)) return measureCache.get(text)
    if (!measureContext && typeof document !== 'undefined') {
      measureContext = document.createElement('canvas').getContext('2d')
      if (measureContext) measureContext.font = '600 12px "Open Sans", Arial, sans-serif'
    }
    const measured = measureContext?.measureText(text).width
    const width = measured > 0 ? measured : text.length * 7
    measureCache.set(text, width)
    return width
  }

  function mapSize(m) {
    const node = m.getContainer?.() || m.getCanvas?.()
    return { width: node?.clientWidth || 800, height: node?.clientHeight || 600 }
  }

  function cameraKey(m) {
    const center = m.getCenter?.()
    const { width, height } = mapSize(m)
    return [m.getZoom().toFixed(3), center?.lng?.toFixed(5), center?.lat?.toFixed(5),
      m.getBearing?.().toFixed(2), m.getPitch?.().toFixed(2), width, height]
  }

  function markerObstacles(m, renderedMarkers) {
    const ids = ['cluster-count', 'points-layer', 'range-points'].filter(id => m.getLayer(id))
    if (!ids.length) return []
    const obstacles = []
    const { width, height } = mapSize(m)
    if (renderedMarkers) {
      const seen = new Set()
      for (const feature of renderedMarkers) {
        const coordinates = feature.geometry?.coordinates
        if (!Array.isArray(coordinates) || coordinates.length < 2) continue
        const key = `${coordinates[0]}:${coordinates[1]}:${feature.properties?.cluster_id || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        const point = m.project(coordinates)
        const radius = feature.properties?.cluster
          ? clusterCircleRadius(clusterIndividuals(feature)) + 4 : pointRadius(feature.properties?.size_factor)
        if (point.x < -radius || point.x > width + radius ||
          point.y < -radius || point.y > height + radius) continue
        obstacles.push({ x: point.x, y: point.y, radius })
      }
      return obstacles
    }
    if (!m.getLayer('points-layer') && !m.getLayer('range-points')) return obstacles
    for (const { coordinates, sizeFactor } of cachedMarkers) {
      const radius = pointRadius(sizeFactor)
      const point = m.project(coordinates)
      if (point.x < -radius || point.x > width + radius ||
        point.y < -radius || point.y > height + radius) continue
      obstacles.push({ x: point.x, y: point.y, radius })
    }
    return obstacles
  }

  function layoutFeatures(labels, callouts, renderedMarkers) {
    const m = map.value
    const inputs = [...callouts.map(feature => ({ feature, selected: !!feature.properties.selected,
      shortlisted: true })), ...labels.map(feature => ({ feature, selected: false, shortlisted: false }))]
    if (!inputs.length) return { placedLabels: [], placedCallouts: [] }
    const items = inputs.map(({ feature, selected, shortlisted }) => ({
      key: feature.properties.anchorKey || `cluster:${feature.properties.clusterId}`,
      label: feature.properties.label, coordinates: feature.geometry.coordinates,
      radius: feature.properties.radius, leaderRadius: feature.properties.leaderRadius,
      selected, shortlisted,
      priority: selected ? -2000000 : shortlisted ? -1000000 : feature.properties.priority,
      feature,
    }))
    const { width, height } = mapSize(m)
    const result = layoutLocalityLabels(items, {
      project: coordinates => m.project(coordinates), width, height, measure,
      markerObstacles: markerObstacles(m, renderedMarkers), preferred: preferredPlacements,
    })
    preferredPlacements = result.choices
    const placedLabels = [], placedCallouts = []
    for (const placed of result.placements) {
      const { item, text, center, anchor, leader } = placed
      const [anchorLng, anchorLat] = item.coordinates
      const length = Math.hypot(leader.shaft[0].x - anchor.x, leader.shaft[0].y - anchor.y)
      const sprite = leaderImageSpec(length, item.leaderRadius, item.selected, theme())
      const properties = { ...item.feature.properties, label: text, labelKey: item.key,
        anchorLng, anchorLat, selected: item.selected, priority: item.priority,
        textOffset: [(center.x - anchor.x) / 12, (center.y - anchor.y) / 12],
        arrowImage: sprite.id, arrowLength: sprite.length, arrowRadius: sprite.radius, arrowTheme: sprite.theme,
        arrowRotation: leader.arrowhead.rotation }
      const label = { type: 'Feature', geometry: { type: 'Point', coordinates: item.coordinates }, properties }
      if (item.shortlisted) placedCallouts.push(label)
      else placedLabels.push(label)
    }
    return { placedLabels, placedCallouts }
  }

  function clusterIndividuals(feature) {
    return Number(feature.properties.individuals ?? feature.properties.point_count)
  }

  function pointRadius(sizeFactor = 1) {
    const zoom = map.value.getZoom()
    if (store.visualizationMode === 'ranges') {
      const hex = store.rangeSettings?.method === 'hexbin'
      const stops = hex ? [[3, 1], [6, 2], [10, 3], [14, 5]]
        : [[3, 1.5], [6, 2.5], [10, 4], [14, 6]]
      return interpolateRadius(stops, zoom) + (hex ? 0 : 0.25) + 5
    }
    return visibleSiteRadius({ pointSize: 10, borderWidth: 0, ...store.mapStyle }, zoom,
      Number(sizeFactor) || 1) + 5
  }

  function siteFeature(anchor) {
    const radius = pointRadius(sites?.get(siteKeyFor(anchor.coordinates))?.sizeFactor)
    const leaderRadius = store.visualizationMode === 'heatmap' ? 0 : radius - 5
    return { type: 'Feature', geometry: { type: 'Point', coordinates: anchor.coordinates }, properties: {
      siteId: anchor.siteId, anchorKey: anchor.anchorKey, label: anchor.label,
      priority: -(siteCounts.get(anchor.siteId) || anchor.recordCount), radius, leaderRadius,
    } }
  }

  function nearbySuffix(others) {
    return others > 0 ? ` +${others} ${others === 1 ? 'site' : 'sites'}` : ''
  }

  function summarizeCluster(members) {
    const localities = groupCollectionSites(sites ? sites.records(members) : members)
    const dominant = localities.filter(site => site.named).sort((a, b) => b.recordCount - a.recordCount)[0]
    return { siteIds: localities.map(site => site.id), siteId: dominant?.id || localities[0]?.id || null,
      label: dominant ? dominant.name + nearbySuffix(localities.length - 1) : 'Nearby unnamed areas' }
  }

  function clusterFeature(feature, summary) {
    const count = clusterIndividuals(feature)
    const radius = clusterCircleRadius(count) + 4
    return { type: 'Feature', geometry: feature.geometry, properties: {
      clusterId: String(feature.properties.cluster_id), pointCount: count,
      ...summary,
      priority: -count, radius, leaderRadius: radius - 4,
    } }
  }

  function callout(base, selected, label = base.properties.label) {
    return { type: 'Feature', geometry: base.geometry, properties: {
      ...base.properties, label, selected, priority: selected ? -2000000 : -1000000,
    } }
  }

  function updateHighlight() {
    const source = map.value?.getSource(HIGHLIGHT_SOURCE)
    if (!source) return
    const feature = hovered || selectedFeature
    const key = feature ? `${feature.properties.labelKey}:${feature.properties.anchorLng}:${feature.properties.anchorLat}` : ''
    if (key === lastHighlightKey) return
    lastHighlightKey = key
    source.setData(collection(feature ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [
      Number(feature.properties.anchorLng), Number(feature.properties.anchorLat),
    ] }, properties: {
      radius: feature.properties.radius,
    } }] : []))
  }

  async function refresh() {
    const m = map.value
    if (disposed || !m?.isStyleLoaded() || !m.getSource('points-source')) return
    // Existing symbols remain screen-aligned while the camera moves.
    if (m.isMoving?.()) return
    const settings = planning.localitySettings
    const minimum = Math.max(1, Number(settings.minRecords) || 1)
    const clustered = store.visualizationMode === 'clusters' && m.getLayer('clusters')
    const baseKey = JSON.stringify([generation, settings.enabled, minimum, planning.shortlistIds,
      planning.selectedSiteId, selectedAnchorKey, selectedClusterId, store.visualizationMode, cameraKey(m)])
    const layersReady = m.getLayer(LABELS) && m.getLayer(CALLOUTS)
    if (!settings.enabled) {
      if (lastKey === 'disabled' && layersReady) return
      lastKey = 'disabled'
      hovered = null
      selectedFeature = null
      await render([], [], 'disabled')
      return
    }
    if (!clustered && baseKey === lastKey && layersReady) return
    const rendered = clustered ? m.queryRenderedFeatures({ layers: ['clusters', 'points-layer'] }) : []
    const clusters = [...new Map(rendered.filter(f => f.properties.cluster).map(f => [f.properties.cluster_id, f])).values()]
    const key = clustered ? JSON.stringify([baseKey, clusters.map(f => f.properties.cluster_id).sort(),
      rendered.filter(f => !f.properties.cluster).map(f => f.properties.site_key).sort()]) : baseKey
    if (key === lastKey && layersReady) return
    lastKey = key
    const epoch = generation
    const source = m.getSource('points-source')
    const renderedSites = [...new Map(rendered.filter(f => !f.properties.cluster)
      .map(f => [f.properties.site_key || JSON.stringify(f.geometry), f])).values()]
    let anchors = clustered
      ? groupLocalityAnchors(sites ? sites.records(renderedSites) : renderedSites)
      : cachedAnchors
    const anchorFeatures = anchors.map(siteFeature)
    if (clusterSource !== source) { clusterSummaries.clear(); clusterSource = source }
    const clusterFeatures = clustered ? (await Promise.all(clusters.map(async feature => {
      try {
        const cacheKey = `${feature.properties.cluster_id}:${feature.properties.point_count}`
        let summary = clusterSummaries.get(cacheKey)
        if (!summary) {
          const members = await readClusterLeaves(source, feature.properties.cluster_id, feature.properties.point_count)
          summary = summarizeCluster(members)
          clusterSummaries.set(cacheKey, summary)
          if (clusterSummaries.size > 80) clusterSummaries.delete(clusterSummaries.keys().next().value)
        }
        return clusterFeature(feature, summary)
      } catch { return null }
    }))).filter(Boolean) : []
    if (disposed || epoch !== generation || m.getSource('points-source') !== source || key !== lastKey) return
    if (m.isMoving?.()) { lastKey = ''; return }

    const callouts = []
    const claimed = new Set()
    const clusteredCallouts = new Map()
    const selectedId = planning.selectedSiteId
    const ids = [...new Set([selectedId, ...planning.shortlistIds].filter(Boolean))]
    for (const siteId of ids) {
      const candidates = anchorFeatures.filter(f => f.properties.siteId === siteId)
      const exact = candidates.find(f => f.properties.anchorKey === selectedAnchorKey)
      const anchor = exact || candidates.sort((a, b) => a.properties.priority - b.properties.priority ||
        a.properties.anchorKey.localeCompare(b.properties.anchorKey))[0]
      if (anchor) {
        const key = anchor.properties.anchorKey
        if (!claimed.has(key)) {
          callouts.push(callout(anchor, siteId === selectedId))
          claimed.add(key)
        }
        continue
      }
      const clusteredSites = clusterFeatures.filter(f => f.properties.siteIds.includes(siteId))
      const cluster = clusteredSites.find(f => f.properties.clusterId === selectedClusterId) || clusteredSites[0]
      if (!cluster) continue
      const site = planning.sites.find(item => item.id === siteId)
      const name = site?.named ? site.name : 'an unnamed site'
      const entry = clusteredCallouts.get(cluster.properties.clusterId) || { cluster, names: [], selected: false }
      entry.names.push(name)
      entry.selected ||= siteId === selectedId
      clusteredCallouts.set(cluster.properties.clusterId, entry)
      claimed.add(`cluster:${cluster.properties.clusterId}`)
    }
    for (const { cluster, names, selected } of clusteredCallouts.values()) {
      callouts.push(callout(cluster, selected,
        `${cluster.properties.pointCount} individuals including ${names.join(', ')}`))
    }
    const labels = [
      ...anchorFeatures.filter(f => (siteCounts.get(f.properties.siteId) || 0) >= minimum && !claimed.has(f.properties.anchorKey)),
      ...clusterFeatures.filter(f => f.properties.pointCount >= minimum && !claimed.has(`cluster:${f.properties.clusterId}`)),
    ]
    const laidOut = layoutFeatures(labels, callouts, clustered ? rendered : undefined)
    selectedFeature = laidOut.placedCallouts.find(f => f.properties.selected) || null
    await render(laidOut.placedLabels, laidOut.placedCallouts, key)
  }

  function labelClick(event) {
    const feature = event.features?.[0]
    if (!feature) return
    const props = feature.properties
    const id = props.siteId
    if (!id) return
    const same = planning.selectedSiteId === id &&
      (props.anchorKey ? selectedAnchorKey === props.anchorKey : selectedClusterId === props.clusterId)
    planning.selectedSiteId = same ? null : id
    selectedAnchorKey = same ? null : props.anchorKey || null
    selectedClusterId = same ? null : props.clusterId || null
    // A delegated layer click also reaches the map click listener in MapLibre.
    suppressBackgroundClick = true
    queueMicrotask(() => { suppressBackgroundClick = false })
    invalidate()
    refresh()
    event.originalEvent?.stopPropagation?.()
  }

  function hover(event) {
    if (!planning.localitySettings.enabled) return
    const m = map.value
    const layers = [CALLOUTS, LABELS].filter(id => m.getLayer(id))
    const feature = layers.length ? m.queryRenderedFeatures(event.point, { layers })[0] : null
    hovered = feature || null
    updateHighlight()
    const canvas = map.value?.getCanvas?.()
    if (canvas) canvas.style.cursor = feature ? 'pointer' : ''
  }

  function leave() {
    hovered = null
    updateHighlight()
    const canvas = map.value?.getCanvas?.()
    if (canvas) canvas.style.cursor = ''
  }

  function backgroundClick(event) {
    const m = map.value
    if (suppressBackgroundClick) return
    const activeLayers = [LABELS, CALLOUTS].filter(id => m.getLayer(id))
    if (!activeLayers.length || m.queryRenderedFeatures(event.point, { layers: activeLayers }).length) return
    if (!planning.selectedSiteId) return
    planning.selectedSiteId = null
    selectedAnchorKey = null
    selectedClusterId = null
    invalidate()
    refresh()
  }

  function scheduleRefresh() {
    if (scheduled || disposed) return
    scheduled = true
    const callback = () => { scheduled = false; frameId = null; refresh() }
    frameId = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(callback) : setTimeout(callback, 0)
  }

  function attach() {
    const m = map.value
    for (const event of ['idle', 'moveend', 'resize']) m.on(event, scheduleRefresh)
    for (const id of [LABELS, CALLOUTS]) {
      m.on('click', id, labelClick)
    }
    m.on('mousemove', hover)
    m.on('mouseleave', leave)
    m.on('click', backgroundClick)
  }

  function cleanup() {
    disposed = true
    generation++
    if (frameId != null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
      else clearTimeout(frameId)
    }
    const m = map.value
    for (const event of ['idle', 'moveend', 'resize']) m?.off(event, scheduleRefresh)
    for (const id of [LABELS, CALLOUTS]) {
      m?.off('click', id, labelClick)
    }
    m?.off('mousemove', hover)
    m?.off('mouseleave', leave)
    m?.off('click', backgroundClick)
  }
  return { invalidate, refresh, attach, cleanup }
}
