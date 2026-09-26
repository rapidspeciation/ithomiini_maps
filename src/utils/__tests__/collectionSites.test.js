import { describe, expect, it } from 'vitest'
import { collectionDate, groupCollectionSites, recordedPointsForFeatures, siteKeyForFeature } from '../collectionSites'

const record = (id, lat, lng, collection_location = 'Mindo', extra = {}) => ({
  id, lat, lng, collection_location, country: 'Ecuador',
  scientific_name: 'Ithomia leilae', observation_date: '2023-06-14', ...extra,
})

describe('collection site grouping', () => {
  it('keeps a site ID when records are filtered and separates distant homonyms', () => {
    const near = [record('a', -0.050, -78.770), record('b', -0.051, -78.771)]
    const far = record('c', -1.5, -78.77)
    const complete = groupCollectionSites([...near, far])
    const subset = groupCollectionSites([near[0], far])
    expect(complete).toHaveLength(2)
    expect(complete.find(site => site.recordCount === 2).id).toBe(siteKeyForFeature(near[0]))
    expect(subset.map(site => site.id)).toContain(siteKeyForFeature(near[0]))
    expect(siteKeyForFeature(near[0])).not.toBe(siteKeyForFeature(far))
  })

  it('groups unnamed records by area and labels them as unnamed', () => {
    const sites = groupCollectionSites([
      record('a', 1, -77, null),
      record('b', 1, -77, 'Unknown'),
    ])
    expect(sites).toHaveLength(1)
    expect(sites[0].named).toBe(false)
    expect(sites[0].name).toMatch(/^Unnamed area near /)
    expect(sites[0].recordCount).toBe(2)
  })

  it('counts records and taxa, and only uses valid day-level dates', () => {
    const features = [
      record('a', -0.05, -78.77, 'Mindo', { observation_date: '31-Feb-24' }),
      record('b', -0.05, -78.77, 'Mindo', { observation_date: '2022-05', scientific_name: 'Mechanitis menophilus' }),
      record('c', -0.05, -78.77, 'Mindo', { observation_date: '2024-02-29' }),
      record('d', -0.05, -78.77, 'Mindo', { observation_date: '18-Jan-22', scientific_name: 'Mechanitis menophilus' }),
    ]
    const site = groupCollectionSites({ type: 'FeatureCollection', features: features.map(properties => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [properties.lng, properties.lat] }, properties })) })[0]
    expect(site.recordCount).toBe(4)
    expect(site.taxonCounts).toEqual([
      { taxon: 'Ithomia leilae', count: 2 },
      { taxon: 'Mechanitis menophilus', count: 2 },
    ])
    expect(site.datedRecordCount).toBe(2)
    expect(site.earliestDate).toBe('2022-01-18')
    expect(site.latestDate).toBe('2024-02-29')
    expect(collectionDate({ observation_date: '2023-02-29' })).toBeNull()
    expect(collectionDate({ observation_date: '2024-02-29T25:99' })).toBeNull()
    expect(collectionDate({ preservation_date: '2024-02-29' })).toBeNull()
    expect(collectionDate({ observation_date: '2040-01-01' })).toBeNull()
    expect(collectionDate({ observation_date: '18-Jan-99' })).toBeNull()
  })

  it('filters by minimum record count without changing identity', () => {
    const input = [record('a', -0.05, -78.77), record('b', -0.05, -78.77)]
    expect(groupCollectionSites(input, { minRecords: 3 })).toEqual([])
    expect(groupCollectionSites(input, { minRecords: 2 })[0].id).toBe(siteKeyForFeature(input[0]))
  })

  it('does not turn absent coordinates into a site at zero latitude or longitude', () => {
    expect(groupCollectionSites([
      record('missing-lat', null, -78),
      record('missing-lng', -1, ''),
      record('valid', 0, 0),
    ])).toHaveLength(1)
  })

  it('uses original collection coordinates when the map scatters a feature', () => {
    const original = record('a', -0.05, -78.77)
    const displayed = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-78.70, -0.10] },
      properties: { ...original, lng: -78.70, lat: -0.10, _originalLng: -78.77, _originalLat: -0.05 },
    }
    expect(siteKeyForFeature(displayed)).toBe(siteKeyForFeature(original))
    expect(groupCollectionSites([displayed])[0].coordinates).toEqual([-78.77, -0.05])
    expect(groupCollectionSites([displayed])[0].recordedPoints).toEqual([[-78.77, -0.05]])
  })

  it('keeps distinct recorded points in a site instead of a calculated center', () => {
    const records = [record('a', -0.050, -78.770), record('b', -0.050, -78.770), record('c', -0.051, -78.771)]
    expect(groupCollectionSites(records)[0].recordedPoints).toEqual([[-78.770, -0.050], [-78.771, -0.051]])
    expect(recordedPointsForFeatures(records)).toEqual([[-78.770, -0.050], [-78.771, -0.051]])
  })
})
