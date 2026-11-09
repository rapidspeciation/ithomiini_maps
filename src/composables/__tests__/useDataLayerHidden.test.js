// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useDataStore } from '../../stores/data'
import { useDatasetStore } from '../../stores/datasetStore'
import { useLegendStore } from '../../stores/legend'
import { useDataLayer } from '../useDataLayer'

// Hiding a legend item hides its records on the map (replaces the copy of this filter in legendLogic.test.js).
const record = (id, scientific_name) => ({
  id, scientific_name, genus: scientific_name.split(' ')[0], source: 'Sanger Institute', lat: -1, lng: -78,
})

// Any MapLibre call answers undefined: the test reads the records the layer was given, not the drawing.
const fakeMap = () => new Proxy({}, { get: (_, key) => (key === 'then' ? undefined : vi.fn()) })

describe('map data layer and the legend', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    useDatasetStore().allFeatures = [
      record('CAM001', 'Mechanitis polymnia'),
      record('CAM002', 'Mechanitis polymnia'),
      record('CAM003', 'Melinaea menophilus'),
    ]
  })

  function drawnIds(hiddenItems) {
    const store = useDataStore()
    store.setColorBy('species')
    store.visualizationMode = 'heatmap' // keeps one feature per record, no site markers
    useLegendStore().hiddenItems = hiddenItems
    let drawn = null
    const { addDataLayer } = useDataLayer(ref(fakeMap()), { onDataChanged: data => { drawn = data } })
    addDataLayer({ skipZoom: true })
    return drawn.features.map(f => f.properties.id)
  }

  it('draws every filtered record when nothing is hidden', () => {
    expect(drawnIds([])).toEqual(['CAM001', 'CAM002', 'CAM003'])
  })

  it('leaves out the records of a hidden legend item and keeps the others', () => {
    expect(drawnIds(['Mechanitis polymnia'])).toEqual(['CAM003'])
  })
})
