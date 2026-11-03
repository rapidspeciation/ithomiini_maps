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

  it('round-trips style, color_by, bbox and export through syncURLState', async () => {
    const query = '?sp=Tithorea+harmonia&sex=female&sites=1&style=terrain&color_by=species&bbox=-78.1%2C-1.3%2C-76.9%2C-0.4&export=1'
    window.history.replaceState({}, '', `/${query}`)
    const store = useViewStore()
    const filters = useFilterStore()
    filters.restoreFiltersFromURL()
    store.restoreVisualizationFromURL()
    expect(store.basemap).toBe('terrain')
    expect(store.colorBy).toBe('species')
    store.syncURLState()
    const params = new URLSearchParams(window.location.search)
    expect(params.get('style')).toBe('terrain')
    expect(params.get('color_by')).toBe('species')
    expect(params.get('bbox')).toBe('-78.1,-1.3,-76.9,-0.4')
    expect(params.get('export')).toBe('1')
    expect(params.get('sp')).toBe('Tithorea harmonia')
    expect(params.get('sex')).toBe('female')
    expect(params.get('sites')).toBe('1')

    // A second store reading the synchronized link restores the same state.
    setActivePinia(createPinia())
    const again = useViewStore()
    useFilterStore().restoreFiltersFromURL()
    again.restoreVisualizationFromURL()
    expect(again.basemap).toBe('terrain')
    expect(again.colorBy).toBe('species')
    window.history.replaceState({}, '', '/')
  })

  it('drops unknown style and color_by values instead of guessing', () => {
    window.history.replaceState({}, '', '/?style=watercolor&color_by=wingspan')
    const store = useViewStore()
    store.restoreVisualizationFromURL()
    expect(store.basemap).toBe(null)
    expect(store.colorByChosen).toBe(false)
    store.syncURLState()
    const params = new URLSearchParams(window.location.search)
    expect(params.has('style')).toBe(false)
    expect(params.has('color_by')).toBe(false)
    window.history.replaceState({}, '', '/')
  })

  it('export=1 fixes the picture settings, uses the light basemap and never stores them', async () => {
    localStorage.setItem('app-persist-enabled', 'true')
    localStorage.setItem('app-export-settings', JSON.stringify({ aspectRatio: '16:9', dpi: 300, includeLegend: false }))
    window.history.replaceState({}, '', '/?export=1')
    const store = useViewStore()
    expect(store.exportMode).toBe(true)
    expect(store.basemap).toBe('light')
    expect(store.exportSettings).toMatchObject({ enabled: true, aspectRatio: '4:3', dpi: 100, format: 'png', uiScale: 1,
      includeLegend: true, includeScaleBar: true, includeAttribution: true })
    store.exportSettings.dpi = 120
    await nextTick()
    expect(JSON.parse(localStorage.getItem('app-export-settings'))).toMatchObject({ aspectRatio: '16:9', dpi: 300 })
    window.history.replaceState({}, '', '/')
  })

  it('a color_by from the link applies to the visit only; a colour picked later is stored', async () => {
    localStorage.setItem('app-persist-enabled', 'true')
    window.history.replaceState({}, '', '/?color_by=genus')
    const store = useViewStore()
    store.restoreVisualizationFromURL()
    await nextTick()
    expect(store.colorBy).toBe('genus')
    expect(localStorage.getItem('map-color-by')).toBe(null)
    store.setColorBy('species')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('map-color-by'))).toBe('species')
    window.history.replaceState({}, '', '/')
  })

  it('export=1 never stores a colour level', async () => {
    localStorage.setItem('app-persist-enabled', 'true')
    window.history.replaceState({}, '', '/?export=1')
    const store = useViewStore()
    store.setColorBy('species')
    await nextTick()
    expect(localStorage.getItem('map-color-by')).toBe(null)
    window.history.replaceState({}, '', '/')
  })
})

