import { describe, expect, it } from 'vitest'
import { planColors } from '../colorPlan'
import { siteKeyForFeature } from '../collectionSites'
import {
  buildExportResult, describeURLParams, exportRecords, exportSites, exportTitle, legendRows, parseBbox, recordYear,
} from '../exportMetadata'

const feature = (id, lng, lat, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { id, source: 'Sanger Institute', scientific_name: 'Tithorea harmonia', subspecies: 'hermias',
    sex: 'female', country: 'Ecuador', observation_date: '18-Jul-22', collection_location: 'Rio Pusuno', lng, lat, ...extra },
})

describe('link parameters', () => {
  it('accepts only ordered, finite bboxes inside Web Mercator limits', () => {
    expect(parseBbox('-78.1,-1.3,-76.9,-0.4')).toEqual([-78.1, -1.3, -76.9, -0.4])
    for (const bad of ['', '1,2,3', '-76,-1,-78,0', '-78,-1,-77,x', '-78,-89,-77,0', '170,0,190,1', '-78,,-77,0']) {
      expect(parseBbox(bad)).toBe(null)
    }
  })
  it('reports unknown names and unusable values as ignored, never free text', () => {
    const { applied, ignored } = describeURLParams(
      '?sp=Tithorea+harmonia&sex=female&style=light&color_by=subspecies&bbox=-78,-1.3,-77,-0.4&export=1&title=%3Cscript%3E&site_km=5',
      { styleKeys: ['light', 'dark'] })
    expect(applied).toEqual({ sp: 'Tithorea harmonia', sex: 'female', style: 'light', color_by: 'subspecies',
      bbox: [-78, -1.3, -77, -0.4], export: '1' })
    expect(ignored).toEqual(['title', 'site_km'])
    expect(describeURLParams('?style=watercolor&color_by=wingspan&bbox=1,2&sex=unknown&export=yes', { styleKeys: ['light'] }).ignored)
      .toEqual(['style', 'color_by', 'bbox', 'sex', 'export'])
  })
})

describe('title and records', () => {
  it('composes the title from filters only', () => {
    expect(exportTitle({ species: ['Tithorea harmonia'], sex: 'female', country: ['Ecuador'] }))
      .toBe('Tithorea harmonia · females · Ecuador')
    expect(exportTitle({ species: ['A a', 'B b', 'C c'], sex: 'all', country: [] })).toBe('A a, B b +1')
    expect(exportTitle({})).toBe('All records')
  })
  it('reads the year by the same rule as the database map tools (yearOf)', () => {
    const today = new Date('2026-11-02')
    const cases = { '18-Jul-22': 2022, '2019-08-12T13:15': 2019, '1898': 1898, '05-May-98': 1998, '6-Jun-26': 2026,
      '6-Jun-27': 1927, '12/03/15': 2015, '12/03/2015': 2015, 'ca. 1950s': 1950, '': null, 'unknown': null }
    for (const [date, year] of Object.entries(cases)) expect(recordYear({ observation_date: date }, today), date).toBe(year)
    expect(recordYear({})).toBe(null)
  })
  it('reports the recorded coordinate, not a display offset, with map-native fields', () => {
    const shifted = feature('CAM1', -77.6001, -1.0201, { _originalLng: -77.60475, _originalLat: -1.02569444 })
    expect(exportRecords([shifted])).toEqual([{ source: 'Sanger Institute', id: 'CAM1', sex: 'female', country: 'Ecuador',
      year: 2022, date: '18-Jul-22', subspecies: 'hermias', lng: -77.60475, lat: -1.02569444 }])
  })
})

