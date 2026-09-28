import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useViewStore } from '../viewStore'
import { useFilterStore } from '../filterStore'

describe('useViewStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shares and restores plain clusters without changing taxonomic colours', async () => {
    window.history.replaceState({}, '', '/')
    const store = useViewStore()
    expect(store.clusterSettings.compositionRings).toBe(true)
    store.clusterSettings.compositionRings = false
    await nextTick()
    expect(new URLSearchParams(window.location.search).get('cluster_style')).toBe('plain')
    store.clusterSettings.compositionRings = true
    store.restoreVisualizationFromURL()
    expect(store.clusterSettings.compositionRings).toBe(false)
    expect(store.colorBy).toBe('species')
    window.history.replaceState({}, '', '/')
  })

  it('starts in points visualization mode', () => {
    const store = useViewStore()

    expect(store.visualizationMode).toBe('points')
  })

  it('starts with clustering disabled', () => {
    const store = useViewStore()

    expect(store.clusteringEnabled).toBe(false)
  })

  it('exposes the export settings structure', () => {
    const store = useViewStore()

    expect(store.exportSettings).toMatchObject({
      enabled: false,
      aspectRatio: '16:9',
      customWidth: 1920,
      customHeight: 1080,
      showCoordinates: true,
      includeLegend: true,
      includeScaleBar: true,
      includeAttribution: true,
      uiScale: 1,
      format: 'png',
      dpi: 150,
    })
  })

  it('defaults colorBy to species', () => {
    const store = useViewStore()

    expect(store.colorBy).toBe('species')
  })

  it('colours by subspecies for one species or a subspecies filter until a level is chosen', async () => {
    const store = useViewStore()
    const filters = useFilterStore()
    filters.filters.species = ['Ithomia salapia']
    await nextTick()
    expect(store.colorBy).toBe('subspecies')
    filters.filters.species = ['Ithomia salapia', 'Mechanitis polymnia']
    await nextTick()
    expect(store.colorBy).toBe('species')
    filters.filters.subspecies = ['derasa']
    await nextTick()
    expect(store.colorBy).toBe('subspecies')

    store.setColorBy('species')
    filters.filters.species = ['Ithomia salapia']
    await nextTick()
    expect(store.colorBy).toBe('species')

    filters.filters.species = []
    filters.filters.subspecies = []
    await nextTick()
    store.resetVisualizationState()
    expect(store.colorByChosen).toBe(false)
    filters.filters.species = ['Ithomia salapia']
    await nextTick()
    expect(store.colorBy).toBe('subspecies')
  })
})
