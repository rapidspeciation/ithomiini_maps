import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useHostPlantStore } from '../hostPlants'
import { useFilterStore } from '../filterStore'
import { useViewStore } from '../viewStore'
import { countryOfPoint, makeRegionTest } from '../../utils/countryLookup'

const manifest = {
  metadata: {
    occurrence_store_version: 2,
    occurrence_refs_by_taxon: {
      species_mesechites_trifida: 'taxon_occurrence_refs/species_mesechites_trifida.json',
    },
    gallery_indexes_by_taxon: {},
  },
  taxa: [
    { canonical_name: 'Mesechites trifida', slug: 'species_mesechites_trifida', rank: 'species', family: 'Apocynaceae', occurrence_count: 3 },
    { canonical_name: 'Prestonia quinquangularis', slug: 'species_prestonia_quinquangularis', rank: 'species', family: 'Apocynaceae', occurrence_count: 5 },
    { canonical_name: 'Prestonia', slug: 'genus_prestonia', rank: 'genus', family: 'Apocynaceae', occurrence_count: 9 },
    { canonical_name: 'Fernaldia pandurata', slug: 'species_fernaldia_pandurata', rank: 'species', family: 'Apocynaceae', occurrence_count: 2 },
  ],
}

const association = (butterfly, slug, name, level, evidence, confidence) => ({
  butterfly_taxon: butterfly,
  host_taxon_slug: slug,
  host_taxon_name: name,
  host_id_level: level,
  evidence_level: evidence,
  confidence,
})

const associations = {
  associations: [
    association('Tithorea harmonia', 'species_mesechites_trifida', 'Mesechites trifida', 'species', 'direct', 'high'),
    association('Tithorea harmonia', 'species_prestonia_quinquangularis', 'Prestonia quinquangularis', 'species', 'literature', 'medium'),
    association('Tithorea harmonia', 'genus_prestonia', 'Prestonia', 'genus', 'literature', 'medium'),
    association('Tithorea harmonia', 'species_fernaldia_pandurata', 'Fernaldia pandurata', 'species', 'needs_check', 'low'),
  ],
}

// Two square "countries" side by side.
const boundaries = {
  countries: [
    { name: 'Ecuador', bbox: [-80, -4, -76, 0], polygons: [[[[-80, -4], [-76, -4], [-76, 0], [-80, 0], [-80, -4]]]] },
    { name: 'Colombia', bbox: [-80, 0, -76, 4], polygons: [[[[-80, 0], [-76, 0], [-76, 4], [-80, 4], [-80, 0]]]] },
  ],
}

const ref = {
  stats_by_slug: { species_mesechites_trifida: { total_records: 3 } },
  chunks: { 'occurrence_chunks/chunk_001.json': [0, 1, 2] },
}
const chunk = {
  records: [
    { id: 'a', gbifID: 'a', lat: -1, lng: -78, scientific_name: 'Mesechites trifida' },
    { id: 'b', gbifID: 'b', lat: 2, lng: -78, scientific_name: 'Mesechites trifida' },
    { id: 'c', gbifID: 'c', lat: -2, lng: -77.5, scientific_name: 'Mesechites trifida' },
  ],
}

