import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const state = vi.hoisted(() => ({
  data: {
    visualizationMode: 'clusters', clusterSettings: { compositionRings: true },
    colorPlan: { mode: 'categories' },
  },
}))
vi.mock('../../stores/data', () => ({ useDataStore: () => state.data }))
import { useClusterComposition } from '../useClusterComposition'

// Cluster leaves are site features; the registry holds each site's colour segments.
const sites = new Map([
  ['a', { segments: [{ color: '#112233', count: 3 }] }],
  ['b', { segments: [{ color: '#6b7280', count: 1 }] }],
])
const registry = { get: key => sites.get(key) }
const siteLeaves = [{ properties: { site_key: 'a' } }, { properties: { site_key: 'b' } }]

function fixture(getClusterLeaves) {
  const layers = { clusters: {}, 'cluster-count': {} }
  const images = new Map()
  const sources = { 'points-source': { getClusterLeaves } }
  const cluster = {
    type: 'Feature', geometry: { type: 'Point', coordinates: [-77, -1] },
    properties: { cluster: true, cluster_id: 42, point_count: 2, individuals: 4 },
  }
  const map = ref({
    isStyleLoaded: () => true,
    getSource: id => sources[id], getLayer: id => layers[id],
    queryRenderedFeatures: () => [cluster],
    addSource: vi.fn((id, options) => { sources[id] = { data: options.data, setData(data) { this.data = data } } }),
    removeSource: vi.fn(id => { delete sources[id] }),
    addLayer: vi.fn(layer => { layers[layer.id] = layer }),
    removeLayer: vi.fn(id => { delete layers[id] }),
    moveLayer: vi.fn(),
    hasImage: id => images.has(id),
    addImage: vi.fn((id, data) => images.set(id, data)),
    removeImage: vi.fn(id => images.delete(id)),
    on: vi.fn(), off: vi.fn(),
  })
  const layer = useClusterComposition(map)
  layer.invalidate(null, registry)
  return { layer, map, sources, layers, images }
}

function mockCanvas() {
  const original = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ({
      beginPath() {}, arc() {}, stroke() {}, getImageData: () => ({ width: 70, height: 70, data: new Uint8ClampedArray(70 * 70 * 4) }),
    }) }
    : original(tag))
}

afterEach(() => vi.restoreAllMocks())

describe('cluster composition layer', () => {
  it('discards an exact membership response after data invalidation', async () => {
    let resolveLeaves
    const leaves = new Promise(resolve => { resolveLeaves = resolve })
    const { layer, map } = fixture(() => leaves)
    const pending = layer.refresh()
    layer.invalidate(null, registry)
    resolveLeaves(siteLeaves)
    await pending
    expect(map.value.addSource).not.toHaveBeenCalled()
    expect(map.value.addImage).not.toHaveBeenCalled()
  })

  it('adds native ring images below count labels and reuses exact member results', async () => {
    mockCanvas()
    const getLeaves = vi.fn(async () => siteLeaves)
    const { layer, map, sources, layers, images } = fixture(getLeaves)
    layer.attach()
    await layer.refresh()
    expect(getLeaves).toHaveBeenCalledWith(42, 2, 0)
    expect(sources['cluster-composition-source'].data.features).toHaveLength(1)
    expect(map.value.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'cluster-composition-rings', type: 'symbol' }))
    expect(images.size).toBe(1)
    await layer.refresh()
    expect(getLeaves).toHaveBeenCalledTimes(1)

    delete layers['cluster-composition-rings']
    images.clear() // A new map style drops custom images.
    await layer.refresh()
    expect(map.value.addImage).toHaveBeenCalledTimes(2)
    expect(getLeaves).toHaveBeenCalledTimes(1)
    layer.cleanup()
    expect(map.value.off).toHaveBeenCalledWith('idle', expect.any(Function))
    expect(images.size).toBe(0)
  })

  it('keeps plain clusters when sites are coloured by individuals', async () => {
    const getLeaves = vi.fn(async () => siteLeaves)
    const { layer, map } = fixture(getLeaves)
    state.data.colorPlan = { mode: 'individuals' }
    try {
      await layer.refresh()
      expect(getLeaves).not.toHaveBeenCalled()
      expect(map.value.addLayer).not.toHaveBeenCalled()
    } finally {
      state.data.colorPlan = { mode: 'categories' }
    }
  })
})
