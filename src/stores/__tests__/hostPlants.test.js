import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHostPlantStore } from '../hostPlants'

const manifest = {
  metadata: {
    scientific_caveat: 'Plant records are context only.',
    gbif_download_doi: null,
    gbif_download_doi_note: 'No DOI minted.',
    occurrence_dataset: 'host_plant_occurrences.json',
    gallery_dataset: 'host_plant_gallery.json',
    occurrence_core_dataset: 'host_plant_occurrence_core.json',
    occurrence_core_shards: {
      Apocynaceae: 'host_plant_occurrence_core_apocynaceae.json',
      Solanaceae: 'host_plant_occurrence_core_solanaceae.json',
    },
  },
  taxa: [
    {
      canonical_name: 'Prestonia coalita',
      slug: 'species_prestonia_coalita',
      rank: 'species',
      family: 'Apocynaceae',
      occurrence_count: 2,
    },
    {
      canonical_name: 'Solanum',
      slug: 'genus_solanum',
      rank: 'genus',
      family: 'Solanaceae',
      occurrence_count: 4,
    },
    {
      canonical_name: 'Solanaceae',
      slug: 'family_solanaceae',
      rank: 'family',
      family: 'Solanaceae',
      occurrence_count: 0,
    },
  ],
}

const associations = {
  associations: [
    {
      butterfly_taxon: 'Aeria elara',
      host_taxon_slug: 'species_prestonia_coalita',
      host_taxon_name: 'Prestonia coalita',
      confidence: 'high',
      host_id_level: 'species',
      evidence_level: 'direct',
      evidence_detail: 'Larvae observed.',
      caveats: 'Check primary source.',
    },
    {
      butterfly_taxon: 'Callithomia alexirrhoe',
      host_taxon_slug: 'genus_solanum',
      host_taxon_name: 'Solanum',
      confidence: 'needs_check',
      host_id_level: 'genus',
      evidence_level: 'needs_check',
      evidence_detail: 'Audit unresolved.',
    },
    {
      butterfly_taxon: 'Callithomia alexirrhoe',
      host_taxon_slug: 'family_solanaceae',
      host_taxon_name: 'Solanaceae',
      confidence: 'medium',
      host_id_level: 'family',
      evidence_level: 'literature',
      evidence_detail: 'Catalogue family row.',
    },
  ],
}