function stubFetch() {
  const fetchMock = vi.fn(async (url) => ({
    ok: true,
    json: async () => {
      const path = String(url)
      if (path.includes('manifest')) return manifest
      if (path.includes('associations')) return associations
      if (path.includes('country_boundaries')) return boundaries
      if (path.includes('taxon_occurrence_refs/species_mesechites_trifida')) return ref
      if (path.includes('occurrence_chunks/chunk_001')) return chunk
      throw new Error(`unexpected fetch ${url}`)
    },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const urlParams = () => new URLSearchParams(window.location.search)

describe('host plant layer in the URL', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('opens a butterfly\'s host plants from hp_bf alone', async () => {
    stubFetch()
    window.history.replaceState({}, '', '/?hp_bf=Tithorea%20harmonia')
    const store = useHostPlantStore()
    await store.restoreFromURL(urlParams())

    expect(store.filterButterflies).toEqual(['Tithorea harmonia'])
    expect(store.enabled).toBe(true)
    // Default: species-level hosts, observed or reported.
    expect([...store.selectedTaxonSlugs].sort()).toEqual(['species_mesechites_trifida', 'species_prestonia_quinquangularis'])
  })

  it('restores the levels, the evidence and plants named by name or slug', async () => {
    stubFetch()
    window.history.replaceState({}, '', '/?hp_bf=Tithorea%20harmonia&hp_level=species,genus&hp_evidence=direct,literature,needs_check&hp_taxa=Mesechites%20trifida,genus_prestonia,Not%20a%20plant&hp_opacity=60')
    const store = useHostPlantStore()
    await store.restoreFromURL(urlParams())

    expect(store.filterHostIdLevels).toEqual(['species', 'genus'])
    expect(store.filterEvidenceLevels).toEqual(['direct', 'literature', 'needs_check'])
    expect(store.selectedTaxonSlugs).toEqual(['species_mesechites_trifida', 'genus_prestonia'])
    expect(store.opacity).toBeCloseTo(0.6)
    // Changing a level chooses the butterfly's plants again, as the sidebar always did.
    store.setFilterHostIdLevels(['species'])
    expect([...store.selectedTaxonSlugs].sort()).toEqual(['species_fernaldia_pandurata', 'species_mesechites_trifida', 'species_prestonia_quinquangularis'])
  })

  it('reads hp_conf as the evidence levels', async () => {
    stubFetch()
    window.history.replaceState({}, '', '/?hp_bf=Tithorea%20harmonia&hp_conf=high')
    const store = useHostPlantStore()
    await store.restoreFromURL(urlParams())
    expect(store.filterEvidenceLevels).toEqual(['direct'])
    expect(store.selectedTaxonSlugs).toEqual(['species_mesechites_trifida'])
  })

  it('ignores a link without host plant parameters', async () => {
    stubFetch()
    const store = useHostPlantStore()
    expect(store.restoreFromURL(new URLSearchParams('sp=Tithorea%20harmonia'))).toBe(false)
    expect(store.selectedTaxonSlugs).toEqual([])
    expect(store.enabled).toBe(false)
  })

  it('writes the UI choices to the URL and keeps them through a reload', async () => {
    stubFetch()
    useViewStore()
    const store = useHostPlantStore()
    await store.loadMetadata()

    store.setFilterButterflies(['Tithorea harmonia'])
    await nextTick()
    // Only the butterfly: its plants follow from it.
    expect(urlParams().get('hp_bf')).toBe('Tithorea harmonia')
    expect(urlParams().has('hp_taxa')).toBe(false)

    store.setFilterEvidenceLevels(['direct'])
    await nextTick()
    expect(urlParams().get('hp_evidence')).toBe('direct')
    expect(store.selectedTaxonSlugs).toEqual(['species_mesechites_trifida'])

    // A plant picked by hand is written out.
    store.setSelectedTaxa([...store.selectedTaxonSlugs, 'genus_prestonia'])
    await nextTick()
    expect(urlParams().get('hp_taxa')).toBe('species_mesechites_trifida,genus_prestonia')

    const shared = window.location.search
    setActivePinia(createPinia())
    window.history.replaceState({}, '', `/${shared}`)
    const reopened = useHostPlantStore()
    await reopened.restoreFromURL(urlParams())
    expect(reopened.filterButterflies).toEqual(['Tithorea harmonia'])
    expect(reopened.filterEvidenceLevels).toEqual(['direct'])
    expect(reopened.selectedTaxonSlugs).toEqual(['species_mesechites_trifida', 'genus_prestonia'])
  })

  it('leaves a switched-off layer out of the link, and keeps every plant unticked', async () => {
    stubFetch()
    useViewStore()
    const store = useHostPlantStore()
    await store.loadMetadata()
    store.restoreFromURL(new URLSearchParams())
    store.setFilterButterflies(['Tithorea harmonia'])
    store.toggleEnabled()
    await nextTick()
    expect(store.enabled).toBe(false)
    expect(urlParams().has('hp_bf')).toBe(false)
    store.toggleEnabled()
    store.setSelectedTaxa([])
    await nextTick()
    expect(urlParams().get('hp_bf')).toBe('Tithorea harmonia')
    expect(urlParams().get('hp_taxa')).toBe('')
    const shared = window.location.search
    setActivePinia(createPinia())
    window.history.replaceState({}, '', `/${shared}`)
    const reopened = useHostPlantStore()
    await reopened.restoreFromURL(urlParams())
    expect(reopened.filterButterflies).toEqual(['Tithorea harmonia'])
    expect(reopened.selectedTaxonSlugs).toEqual([])
  })

  it('does not rewrite the link when the sidebar switches the layer on before the link is read', async () => {
    stubFetch()
    window.history.replaceState({}, '', '/?sp=Tithorea%20harmonia&country=Ecuador&hp_bf=Tithorea%20harmonia')
    useViewStore()
    const store = useHostPlantStore()
    store.toggleEnabled()
    await nextTick()
    expect(urlParams().get('hp_bf')).toBe('Tithorea harmonia')
    expect(urlParams().get('country')).toBe('Ecuador')
    useFilterStore().restoreFiltersFromURL()
    await store.restoreFromURL(urlParams())
    expect(store.selectedTaxonSlugs.length).toBe(2)
  })

  it('ignores an hp_conf that is not a confidence', async () => {
    stubFetch()
    const store = useHostPlantStore()
    await store.restoreFromURL(new URLSearchParams('hp_bf=Tithorea%20harmonia&hp_conf=constructor'))
    expect(store.filterEvidenceLevels).toEqual(['direct', 'literature'])
  })

  it('keeps the link\'s plants in the URL while the metadata loads', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      await gate
      return { ok: true, json: async () => (String(url).includes('manifest') ? manifest : associations) }
    }))
    window.history.replaceState({}, '', '/?sp=Tithorea%20harmonia&hp_bf=Tithorea%20harmonia&hp_taxa=genus_prestonia')
    const view = useViewStore()
    useFilterStore().restoreFiltersFromURL()
    const restoring = useHostPlantStore().restoreFromURL(urlParams())
    view.syncURLState()
    expect(urlParams().get('hp_taxa')).toBe('genus_prestonia')
    expect(urlParams().get('sp')).toBe('Tithorea harmonia')
    release()
    await restoring
    expect(useHostPlantStore().selectedTaxonSlugs).toEqual(['genus_prestonia'])
  })

  it('restores the layer through the view store with the other filters', async () => {
    stubFetch()
    window.history.replaceState({}, '', '/?country=Ecuador&hp_bf=Tithorea%20harmonia&hp_conf=high')
    const view = useViewStore()
    useFilterStore().restoreFiltersFromURL()
    view.restoreVisualizationFromURL()
    const store = useHostPlantStore()
    await vi.waitFor(() => expect(store.selectedTaxonSlugs).toEqual(['species_mesechites_trifida']))
    await nextTick()
    expect(urlParams().get('country')).toBe('Ecuador')
    expect(urlParams().get('hp_bf')).toBe('Tithorea harmonia')
    expect(urlParams().get('hp_evidence')).toBe('direct')
  })

  it('limits the plant records to the countries and box asked', async () => {
    stubFetch()
    const store = useHostPlantStore()
    await store.loadOccurrences(['species_mesechites_trifida'])
    await store.loadCountryBoundaries()

    const ids = region => store.getOccurrenceCollectionForTaxa(['species_mesechites_trifida'], region).features.map(f => f.properties.id)
    expect(ids(null)).toEqual(['a', 'b', 'c'])
    expect(ids({ countries: ['Ecuador'] })).toEqual(['a', 'c'])
    expect(ids({ countries: ['colombia'] })).toEqual(['b'])
    expect(ids({ countries: ['Ecuador'], bbox: { sw: { lng: -78.5, lat: -1.5 }, ne: { lng: -77.8, lat: 0 } } })).toEqual(['a'])
  })
})

