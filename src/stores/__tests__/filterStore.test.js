import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useDatasetStore } from '../datasetStore'
import { useFilterStore } from '../filterStore'

const makeFeature = (overrides = {}) => ({
  id: 'CAM001',
  scientific_name: 'Mechanitis menophilus',
  subspecies: 'nevadensis',
  family: 'Nymphalidae',
  tribe: 'Ithomiini',
  genus: 'Mechanitis',
  mimicry_ring: 'Tiger',
  sequencing_status: 'Sequenced',
  source: 'Sanger Institute',
  country: 'Ecuador',
  sex: 'male',
  lat: -1,
  lng: -78,
  date: '2023-05-15',
  observation_date: '2023-05-15',
  ...overrides,
})

describe('useFilterStore', () => {
  // These tests exercise local filter state only. An incidental data request
  // should never reach a dev server that is not running during Vitest.
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
  })

  afterAll(() => vi.unstubAllGlobals())

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('groups subspecies options under the selected species', () => {
    const dataset = useDatasetStore()
    const store = useFilterStore()
    dataset.allFeatures = [
      makeFeature({ scientific_name: 'Ithomia salapia', subspecies: 'travella' }),
      makeFeature({ scientific_name: 'Ithomia salapia', subspecies: 'derasa' }),
      makeFeature({ scientific_name: 'Mechanitis polymnia', subspecies: 'proceriformis' }),
      makeFeature({ scientific_name: 'Unselected species', subspecies: 'unrelated' }),
    ]
    store.filters.species = ['Mechanitis polymnia', 'Ithomia salapia']
    expect(store.subspeciesOptionGroups).toEqual([
      { label: 'Ithomia salapia', options: ['derasa', 'travella'] },
      { label: 'Mechanitis polymnia', options: ['proceriformis'] },
    ])
  })

  it('starts with the expected default filter state', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()

    expect(datasetStore.loadedSources.size).toBe(0)
    expect(filterStore.filters).toMatchObject({
      family: [],
      tribe: [],
      genus: [],
      species: [],
      subspecies: [],
      mimicry: [],
      status: [],
      source: ['Sanger Institute'],
      sex: 'all',
      country: [],
      collectionLocation: [],
      camidSearch: '',
      dateStart: null,
      dateEnd: null,
      goatCoverage: 'all',
      goatDataSource: [],
      goatChromosomeMin: null,
      goatChromosomeMax: null,
    })
  })

  it('resetAllFilters resets everything', () => {
    const filterStore = useFilterStore()

    filterStore.filters.family = ['Nymphalidae']
    filterStore.filters.tribe = ['Ithomiini']
    filterStore.filters.genus = ['Mechanitis']
    filterStore.filters.species = ['Mechanitis menophilus']
    filterStore.filters.subspecies = ['nevadensis']
    filterStore.filters.mimicry = ['Tiger']
    filterStore.filters.status = ['Sequenced']
    filterStore.filters.source = ['GBIF (UNAM)']
    filterStore.filters.sex = 'female'
    filterStore.filters.country = ['Ecuador']
    filterStore.filters.collectionLocation = ['Suchipakari']
    filterStore.filters.camidSearch = 'CAM001'
    filterStore.filters.dateStart = '2023-01-01'
    filterStore.filters.dateEnd = '2023-12-31'
    filterStore.filters.goatCoverage = 'in_goat'
    filterStore.filters.goatDataSource = ['direct']
    filterStore.filters.goatChromosomeMin = 10
    filterStore.filters.goatChromosomeMax = 20
    filterStore.boundingBox = { sw: { lng: -80, lat: -10 }, ne: { lng: -70, lat: 0 } }

    filterStore.resetAllFilters()

    expect(filterStore.filters).toMatchObject({
      family: [],
      tribe: [],
      genus: [],
      species: [],
      subspecies: [],
      mimicry: [],
      status: [],
      source: ['Sanger Institute'],
      sex: 'all',
      country: [],
      collectionLocation: [],
      camidSearch: '',
      dateStart: null,
      dateEnd: null,
      goatCoverage: 'all',
      goatDataSource: [],
      goatChromosomeMin: null,
      goatChromosomeMax: null,
    })
    expect(filterStore.boundingBox).toBeNull()
  })

  it('keeps dependent filters intact when family changes (additive filter model)', async () => {
    const filterStore = useFilterStore()

    filterStore.filters.tribe = ['Ithomiini']
    filterStore.filters.genus = ['Mechanitis']
    filterStore.filters.species = ['Mechanitis menophilus']
    filterStore.filters.subspecies = ['nevadensis']

    filterStore.filters.family = ['Nymphalidae']
    await nextTick()

    expect(filterStore.filters.tribe).toEqual(['Ithomiini'])
    expect(filterStore.filters.genus).toEqual(['Mechanitis'])
    expect(filterStore.filters.species).toEqual(['Mechanitis menophilus'])
    expect(filterStore.filters.subspecies).toEqual(['nevadensis'])
  })

  it('computes unique species and subspecies from mock data', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()

    datasetStore.allFeatures = [
      makeFeature({ id: 'CAM001', scientific_name: 'Mechanitis menophilus', subspecies: 'nevadensis' }),
      makeFeature({ id: 'CAM002', scientific_name: 'Mechanitis menophilus', subspecies: 'Unknown' }),
      makeFeature({ id: 'CAM003', scientific_name: 'Mechanitis polymnia', subspecies: 'casabranca' }),
      makeFeature({ id: 'CAM004', scientific_name: 'Mechanitis polymnia', subspecies: 'NA' }),
    ]

    expect(filterStore.uniqueSpecies).toEqual([
      'Mechanitis menophilus',
      'Mechanitis polymnia',
    ])
    expect(filterStore.uniqueSubspecies).toEqual([
      'casabranca',
      'nevadensis',
    ])
  })

  it('offers exact collection locations from selected sources and retains selected names', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()
    datasetStore.allFeatures = [
      makeFeature({ id: 'S1', collection_location: 'Mindo, Ecuador' }),
      makeFeature({ id: 'S2', collection_location: 'Suchipakari' }),
      makeFeature({ id: 'S3', collection_location: '  ' }),
      makeFeature({ id: 'S4', collection_location: 'Unknown' }),
      makeFeature({ id: 'G1', source: 'GBIF (UNAM)', collection_location: 'Yasuní' }),
    ]

    expect(filterStore.uniqueCollectionLocations).toEqual(['Mindo, Ecuador', 'Suchipakari'])

    filterStore.filters.collectionLocation = ['Mindo, Ecuador']
    filterStore.filters.source = ['GBIF (UNAM)']
    expect(filterStore.uniqueCollectionLocations).toEqual(['Mindo, Ecuador', 'Yasuní'])

    filterStore.filters.source = ['Sanger Institute', 'GBIF (UNAM)']
    expect(filterStore.uniqueCollectionLocations).toEqual(['Mindo, Ecuador', 'Suchipakari', 'Yasuní'])
  })

  it('ORs collection locations and intersects them with source and taxonomy', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()
    datasetStore.allFeatures = [
      makeFeature({ id: 'S1', scientific_name: 'Mechanitis polymnia', collection_location: 'Suchipakari' }),
      makeFeature({ id: 'S2', scientific_name: 'Mechanitis polymnia', collection_location: 'Ikiam' }),
      makeFeature({ id: 'S3', scientific_name: 'Mechanitis polymnia', collection_location: 'Mindo' }),
      makeFeature({ id: 'S4', scientific_name: 'Ithomia salapia', collection_location: 'Suchipakari' }),
      makeFeature({ id: 'G1', scientific_name: 'Mechanitis polymnia', source: 'GBIF (UNAM)', collection_location: 'Suchipakari' }),
    ]
    filterStore.filters.species = ['Mechanitis polymnia']
    filterStore.filters.collectionLocation = ['Suchipakari', 'Ikiam']

    expect(filterStore.filteredGeoJSON.features.map(feature => feature.properties.id)).toEqual(['S1', 'S2'])
  })

  it('round-trips comma-containing collection locations in shared links and resets them', () => {
    const filterStore = useFilterStore()
    filterStore.filters.collectionLocation = ['Mindo, Ecuador', 'Suchipakari']
    const params = new URLSearchParams()
    filterStore.appendFilterURLParams(params)
    expect(JSON.parse(params.get('locality'))).toEqual(['Mindo, Ecuador', 'Suchipakari'])
    window.history.replaceState({}, '', `/?${params}`)

    setActivePinia(createPinia())
    const restored = useFilterStore()
    restored.restoreFiltersFromURL()
    expect(restored.filters.collectionLocation).toEqual(['Mindo, Ecuador', 'Suchipakari'])
    restored.resetAllFilters()
    expect(restored.filters.collectionLocation).toEqual([])
    window.history.replaceState({}, '', '/')
  })

  it('orders accepted species matches before synonym species matches', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()

    datasetStore.allFeatures = [
      makeFeature({ scientific_name: 'Mechanitis polymnia', genus: 'Mechanitis' }),
      makeFeature({ scientific_name: 'Mechanitis lysimnia', genus: 'Mechanitis' }),
    ]
    datasetStore.taxonomySynonyms = [
      { synonym: 'Methona polymnia', accepted: 'Mechanitis lysimnia' },
      { synonym: 'Papilio polymnia', accepted: 'Mechanitis polymnia' },
    ]

    const matches = filterStore.filterSpeciesOptions(filterStore.speciesFilterOptions, 'polymn')

    expect(matches).toEqual([
      expect.objectContaining({ label: 'Mechanitis polymnia', value: 'Mechanitis polymnia' }),
      expect.objectContaining({
        label: 'Mechanitis lysimnia',
        value: 'Mechanitis lysimnia',
        synonymMeta: 'synonym: Methona polymnia',
      }),
    ])
  })

  it('does not show synonyms for an accepted species text match', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()

    datasetStore.allFeatures = [
      makeFeature({ scientific_name: 'Mechanitis polymnia', genus: 'Mechanitis' }),
    ]
    datasetStore.taxonomySynonyms = [
      { synonym: 'Mechanitis angustifascia', accepted: 'Mechanitis polymnia' },
      { synonym: 'Mechanitis apicenotata', accepted: 'Mechanitis polymnia' },
    ]

    const matches = filterStore.filterSpeciesOptions(filterStore.speciesFilterOptions, 'poly')

    expect(matches).toEqual([
      expect.objectContaining({ label: 'Mechanitis polymnia', value: 'Mechanitis polymnia' }),
    ])
  })

  it('filters GeoJSON with the active filter state', () => {
    const datasetStore = useDatasetStore()
    const filterStore = useFilterStore()

    datasetStore.allFeatures = [
      makeFeature({
        id: 'CAM001',
        scientific_name: 'Mechanitis menophilus',
        subspecies: 'nevadensis',
        mimicry_ring: 'Tiger',
        sequencing_status: 'Sequenced',
        sex: 'male',
        lat: -1.2,
        lng: -78.5,
      }),
      makeFeature({
        id: 'CAM002',
        scientific_name: 'Mechanitis menophilus',
        subspecies: 'nevadensis',
        mimicry_ring: 'Tiger',
        sequencing_status: 'Sequenced',
        sex: 'female',
        lat: -1.25,
        lng: -78.45,
      }),
    ]

    filterStore.filters.family = ['Nymphalidae']
    filterStore.filters.tribe = ['Ithomiini']
    filterStore.filters.genus = ['Mechanitis']
    filterStore.filters.species = ['Mechanitis menophilus']
    filterStore.filters.subspecies = ['nevadensis']
    filterStore.filters.mimicry = ['Tiger']
    filterStore.filters.status = ['Sequenced']
    filterStore.filters.country = ['Ecuador']
    filterStore.filters.sex = 'male'
    filterStore.filters.camidSearch = 'cam001'

    const geojson = filterStore.filteredGeoJSON

    expect(geojson).toMatchObject({ type: 'FeatureCollection' })
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties.id).toBe('CAM001')
    expect(geojson.features[0].geometry.coordinates).toEqual([-78.5, -1.2])
  })

  const mixedTargets = () => [
    makeFeature({ id: 'P1', scientific_name: 'Mechanitis polymnia', subspecies: 'casabranca' }),
    makeFeature({ id: 'P2', scientific_name: 'Mechanitis polymnia', subspecies: 'Unknown' }),
    makeFeature({ id: 'L1', scientific_name: 'Mechanitis lysimnia', subspecies: 'solaria' }),
    makeFeature({ id: 'I1', scientific_name: 'Ithomia salapia', subspecies: 'travella' }),
    makeFeature({ id: 'I2', scientific_name: 'Ithomia salapia', subspecies: 'derasa' }),
    makeFeature({ id: 'I3', scientific_name: 'Ithomia salapia', subspecies: 'other' }),
    makeFeature({ id: 'X1', scientific_name: 'Mechanitis menapis', subspecies: 'travella' }),
  ]
  const filteredIds = store => store.filteredGeoJSON.features.map(feature => feature.properties.id)

  it('narrows only the species that own the selected subspecies', () => {
    const dataset = useDatasetStore()
    const store = useFilterStore()
    dataset.allFeatures = mixedTargets()
    store.filters.species = ['Mechanitis polymnia', 'Mechanitis lysimnia', 'Ithomia salapia']
    store.filters.subspecies = ['travella', 'derasa']

    expect(filteredIds(store)).toEqual(['P1', 'P2', 'L1', 'I1', 'I2'])
    expect(store.taxonTargets.map(target => target.label)).toEqual([
      'Mechanitis polymnia', 'Mechanitis lysimnia', 'Ithomia salapia derasa', 'Ithomia salapia travella',
    ])
  })

  it('applies subspecies globally when no species is selected', () => {
    const dataset = useDatasetStore()
    const store = useFilterStore()
    dataset.allFeatures = mixedTargets()
    store.filters.subspecies = ['travella']
    expect(filteredIds(store)).toEqual(['I1', 'X1'])
    expect(store.taxonTargets).toEqual([])
  })

  it('keeps the OR combinator as a global species-or-subspecies match', () => {
    const dataset = useDatasetStore()
    const store = useFilterStore()
    dataset.allFeatures = mixedTargets()
    store.filters.species = ['Mechanitis lysimnia']
    store.filters.subspecies = ['travella']
    store.filters.taxonomyCombinators = { ...store.filters.taxonomyCombinators, subspecies: 'OR' }
    expect(filteredIds(store)).toEqual(['L1', 'I1', 'X1'])
  })

  it('round-trips scoped selections through ordinary sp and ssp link parameters', () => {
    const dataset = useDatasetStore()
    const store = useFilterStore()
    store.filters.species = ['Mechanitis polymnia', 'Ithomia salapia']
    store.filters.subspecies = ['travella']
    const params = new URLSearchParams()
    store.appendFilterURLParams(params)
    expect(params.get('sp')).toBe('Mechanitis polymnia,Ithomia salapia')
    expect(params.get('ssp')).toBe('travella')
    window.history.replaceState({}, '', `/?${params}`)

    setActivePinia(createPinia())
    useDatasetStore().allFeatures = mixedTargets()
    const restored = useFilterStore()
    restored.restoreFiltersFromURL()
    expect(filteredIds(restored)).toEqual(['P1', 'P2', 'I1'])
    window.history.replaceState({}, '', '/')
    expect(dataset).toBeTruthy()
  })
})
