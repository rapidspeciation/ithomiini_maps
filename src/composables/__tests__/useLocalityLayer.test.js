import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const state = vi.hoisted(() => ({
  planning: { localitySettings: { enabled: true, minRecords: 2 }, shortlistIds: [], selectedSiteId: null, sites: [] },
  data: { visualizationMode: 'points', mapStyle: { pointSize: 10 } },
  legend: { shapeSettings: { enabled: false } },
}))
vi.mock('../../stores/planning', () => ({ usePlanningStore: () => state.planning }))
vi.mock('../../stores/data', () => ({ useDataStore: () => state.data }))
vi.mock('../../stores/legend', () => ({ useLegendStore: () => state.legend }))
import { useLocalityLayer } from '../useLocalityLayer'
import { groupCollectionSites } from '../../utils/collectionSites'

function fixture() {
  const sources = { 'points-source': {} }
  const layers = {}
  const images = {}
  const handlers = new Map()
  let rendered = []
  let moving = false
  let zoom = 9
  const map = ref({
    isStyleLoaded: () => true,
    isMoving: () => moving,
    getSource: id => sources[id], getLayer: id => layers[id], getZoom: () => zoom,
    getCenter: () => ({ lng: -77.6, lat: -1 }), getBearing: () => 0, getPitch: () => 0,
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    project: ([lng, lat]) => ({ x: (lng + 80) * 100, y: (lat + 3) * 100 }),
    unproject: ([x, y]) => ({ lng: x / 100 - 80, lat: y / 100 - 3 }),
    hasImage: id => !!images[id], addImage: (id, image, options) => { images[id] = { image, options } },
    addSource: (id, options) => { sources[id] = { ...options, setData: vi.fn(function (data) { this.data = data }) } },
    addLayer: layer => { layers[layer.id] = layer },
    queryRenderedFeatures: vi.fn(() => rendered),
    getLayoutProperty: (id, name) => layers[id]?.layout?.[name],
    setLayoutProperty: vi.fn((id, name, value) => { (layers[id].layout ||= {})[name] = value }),
    on: vi.fn((event, id, callback) => handlers.set(`${event}:${typeof id === 'string' ? id : ''}`, callback || id)),
    off: vi.fn(), moveLayer: vi.fn(), getCanvas: () => ({ style: {} }),
  })
  const layer = useLocalityLayer(map)
  const point = id => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-77.6, -1] }, properties: { id, collection_location: 'Suchipakari', country: 'Ecuador', scientific_name: 'Mechanitis polymnia' } })
  layer.invalidate({ features: [point('a'), point('b')] })
  return { layer, map, sources, layers, images, handlers, point,
    setRendered: features => { rendered = features }, setMoving: value => { moving = value },
    setZoom: value => { zoom = value } }
}

