// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computed, reactive } from 'vue'
import { useHostPlantGalleryData } from '../../composables/useHostPlantGalleryData'
import {
  dedupeHostPlantGalleryImages,
  getHostPlantImage,
  normalizeHostPlantGalleryItem,
  selectHostPlantGalleryFeatures,
} from '../hostPlantGallery'

describe('hostPlantGallery', () => {
  it('prefers direct GBIF media over fallback media', () => {
    const image = getHostPlantImage({
      media: JSON.stringify([{ url: 'https://example.org/direct.jpg' }]),
      fallback_media: JSON.stringify({ url: 'https://example.org/fallback.jpg' }),
    })

    expect(image).toMatchObject({
      url: 'https://example.org/direct.jpg',
      fallback: false,
    })
  })

  it('normalizes a host plant occurrence into a gallery item', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-77.1, -1.2] },
      properties: {
        gbifID: '12345',
        host_taxon_slug: 'solanum-crinitum',
        host_taxon_name: 'Solanum crinitum',
        eventDate: '2020-01-02',
        country: 'Ecuador',
        datasetName: 'GBIF',
        fallback_media: JSON.stringify({ url: 'https://example.org/plant.jpg' }),
      },
    }
    const item = normalizeHostPlantGalleryItem(
      feature,
      { canonical_name: 'Solanum crinitum', rank: 'species', family: 'Solanaceae' },
      [
        { host_taxon_slug: 'solanum-crinitum', butterfly_taxon: 'Mechanitis polymnia' },
        { host_taxon_slug: 'other', butterfly_taxon: 'Mechanitis lysimnia' },
      ],
    )

    expect(item).toMatchObject({
      id: '12345',
      image_url: 'https://example.org/plant.jpg',
      image_is_fallback: true,
      scientific_name: 'Solanum crinitum',
      host_taxon_rank: 'species',
      host_family: 'Solanaceae',
      associated_butterflies: ['Mechanitis polymnia'],
      lat: -1.2,
      lng: -77.1,
      observation_url: 'https://www.gbif.org/occurrence/12345',
    })
  })

  it('keeps all host plant occurrence rows when no taxa are selected', () => {
    const features = [
      {
        properties: {
          gbifID: '1',
          host_taxon_slug: 'a',
          fallback_media: JSON.stringify({ url: 'https://example.org/a.jpg' }),
        },
      },
      {
        properties: {
          gbifID: '2',
          host_taxon_slug: 'a',
          fallback_media: JSON.stringify({ url: 'https://example.org/a2.jpg' }),
        },
      },
      {
        properties: {
          gbifID: '3',
          host_taxon_slug: 'b',
          fallback_media: JSON.stringify({ url: 'https://example.org/b.jpg' }),
        },
      },
      {
        properties: {
          gbifID: '4',
          host_taxon_slug: 'c',
        },
      },
    ]

    expect(selectHostPlantGalleryFeatures(features).map(feature => feature.properties.gbifID))
      .toEqual(['1', '2', '3', '4'])
  })

  it('keeps all occurrence rows for explicitly selected host taxa', () => {
    const features = [
      { properties: { gbifID: '1', host_taxon_slug: 'a' } },
      { properties: { gbifID: '2', host_taxon_slug: 'a' } },
      { properties: { gbifID: '3', host_taxon_slug: 'b' } },
    ]

    expect(selectHostPlantGalleryFeatures(features, ['a']).map(feature => feature.properties.gbifID))
      .toEqual(['1', '2'])
  })

  it('deduplicates gallery images per host taxon and occurrence group', () => {
    const items = [
      { id: '1', gbifID: '1', host_taxon_slug: 'a', subspecies: 'A species', image_url: 'https://example.org/a.jpg' },
      { id: '2', gbifID: '2', host_taxon_slug: 'a', subspecies: 'A species', image_url: 'https://example.org/a.jpg' },
      { id: '3', gbifID: '3', host_taxon_slug: 'a', subspecies: 'A species', image_url: 'https://example.org/a2.jpg' },
      { id: '4', gbifID: '4', host_taxon_slug: 'b', subspecies: 'B species', image_url: 'https://example.org/a.jpg' },
      { id: '5', gbifID: '5', host_taxon_slug: 'b', subspecies: 'B species' },
    ]

    const deduped = dedupeHostPlantGalleryImages(items)

    expect(deduped.map(item => item.id)).toEqual(['1', '3', '4'])
    expect(deduped[0]).toMatchObject({
      duplicate_image_record_count: 2,
      duplicate_image_gbif_ids: ['1', '2'],
    })
  })

  it('uses the shared compact occurrence core without raw occurrence features', () => {
    const store = reactive({
      selectedTaxonSlugs: ['a'],
      galleryDataset: {
        stats_by_slug: {
          a: { total_records: 3, records_with_images: 2, records_without_images: 1 },
          b: { total_records: 1, records_with_images: 1, records_without_images: 0 },
        },
        records: [
          { id: '1', scientific_name: 'A species', subspecies: 'A species', host_taxon_slug: 'a', image_url: 'https://example.org/a.jpg' },
          { id: '3', scientific_name: 'A species', subspecies: 'A species', host_taxon_slug: 'a' },
          { id: '2', scientific_name: 'B species', subspecies: 'B species', host_taxon_slug: 'b', image_url: 'https://example.org/b.jpg' },
        ],
      },
      associations: [
        { host_taxon_slug: 'a', butterfly_taxon: 'Mechanitis polymnia' },
      ],
      taxaBySlug: computed(() => new Map()),
    })

    const gallery = useHostPlantGalleryData(store)

    expect(gallery.specimensWithImages.value).toHaveLength(1)
    expect(gallery.specimensWithImages.value[0].associated_butterflies).toEqual(['Mechanitis polymnia'])
    expect(gallery.allFilteredTotal.value).toBe(3)
    expect(gallery.allFilteredWithoutImages.value).toBe(1)
  })
})