describe('useHostPlantStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('loads manifest and association metadata without loading occurrences', async () => {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.taxa).toHaveLength(3)
    expect(store.associations).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain(
      '/data/host_plants/occurrences/species_prestonia_coalita.geojson'
    )
  })

  it('returns host taxa associated with selected butterflies', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    const taxa = store.getTaxaForButterflies(['Aeria elara'])

    expect(taxa).toHaveLength(1)
    expect(taxa[0].canonical_name).toBe('Prestonia coalita')
    expect(taxa[0].associations[0].confidence).toBe('high')
  })

  it('does not return fallback host taxa when no butterfly is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getTaxaForButterflies([])).toEqual([])
  })

  it('builds selectable occurrence-backed host taxon options for the filter UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getOccurrenceTaxonOptionsForButterflies(['Aeria elara'])).toMatchObject([
      {
        label: 'Prestonia coalita',
        value: 'species_prestonia_coalita',
        meta: 'species · Apocynaceae · Observed · 2 records',
      },
    ])
    expect(store.getOccurrenceTaxonOptionsForButterflies([], { hostIdLevels: ['species', 'genus'], evidenceLevels: ['direct', 'literature', 'needs_check'] })).toMatchObject([
      {
        label: 'Prestonia coalita',
        value: 'species_prestonia_coalita',
        meta: 'species · Apocynaceae · 2 records',
      },
      {
        label: 'Solanum',
        value: 'genus_solanum',
        meta: 'genus · Solanaceae · 4 records',
      },
    ])
  })

  it('builds butterfly search options with host id and evidence counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getButterflyOptionsForHostPlants()).toEqual([
      expect.objectContaining({
        label: 'Aeria elara',
        meta: '1 species · 0 genus · 0 family · 1 observed · 0 reported · 0 needs check',
      }),
      expect.objectContaining({
        label: 'Callithomia alexirrhoe',
        meta: '0 species · 1 genus · 1 family · 0 observed · 1 reported · 1 needs check',
      }),
    ])
  })

  it('applies evidence selections to butterfly-expanded host taxa', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getTaxaForButterflies(['Callithomia alexirrhoe'], 'medium')).toEqual([])
    expect(store.getTaxaForButterflies(['Callithomia alexirrhoe'], { hostIdLevels: ['genus'], evidenceLevels: ['needs_check'] })).toHaveLength(1)
  })

  it('can expand butterfly host taxa to species-level records regardless of confidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getSpeciesLevelTaxaForButterflies(['Aeria elara'])).toMatchObject([
      {
        canonical_name: 'Prestonia coalita',
        rank: 'species',
      },
    ])
    expect(store.getSpeciesLevelTaxaForButterflies(['Callithomia alexirrhoe'])).toEqual([])
  })


  it('defaults to species-level direct and literature associations only', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getTaxaForButterflies(['Aeria elara']).map(t => t.slug)).toEqual(['species_prestonia_coalita'])
    expect(store.getTaxaForButterflies(['Callithomia alexirrhoe'])).toEqual([])
  })

  it('enables the host plant overlay while host taxa are selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.enabled).toBe(false)

    store.setSelectedTaxa(['species_prestonia_coalita'])
    expect(store.enabled).toBe(true)

    store.setSelectedTaxa([])
    expect(store.enabled).toBe(false)

    store.toggleTaxon('genus_solanum')
    expect(store.enabled).toBe(true)

    store.toggleTaxon('genus_solanum')
    expect(store.enabled).toBe(false)
  })

  it('supports genus and needs-check opt-in without showing family map targets by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    expect(store.getTaxaForButterflies(['Callithomia alexirrhoe'], {
      hostIdLevels: ['species', 'genus'],
      evidenceLevels: ['direct', 'literature', 'needs_check'],
    }).map(t => t.slug)).toEqual(['genus_solanum'])

    expect(store.getTaxaForButterflies(['Callithomia alexirrhoe'], {
      hostIdLevels: ['family'],
      evidenceLevels: ['literature'],
      includeNonOccurrenceBacked: true,
    }).map(t => t.slug)).toEqual(['family_solanaceae'])
  })

  it('matches host taxon options by associated butterfly species search text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    const options = store.getOccurrenceTaxonOptionsForButterflies([], { hostIdLevels: ['species', 'genus'], evidenceLevels: ['direct', 'literature', 'needs_check'] })
    const matches = store.filterOccurrenceTaxonOptions(options, 'callithomia alexirrhoe')

    expect(matches).toEqual([
      expect.objectContaining({
        label: 'Solanum',
        value: 'genus_solanum',
        matchMeta: 'Butterfly: Callithomia alexirrhoe',
      }),
    ])
    expect(matches.some(option => option.value === 'family_solanaceae')).toBe(false)
  })

  it('lazy-loads only occurrence shards needed for selected host taxa', async () => {
    const apocynaceaeShard = {
      metadata: { family: 'Apocynaceae', total_records: 2 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 2, records_with_images: 1, records_without_images: 1 },
      },
      records: [
        { id: '1', gbifID: '1', host_taxon_slug: 'species_prestonia_coalita', scientificName: 'Prestonia coalita', lat: -1, lng: -78, image_url: 'https://example.org/plant.jpg' },
        { id: '2', gbifID: '2', host_taxon_slug: 'species_prestonia_coalita', scientificName: 'Prestonia coalita', lat: -2, lng: -77 },
      ],
    }
    const solanaceaeShard = {
      metadata: { family: 'Solanaceae', total_records: 1 },
      stats_by_slug: {
        genus_solanum: { total_records: 1, records_with_images: 0, records_without_images: 1 },
      },
      records: [
        { id: '3', gbifID: '3', host_taxon_slug: 'genus_solanum', scientificName: 'Solanum L.', lat: -3, lng: -76 },
      ],
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        const path = String(url)
        if (path.includes('manifest')) return manifest
        if (path.includes('associations')) return associations
        if (path.includes('host_plant_occurrence_core_apocynaceae')) return apocynaceaeShard
        if (path.includes('host_plant_occurrence_core_solanaceae')) return solanaceaeShard
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()
    await store.loadOccurrences(['species_prestonia_coalita'])
    await store.loadOccurrences(['species_prestonia_coalita'])

    const speciesCollection = store.getOccurrenceCollectionForTaxa(['species_prestonia_coalita'])
    expect(speciesCollection.features).toHaveLength(2)
    expect(speciesCollection.features[0]).toMatchObject({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-78, -1] },
      properties: { image_url: 'https://example.org/plant.jpg', media: [{ url: 'https://example.org/plant.jpg' }] },
    })
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('host_plant_occurrence_core_apocynaceae'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('host_plant_occurrence_core_solanaceae'))).toBe(false)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('host_plant_occurrences'))).toBe(false)

    await store.loadOccurrences(['genus_solanum'])
    expect(store.getOccurrenceCollectionForTaxa(['genus_solanum']).features).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('host_plant_occurrence_core_solanaceae'))).toHaveLength(1)
  })

  it('loads the compact gallery index without loading map occurrences', async () => {
    const gallery = {
      metadata: { item_count: 1, total_records: 2, records_without_images: 1 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 2, records_with_images: 1, records_without_images: 1 },
      },
      items: [
        {
          id: '123',
          gbifID: '123',
          image_url: 'https://example.org/plant.jpg',
          scientific_name: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
        },
      ],
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        if (String(url).includes('manifest')) return manifest
        if (String(url).includes('associations')) return associations
        if (String(url).includes('host_plant_gallery')) return gallery
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()
    await store.loadGallery()
    await store.loadGallery()

    expect(store.galleryDataset.items).toHaveLength(1)
    expect(store.occurrenceDataset).toBeNull()
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('host_plant_gallery'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('host_plant_occurrence_core'))).toBe(false)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('host_plant_occurrences'))).toBe(false)
  })

  it('uses the host plant gallery preview before loading a selected taxon page', async () => {
    const preview = {
      metadata: { preview: true, item_count: 1 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 4, records_with_images: 4, records_without_images: 0 },
      },
      items: [
        {
          id: 'preview-1',
          image_url: 'https://example.org/preview.jpg',
          scientific_name: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
          photo_context: 'field',
        },
      ],
    }
    const galleryIndex = {
      metadata: { host_taxon_slug: 'species_prestonia_coalita' },
      stats_by_slug: preview.stats_by_slug,
      total_images: 4,
      page_size: 100,
      pages: ['gallery_taxa/species_prestonia_coalita/page_001.json'],
    }
    const galleryPage = {
      items: [
        ...preview.items,
        {
          id: 'page-2',
          image_url: 'https://example.org/page-2.jpg',
          scientific_name: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
          photo_context: 'preserved',
        },
      ],
    }
    const manifestWithPreview = {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        gallery_preview_dataset: 'host_plant_gallery_preview.json',
        gallery_indexes_by_taxon: {
          species_prestonia_coalita: 'gallery_taxa/species_prestonia_coalita/index.json',
        },
        gallery_initial_limit: 1,
        gallery_page_size: 100,
      },
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        const path = String(url)
        if (path.includes('manifest')) return manifestWithPreview
        if (path.includes('associations')) return associations
        if (path.includes('host_plant_gallery_preview')) return preview
        if (path.includes('gallery_taxa/species_prestonia_coalita/index')) return galleryIndex
        if (path.includes('gallery_taxa/species_prestonia_coalita/page_001')) return galleryPage
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()
    await store.loadGallery()

    expect(store.galleryDataset.metadata.preview).toBe(true)
    expect(store.galleryDataset.items).toHaveLength(1)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('gallery_taxa/species_prestonia_coalita/page_001'))).toBe(false)

    await store.loadMoreGalleryForSlug('species_prestonia_coalita', 1)

    expect(store.galleryDataset.items.filter(item => item.host_taxon_slug === 'species_prestonia_coalita')).toHaveLength(2)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('gallery_taxa/species_prestonia_coalita/page_001'))).toBe(true)
  })

  it('loads compact gallery and occurrence core without fetching the full occurrence GeoJSON', async () => {
    const gallery = {
      metadata: { item_count: 1, total_records: 2, records_without_images: 1 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 2, records_with_images: 1, records_without_images: 1 },
      },
      items: [
        {
          id: '123',
          gbifID: '123',
          image_url: 'https://example.org/plant.jpg',
          scientific_name: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
        },
      ],
    }
    const occurrenceCore = {
      metadata: { item_count: 1, total_records: 2, records_without_images: 1 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 2, records_with_images: 1, records_without_images: 1 },
      },
      records: [
        {
          id: '123',
          gbifID: '123',
          image_url: 'https://example.org/plant.jpg',
          scientific_name: 'Prestonia coalita',
          scientificName: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
          lat: -1,
          lng: -78,
        },
        {
          id: '124',
          gbifID: '124',
          scientific_name: 'Prestonia coalita',
          scientificName: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
          lat: -2,
          lng: -77,
        },
      ],
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        if (String(url).includes('manifest')) return manifest
        if (String(url).includes('associations')) return associations
        if (String(url).includes('host_plant_gallery')) return gallery
        if (String(url).includes('host_plant_occurrence_core_apocynaceae')) return { records: occurrenceCore.records.filter(record => record.host_taxon_slug === 'species_prestonia_coalita') }
        if (String(url).includes('host_plant_occurrence_core_solanaceae')) return { records: occurrenceCore.records.filter(record => record.host_taxon_slug === 'genus_solanum') }
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()
    await store.loadGallery()
    await store.loadGallery()
    await store.loadOccurrences(['species_prestonia_coalita'])

    expect(store.galleryDataset.items).toHaveLength(1)
    expect(store.occurrenceDataset.records).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('host_plant_occurrence_core'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('host_plant_gallery'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('host_plant_occurrences'))).toBe(false)
  })

  it('prefers an exact host plant occurrence photo over same-taxon gallery fallbacks', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('manifest') ? manifest : associations,
    })))
    const store = useHostPlantStore()
    await store.loadMetadata()

    const photo = store.getPhotoForOccurrence({
      id: 'exact',
      gbifID: 'exact',
      host_taxon_slug: 'species_prestonia_coalita',
      image_url: 'https://example.org/exact.jpg',
    })

    expect(photo).toEqual({
      url: 'https://example.org/exact.jpg',
      sameOccurrence: true,
      fromId: 'exact',
    })
  })

  it('uses the loaded host plant gallery as a representative popup photo fallback', async () => {
    const galleryIndex = {
      metadata: { host_taxon_slug: 'species_prestonia_coalita' },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 2, records_with_images: 1, records_without_images: 1 },
      },
      total_images: 1,
      page_size: 100,
      pages: ['gallery_taxa/species_prestonia_coalita/page_001.json'],
    }
    const galleryPage = {
      items: [
        {
          id: 'gallery-1',
          gbifID: 'gallery-1',
          image_url: 'https://example.org/gallery.jpg',
          scientific_name: 'Prestonia coalita',
          host_taxon_slug: 'species_prestonia_coalita',
        },
      ],
    }
    const manifestWithPagedGallery = {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        gallery_indexes_by_taxon: {
          species_prestonia_coalita: 'gallery_taxa/species_prestonia_coalita/index.json',
        },
        gallery_initial_limit: 10,
        gallery_page_size: 100,
      },
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        const path = String(url)
        if (path.includes('manifest')) return manifestWithPagedGallery
        if (path.includes('associations')) return associations
        if (path.includes('gallery_taxa/species_prestonia_coalita/index')) return galleryIndex
        if (path.includes('gallery_taxa/species_prestonia_coalita/page_001')) return galleryPage
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadMetadata()
    expect(store.getPhotoForOccurrence({
      id: 'no-image',
      gbifID: 'no-image',
      host_taxon_slug: 'species_prestonia_coalita',
    })).toBeNull()

    await store.loadGallery(['species_prestonia_coalita'])

    expect(store.getPhotoForOccurrence({
      id: 'no-image',
      gbifID: 'no-image',
      host_taxon_slug: 'species_prestonia_coalita',
    })).toEqual({
      url: 'https://example.org/gallery.jpg',
      sameOccurrence: false,
      fromId: 'gallery-1',
    })
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('gallery_taxa/species_prestonia_coalita/page_001'))).toHaveLength(1)
    await store.loadGallery(['species_prestonia_coalita'])
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('gallery_taxa/species_prestonia_coalita/page_001'))).toHaveLength(1)
  })

  it('loads v2 occurrence chunks after fetching selected taxon refs', async () => {
    const manifestWithV2Refs = {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        occurrence_store_version: 2,
        occurrence_refs_by_taxon: {
          species_prestonia_coalita: 'taxon_occurrence_refs/species_prestonia_coalita.json',
        },
        gallery_indexes_by_taxon: {},
      },
    }
    const ref = {
      metadata: { host_taxon_slug: 'species_prestonia_coalita', total_records: 1 },
      stats_by_slug: {
        species_prestonia_coalita: { total_records: 1 },
      },
      chunks: {
        'occurrence_chunks/chunk_001.json': [0],
      },
    }
    const chunk = {
      records: [
        {
          id: 'plant-1',
          gbifID: 'plant-1',
          lat: -1,
          lng: -78,
          scientific_name: 'Prestonia coalita',
        },
      ],
    }
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        const path = String(url)
        if (path.includes('manifest')) return manifestWithV2Refs
        if (path.includes('associations')) return associations
        if (path.includes('taxon_occurrence_refs/species_prestonia_coalita')) return ref
        if (path.includes('occurrence_chunks/chunk_001')) return chunk
        throw new Error(`unexpected fetch ${url}`)
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useHostPlantStore()
    await store.loadOccurrences(['species_prestonia_coalita'])

    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('taxon_occurrence_refs/species_prestonia_coalita'))).toBe(true)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('occurrence_chunks/chunk_001'))).toBe(true)
    expect(store.getOccurrenceCollectionForTaxa(['species_prestonia_coalita']).features).toHaveLength(1)
  })

  it('keeps genus-only rows out of species chip collections', async () => {
    const occurrenceCore = {
      records: [
        {
          id: '1',
          host_taxon_slug: 'species_prestonia_coalita',
          taxonRank: 'SPECIES',
          lat: -1,
          lng: -78,
        },
        {
          id: '2',
          host_taxon_slug: 'genus_solanum',
          taxonRank: 'GENUS',
          lat: -2,
          lng: -77,
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        if (String(url).includes('manifest')) return manifest
        if (String(url).includes('associations')) return associations
        if (String(url).includes('host_plant_occurrence_core_apocynaceae')) return { records: occurrenceCore.records.filter(record => record.host_taxon_slug === 'species_prestonia_coalita') }
        if (String(url).includes('host_plant_occurrence_core_solanaceae')) return { records: occurrenceCore.records.filter(record => record.host_taxon_slug === 'genus_solanum') }
        throw new Error(`unexpected fetch ${url}`)
      },
    })))

    const store = useHostPlantStore()
    await store.loadMetadata()
    await store.loadOccurrences(['species_prestonia_coalita', 'genus_solanum'])

    expect(store.getOccurrenceCollectionForTaxa(['species_prestonia_coalita']).features).toHaveLength(1)
    expect(store.getOccurrenceCollectionForTaxa(['genus_solanum']).features).toHaveLength(1)
    expect(store.getOccurrenceCollectionForTaxa(['family_solanaceae']).features).toHaveLength(0)
  })
})