beforeEach(() => {
  state.data.visualizationMode = 'points'
  state.data.mapStyle = { pointSize: 10 }
  state.legend.shapeSettings.enabled = false
  state.planning.localitySettings = { enabled: true, minRecords: 2 }
  state.planning.shortlistIds = []
  state.planning.selectedSiteId = null
  state.planning.sites = []
})
describe('native locality labels', () => {
  it('places ordinary labels with MapLibre candidate anchors at genuine recorded coordinates', async () => {
    const { layer, sources, layers, images, map } = fixture()
    layers['points-layer'] = {}
    await layer.refresh()
    const label = sources['collection-localities'].data.features[0]
    expect(label.properties.label).toBe('Suchipakari')
    expect([label.properties.anchorLng, label.properties.anchorLat]).toEqual([-77.6, -1])
    expect(label.geometry.coordinates).toEqual([-77.6, -1])
    expect(label.properties.textOffset[1]).toBeLessThan(0)
    expect(layers['collection-locality-labels'].layout['text-offset']).toEqual(['get', 'textOffset'])
    expect(layers['collection-locality-labels'].layout['icon-image']).toEqual(['get', 'arrowImage'])
    expect(layers['collection-locality-labels'].layout['icon-rotation-alignment']).toBe('viewport')
    expect(layers['collection-locality-labels'].layout['text-allow-overlap']).toBe(true)
    expect(map.value.moveLayer).toHaveBeenCalledWith('collection-locality-labels', 'points-layer')
    expect(map.value.moveLayer).toHaveBeenCalledWith('collection-locality-callouts', 'points-layer')
    expect(images[label.properties.arrowImage].options.pixelRatio).toBe(2)
    expect(sources['collection-locality-leaders-source']).toBeUndefined()
    state.planning.localitySettings.minRecords = 3
    await layer.refresh()
    expect(sources['collection-localities'].data.features).toEqual([])
  })

  it('shows a shortlisted callout below threshold, then hides labels when disabled', async () => {
    const { layer, sources, layers } = fixture()
    await layer.refresh()
    const id = sources['collection-localities'].data.features[0].properties.siteId
    state.planning.shortlistIds = [id]
    state.planning.localitySettings.minRecords = 100
    await layer.refresh()
    expect(sources['collection-localities'].data.features).toEqual([])
    const callout = sources['collection-locality-callouts-source'].data.features[0]
    expect(callout.properties.siteId).toBe(id)
    expect([callout.properties.anchorLng, callout.properties.anchorLat]).toEqual([-77.6, -1])
    expect(callout.geometry.coordinates).toEqual([-77.6, -1])
    expect(callout.properties.arrowImage).toMatch(/^collection-locality-leader-/)
    expect(layers['collection-locality-callouts'].layout['text-field']).toEqual(['get', 'label'])
    state.planning.localitySettings.enabled = false
    await layer.refresh()
    expect(sources['collection-locality-callouts-source'].data.features).toEqual([])
    layer.cleanup()
  })

  it('keeps separate exact point anchors sharing a stable site ID', async () => {
    const { layer, sources, point } = fixture()
    const second = point('c')
    second.geometry.coordinates = [-77.601, -1]
    layer.invalidate({ features: [point('a'), point('b'), second] })
    await layer.refresh()
    const labels = sources['collection-localities'].data.features
    expect(labels.map(item => [item.properties.anchorLng, item.properties.anchorLat])).toEqual([[-77.6, -1], [-77.601, -1]])
    expect(labels[0].properties.siteId).toBe(labels[1].properties.siteId)
  })

  it('selects without flying and highlights the exact clicked anchor; background clears selection', async () => {
    const { layer, sources, handlers, setRendered } = fixture()
    await layer.refresh()
    layer.attach()
    const feature = sources['collection-localities'].data.features[0]
    setRendered([feature])
    handlers.get('mousemove:')({ point: { x: 240, y: 170 } })
    expect(sources['collection-locality-highlight-source'].data.features[0].geometry.coordinates).toEqual([-77.6, -1])
    handlers.get('click:collection-locality-labels')({ features: [feature] })
    setRendered([])
    handlers.get('click:')({ point: { x: 0, y: 0 } })
    await layer.refresh()
    expect(state.planning.selectedSiteId).toBe(feature.properties.siteId)
    expect(sources['collection-locality-callouts-source'].data.features[0].properties.selected).toBe(true)
    await Promise.resolve()
    handlers.get('click:')({ point: { x: 0, y: 0 } })
    await layer.refresh()
    expect(state.planning.selectedSiteId).toBeNull()
    layer.cleanup()
  })

  it('keeps cluster labels honest and places selected callout beyond the cluster edge', async () => {
    const { layer, sources, layers, point, setRendered } = fixture()
    state.data.visualizationMode = 'clusters'
    layers.clusters = {}
    sources['points-source'].getClusterLeaves = async () => [point('a'), point('b')]
    setRendered([{
      geometry: { type: 'Point', coordinates: [-77.6, -1] },
      properties: { cluster: true, cluster_id: 7, point_count: 20 },
    }])
    await layer.refresh()
    const label = sources['collection-localities'].data.features[0]
    expect(label.properties.label).toBe('Suchipakari')
    expect([label.properties.anchorLng, label.properties.anchorLat]).toEqual([-77.6, -1])
    state.planning.selectedSiteId = label.properties.siteId
    await layer.refresh()
    const callout = sources['collection-locality-callouts-source'].data.features[0]
    expect(callout.properties.label.replace(/\n/g, ' ')).toMatch(/^20 individuals including /)
    expect(callout.geometry.coordinates).toEqual([-77.6, -1])
    expect(callout.properties.arrowRadius).toBeGreaterThan(10)
  })

  it('includes every shortlisted locality represented by one cluster callout', async () => {
    const { layer, sources, layers, point, setRendered } = fixture()
    const nearby = point('c')
    nearby.properties.collection_location = 'Jatun Sacha'
    nearby.geometry.coordinates = [-77.5, -1]
    const members = [point('a'), point('b'), nearby]
    state.planning.sites = groupCollectionSites(members)
    state.planning.shortlistIds = state.planning.sites.map(site => site.id)
    state.data.visualizationMode = 'clusters'
    layers.clusters = {}
    sources['points-source'].getClusterLeaves = async () => members
    setRendered([{
      geometry: { type: 'Point', coordinates: [-77.55, -1] },
      properties: { cluster: true, cluster_id: 8, point_count: 3 },
    }])
    await layer.refresh()
    const callouts = sources['collection-locality-callouts-source'].data.features
    expect(callouts).toHaveLength(1)
    expect(callouts[0].properties.label).toContain('Suchipakari')
    expect(callouts[0].properties.label.replace(/\n/g, ' ')).toContain('Jatun Sacha')
    expect(callouts[0].properties.label.replace(/\n/g, ' ')).toContain('3 individuals including')
  })

  it('keeps paired text and arrow visible during zoom without source updates', async () => {
    const { layer, map, sources, layers, handlers, setMoving, setZoom } = fixture()
    await layer.refresh()
    layer.attach()
    const previous = sources['collection-localities'].data.features[0]
    sources['collection-localities'].setData.mockClear()
    setMoving(true)
    setZoom(10)
    await layer.refresh()
    expect(sources['collection-localities'].setData).not.toHaveBeenCalled()
    expect(layers['collection-locality-labels'].layout.visibility).not.toBe('none')
    expect(sources['collection-localities'].data.features[0]).toBe(previous)
    setMoving(false)
    handlers.get('moveend:')()
    await vi.waitFor(() => expect(sources['collection-localities'].setData).toHaveBeenCalledTimes(1))
    expect(sources['collection-localities'].data.features[0].geometry.coordinates).toEqual([-77.6, -1])
    expect(map.value.setLayoutProperty).not.toHaveBeenCalled()
    layer.cleanup()
  })

  it('does no marker query when locality labels are disabled', async () => {
    const { layer, map, sources } = fixture()
    state.planning.localitySettings.enabled = false
    await layer.refresh()
    expect(map.value.queryRenderedFeatures).not.toHaveBeenCalled()
    expect(sources['collection-localities'].data.features).toEqual([])
  })

  it('queries both locality layers once per hover and makes no hover query when disabled', async () => {
    const { layer, map, sources, handlers, setRendered } = fixture()
    await layer.refresh()
    layer.attach()
    const feature = sources['collection-localities'].data.features[0]
    setRendered([feature])
    map.value.queryRenderedFeatures.mockClear()
    handlers.get('mousemove:')({ point: { x: 240, y: 170 } })
    expect(map.value.queryRenderedFeatures).toHaveBeenCalledTimes(1)
    expect(map.value.queryRenderedFeatures).toHaveBeenCalledWith({ x: 240, y: 170 },
      { layers: ['collection-locality-callouts', 'collection-locality-labels'] })
    state.planning.localitySettings.enabled = false
    await layer.refresh()
    map.value.queryRenderedFeatures.mockClear()
    handlers.get('mousemove:')({ point: { x: 240, y: 170 } })
    expect(map.value.queryRenderedFeatures).not.toHaveBeenCalled()
    layer.cleanup()
  })

  it.each(['points', 'ranges'])('uses cached display geometry for %s marker collisions without querying rendered records', async mode => {
    const { layer, map, sources, layers, point } = fixture()
    state.data.visualizationMode = mode
    layers[mode === 'ranges' ? 'range-points' : 'points-layer'] = {}
    const scattered = point('a')
    scattered.geometry.coordinates = [-77.6, -1.34]
    scattered.properties._originalLng = -77.6
    scattered.properties._originalLat = -1
    const second = point('b')
    second.geometry.coordinates = [-77.6, -1.34]
    second.properties._originalLng = -77.6
    second.properties._originalLat = -1
    layer.invalidate({ features: [scattered, second] })
    await layer.refresh()
    const label = sources['collection-localities'].data.features[0]
    expect(map.value.queryRenderedFeatures).not.toHaveBeenCalled()
    expect(label.geometry.coordinates).toEqual([-77.6, -1])
    // The scattered marker sits in the first (above) text candidate.
    expect(label.properties.textOffset[1]).toBeGreaterThanOrEqual(0)
  })

  it('does not re-send empty sources on camera changes while disabled', async () => {
    const { layer, map, sources } = fixture()
    state.planning.localitySettings.enabled = false
    await layer.refresh()
    map.value.getCenter = () => ({ lng: -77.5, lat: -1 })
    sources['collection-localities'].setData.mockClear()
    sources['collection-locality-callouts-source'].setData.mockClear()
    await layer.refresh()
    expect(sources['collection-localities'].setData).not.toHaveBeenCalled()
    expect(sources['collection-locality-callouts-source'].setData).not.toHaveBeenCalled()
  })

  it('does not re-send an empty callout source on ordinary camera changes', async () => {
    const { layer, map, sources } = fixture()
    await layer.refresh()
    map.value.getCenter = () => ({ lng: -77.5, lat: -1 })
    sources['collection-locality-callouts-source'].setData.mockClear()
    await layer.refresh()
    expect(sources['collection-locality-callouts-source'].setData).not.toHaveBeenCalled()
  })

  it('reuses grouped cluster membership across camera-only changes', async () => {
    const { layer, map, sources, layers, point, setRendered } = fixture()
    state.data.visualizationMode = 'clusters'
    layers.clusters = {}
    sources['points-source'].getClusterLeaves = vi.fn(async () => [point('a'), point('b')])
    setRendered([{ geometry: { type: 'Point', coordinates: [-77.6, -1] },
      properties: { cluster: true, cluster_id: 7, point_count: 20 } }])
    await layer.refresh()
    map.value.getCenter = () => ({ lng: -77.5, lat: -1 })
    await layer.refresh()
    expect(sources['points-source'].getClusterLeaves).toHaveBeenCalledTimes(1)
    expect(map.value.queryRenderedFeatures).toHaveBeenCalledTimes(2)
  })
})
