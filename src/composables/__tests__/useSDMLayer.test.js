import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { useSDMStore } from '../../stores/sdm'
import { useSDMLayer } from '../useSDMLayer'

async function fixtureFetch(url) {
  try {
    const buffer = await readFile(path.join(process.cwd(), 'public', url.replace(/^\//, '')))
    return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }
  } catch {
    return { ok: false }
  }
}

function fakeMap() {
  const layers = new Map()
  const sources = new Map()
  return {
    layers, sources,
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayer: id => layers.get(id),
    getSource: id => sources.get(id),
    addSource: vi.fn((id, source) => sources.set(id, source)),
    addLayer: vi.fn((layer, before) => {
      if (before && !layers.has(before)) throw Error('missing before layer')
      layers.set(layer.id, layer)
    }),
    removeLayer: vi.fn(id => layers.delete(id)),
    removeSource: vi.fn(id => sources.delete(id)),
    on: vi.fn(), off: vi.fn(),
    setPaintProperty: vi.fn((id, key, value) => { layers.get(id).paint[key] = value }),
  }
}

const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }

describe('useSDMLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(fixtureFetch))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: vi.fn(),
    }))
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,test')
  })

  function setup(species = ['Ithomia agnosia']) {
    const store = useSDMStore()
    store.metadata = { n_species: species.length, species: species.map(name => ({ species: name })) }
    store.selectedSpecies = species
    store.enabled = true
    const map = fakeMap()
    const layer = useSDMLayer(ref(map))
    return { store, map, layer }
  }

  it('changes opacity without downloading or rebuilding TIFF layers', async () => {
    const { store, map, layer } = setup()
    await layer.updateLayer()
    const requests = fetch.mock.calls.length
    store.opacity = 0.35
    await settle()
    expect(fetch).toHaveBeenCalledTimes(requests)
    expect(map.getLayer('sdm-layer-0').paint['raster-opacity']).toBe(0.35)
    expect(map.setPaintProperty).toHaveBeenCalledWith('sdm-layer-0', 'raster-opacity', 0.35)
  })

  it('restores two raster layers after a style reset without new TIFF requests', async () => {
    const { map, layer } = setup(['Ithomia agnosia', 'Aeria elara'])
    map.layers.set('points-layer', { id: 'points-layer' })
    await layer.updateLayer()
    const requests = fetch.mock.calls.length
    map.layers.clear(); map.sources.clear()
    map.layers.set('points-layer', { id: 'points-layer' })
    await layer.updateLayer()
    expect(fetch).toHaveBeenCalledTimes(requests)
    expect(map.getLayer('sdm-layer-0')).toBeTruthy()
    expect(map.getLayer('sdm-layer-1')).toBeTruthy()
    expect(map.addLayer).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sdm-layer-1' }), 'points-layer')
  })

  it('keeps the first raster intact when adding a second species', async () => {
    const { store, map, layer } = setup(['Ithomia agnosia', 'Aeria elara'])
    store.selectedSpecies = ['Ithomia agnosia']
    await layer.updateLayer()
    const firstSource = map.getSource('sdm-source-0')
    map.removeLayer.mockClear()
    map.removeSource.mockClear()
    // Some style transitions retain the existing custom source until the
    // replacement style finishes loading.
    layer.invalidatePending()
    store.selectedSpecies = ['Ithomia agnosia', 'Aeria elara']
    await layer.updateLayer()
    expect(map.getSource('sdm-source-0')).toBe(firstSource)
    expect(map.getLayer('sdm-layer-1')).toBeTruthy()
    expect(map.removeLayer).not.toHaveBeenCalledWith('sdm-layer-0')
    expect(map.removeSource).not.toHaveBeenCalledWith('sdm-source-0')
  })

  it.each([
    ['range-fill', 'range-fill'],
    ['heatmap-layer', 'heatmap-layer'],
    ['clusters', 'clusters'],
    ['host-plant-layer', 'host-plant-layer'],
  ])('places SDM below %s when points-layer is absent', async (overlay, before) => {
    const { map, layer } = setup()
    map.layers.set(overlay, { id: overlay })
    await layer.updateLayer()
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sdm-layer-0' }), before)
  })

  it('places SDM below the earliest scientific layer, including hosts', async () => {
    const { map, layer } = setup()
    map.layers.set('base', { id: 'base' })
    map.layers.set('host-plant-layer', { id: 'host-plant-layer' })
    map.layers.set('points-layer', { id: 'points-layer' })
    await layer.updateLayer()
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sdm-layer-0' }), 'host-plant-layer')
  })

  it('ignores an obsolete request after selecting another species', async () => {
    const { store, map, layer } = setup(['Ithomia agnosia', 'Aeria elara'])
    let releaseOld
    const blocked = new Promise(resolve => { releaseOld = resolve })
    fetch.mockImplementation(async url => {
      if (url.includes('ithomia_agnosia_ensemble_core')) await blocked
      return fixtureFetch(url)
    })
    store.selectedSpecies = ['Ithomia agnosia']
    const old = layer.updateLayer()
    store.selectedSpecies = ['Aeria elara']
    const current = layer.updateLayer()
    await current
    expect(map.getLayer('sdm-layer-0')).toBeTruthy()
    const additions = map.addLayer.mock.calls.length
    releaseOld()
    await old
    await settle()
    expect(map.getLayer('sdm-layer-0')).toBeTruthy()
    expect(map.addLayer).toHaveBeenCalledTimes(additions)
  })

  it('does not add a pending raster during a style switch', async () => {
    const { map, layer } = setup()
    let release
    const blocked = new Promise(resolve => { release = resolve })
    fetch.mockImplementation(async url => {
      await blocked
      return fixtureFetch(url)
    })
    const pending = layer.updateLayer()
    layer.invalidatePending()
    release()
    await pending
    expect(map.getLayer('sdm-layer-0')).toBeUndefined()
  })

  it('keeps latest species and opacity edits made while MapLibre has no style', async () => {
    const { store, map, layer } = setup(['Ithomia agnosia', 'Aeria elara'])
    store.selectedSpecies = ['Ithomia agnosia']
    await layer.updateLayer()
    let styleAvailable = false
    const getLayer = map.getLayer
    map.getStyle = () => styleAvailable ? { version: 8 } : undefined
    map.getLayer = id => {
      if (!styleAvailable) throw Error('style is undefined')
      return getLayer(id)
    }

    store.opacity = 0.4
    store.selectedSpecies = ['Ithomia agnosia', 'Aeria elara']
    await settle()
    expect(map.addLayer).toHaveBeenCalledTimes(1)

    map.layers.clear(); map.sources.clear()
    styleAvailable = true
    await layer.updateLayer() // MapEngine's onStyleIdle callback
    expect(map.getLayer('sdm-layer-0').paint['raster-opacity']).toBe(0.4)
    expect(map.getLayer('sdm-layer-1').paint['raster-opacity']).toBe(0.4)
  })
})