describe('countryLookup', () => {
  it('places points inside outlines and near a coast', () => {
    expect(countryOfPoint(-78, -1, boundaries)).toBe('Ecuador')
    expect(countryOfPoint(-78, 1, boundaries)).toBe('Colombia')
    // 0.03 degrees off the western edge: in no outline, counted in the nearest country.
    expect(countryOfPoint(-80.03, -2, boundaries)).toBe('Ecuador')
    expect(countryOfPoint(-81, -2, boundaries)).toBe(null)
  })

  it('reports countries the outlines do not know', () => {
    const test = makeRegionTest({ countries: ['Ecuador', 'Atlantis'] }, boundaries)
    expect(test.unknownCountries).toEqual(['atlantis'])
    expect(makeRegionTest({}, boundaries)).toBe(null)
  })

  it('places real places with the published outlines', () => {
    const real = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../public/data/country_boundaries.json'), 'utf8'))
    expect(countryOfPoint(-77.81, -0.99, real)).toBe('Ecuador') // Tena
    expect(countryOfPoint(-74.07, 4.71, real)).toBe('Colombia') // Bogotá
    expect(countryOfPoint(-77.03, -12.05, real)).toBe('Peru') // Lima
    expect(countryOfPoint(-52.33, 4.93, real)).toBe('French Guiana') // Cayenne
    expect(countryOfPoint(-90.3, -0.7, real)).toBe('Ecuador') // Galápagos
  })
})
