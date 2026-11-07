import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFilterStore, parseSourceParam, SOURCE_URL_KEYS } from '../filterStore'

const ALL = ['Sanger Institute', 'GBIF (UNAM)', 'GBIF (Other Institutions)', 'Dore et al. (2022)', 'iNaturalist']

describe('source URL parameter', () => {
  beforeAll(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 })))
  afterAll(() => vi.unstubAllGlobals())
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    window.history.replaceState({}, '', '/')
  })

  it('maps short keys to the source names', () => {
    expect(parseSourceParam('sanger,gbif_unam,gbif_other,dore,inaturalist')).toEqual(ALL)
    expect(Object.values(SOURCE_URL_KEYS)).toEqual(ALL)
  })

  it('keeps full names, mixes them with keys and drops repeats', () => {
    expect(parseSourceParam('Sanger Institute,GBIF (UNAM)')).toEqual(['Sanger Institute', 'GBIF (UNAM)'])
    expect(parseSourceParam('sanger,Sanger Institute,iNaturalist,INATURALIST')).toEqual(['Sanger Institute', 'iNaturalist'])
  })

  it('all is every source the data has', () => {
    expect(parseSourceParam('all', ['Sanger Institute', 'iNaturalist'])).toEqual(['Sanger Institute', 'iNaturalist'])
  })

  it('a link with + for spaces and short source keys restores the filters', () => {
    window.history.replaceState({}, '', '/?sp=Tithorea+harmonia,Oleria+onega&source=sanger,inaturalist&map_view=-77.69112,-0.95153,9.00')
    const store = useFilterStore()
    store.restoreFiltersFromURL()
    expect(store.filters.species).toEqual(['Tithorea harmonia', 'Oleria onega'])
    expect(store.filters.source).toEqual(['Sanger Institute', 'iNaturalist'])
  })

  it('source=all selects every source in the manifest', () => {
    window.history.replaceState({}, '', '/?source=all')
    const store = useFilterStore()
    store.restoreFiltersFromURL()
    expect(store.filters.source).toEqual(ALL)
  })
})