describe('legend rows', () => {
  it('adds an unknown-subspecies row so rows sum to the records', () => {
    const features = [
      ...Array.from({ length: 11 }, (_, i) => feature(`H${i}`, -77, -1)),
      ...Array.from({ length: 4 }, (_, i) => feature(`S${i}`, -77, -1, { subspecies: 'Tithorea harmonia' })),
      feature('U1', -77, -1, { subspecies: 'hermias/furia' }),
    ]
    const plan = planColors(features, { attribute: 'subspecies' })
    const rows = legendRows(plan, 'subspecies')
    expect(rows).toEqual([
      { label: 'hermias', records: 11, unknown: false },
      { label: 'Unknown subspecies', records: 5, unknown: true },
    ])
    expect(rows.reduce((sum, row) => sum + row.records, 0)).toBe(features.length)
  })
})

describe('drawn sites', () => {
  const a1 = feature('A1', -77.6, -1.0, { collection_location: 'Ikiam' })
  const a2 = feature('A2', -77.6, -1.0, { collection_location: 'Ikiam' })
  const b1 = feature('B1', -77.61, -1.01, { collection_location: 'Mariposario Ikiam' })
  const c1 = feature('C1', -76.1, -0.5, { collection_location: 'Loreto - Comunidad Pano', source: 'GBIF (Other Institutions)' })
  const markers = [
    { kind: 'merged', id: 7, lng: -77.605, lat: -1.005, records: [a1, a2, b1] },
    { kind: 'site', id: '-0.5000,-76.1000', lng: -76.1, lat: -0.5, records: [c1] },
  ]

  it('lists every locality inside a merged marker with its record ids and the label drawn for it', () => {
    const labels = [
      { label: 'Ikiam +1 site', clusterId: '7', anchorKey: null },
      { label: 'Loreto - Comunidad\nPano', clusterId: null, anchorKey: JSON.stringify([siteKeyForFeature(c1), -76.1, -0.5]) },
      { label: 'Somewhere off screen', clusterId: null, anchorKey: JSON.stringify(['site:x', 1, 1]) },
    ]
    const { sites, unmatchedLabels } = exportSites(markers, labels, [-78, -1.5, -76.5, 0])
    expect(unmatchedLabels).toBe(1)
    expect(sites[0]).toMatchObject({ marker: 'merged', label: 'Ikiam +1 site', merged_sites: 2, records: 3, center_in_view: true })
    expect(sites[0].members).toEqual([
      { key: siteKeyForFeature(a1), locality: 'Ikiam', record_ids: ['Sanger Institute|A1', 'Sanger Institute|A2'] },
      { key: siteKeyForFeature(b1), locality: 'Mariposario Ikiam', record_ids: ['Sanger Institute|B1'] },
    ])
    expect(sites[1]).toMatchObject({ marker: 'site', label: 'Loreto - Comunidad Pano', merged_sites: 1, center_in_view: false })
    expect(sites[1].members[0].record_ids).toEqual(['GBIF (Other Institutions)|C1'])
  })

  it('does not invent labels: a marker without a drawn label has label null', () => {
    const { sites } = exportSites(markers, [], null)
    expect(sites.map(site => site.label)).toEqual([null, null])
    expect(sites.map(site => site.center_in_view)).toEqual([null, null])
  })

  it('builds the version 1 result with legend rows summing to the records', () => {
    const features = [a1, a2, b1, c1]
    const result = buildExportResult({ pngBase64: 'iVBO', width: 1600, height: 1200, params: { applied: {}, ignored: [] },
      basemap: 'light', colorBy: 'subspecies', title: 'Tithorea harmonia · females · Ecuador',
      view: { bbox: [-78, -1.5, -76.5, 0], center: [-77.25, -0.75], zoom: 8 }, features,
      plan: planColors(features, { attribute: 'subspecies' }), markers, labels: [] })
    expect(Object.keys(result)).toEqual(['version', 'png_base64', 'width', 'height', 'params', 'basemap', 'color_by',
      'title', 'view', 'records', 'legend', 'sites', 'unmatched_labels'])
    expect(result.version).toBe(1)
    expect(result.legend.unit).toBe('records')
    expect(result.legend.rows.reduce((sum, row) => sum + row.records, 0)).toBe(result.records.length)
  })
})
