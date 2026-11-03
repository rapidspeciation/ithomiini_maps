import { describe, expect, it } from 'vitest'
import { planColors } from '../colorPlan'
import { siteKeyForFeature } from '../collectionSites'
import {
  buildExportResult, circleTouchesRect, describeURLParams, exportRecords, exportSites, exportTitle, legendRows,
  occlusionScore, overlayRects, parseBbox, recordYear,
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
  it('reports a repeated name, and map_view next to a usable bbox, as ignored', () => {
    const { applied, ignored } = describeURLParams('?sex=female&sex=male&map_view=-77,-1,8&bbox=-78,-1.3,-77,-0.4', { styleKeys: [] })
    expect(applied).toEqual({ sex: 'female', bbox: [-78, -1.3, -77, -0.4] })
    expect(ignored).toEqual(['sex', 'map_view'])
    // Without a usable bbox, map_view frames the map and is applied.
    expect(describeURLParams('?map_view=-77,-1,8&bbox=1,2', { styleKeys: [] })).toEqual({ applied: { map_view: '-77,-1,8' }, ignored: ['bbox'] })
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
      'title', 'title_truncated', 'view', 'records', 'legend', 'sites', 'unmatched_labels', 'capture_attempts'])
    expect(result.version).toBe(1)
    expect(result.legend.unit).toBe('records')
    expect(result.legend.rows.reduce((sum, row) => sum + row.records, 0)).toBe(result.records.length)
  })
})

describe('picture geometry: overlays over the map', () => {
  // 760 x 570 canvas; title strip 31 px high; legend bottom-left; scale and credits bottom-right.
  const frame = { width: 760, height: 570 }
  const overlays = [
    { kind: 'title', x: 0, y: 0, width: 760, height: 31 },
    { kind: 'legend', x: 10, y: 420, width: 200, height: 120 },
    { kind: 'attribution', x: 500, y: 552, width: 260, height: 18 },
  ]
  // A projection of 10 canvas px per degree (no flip), so the cases read as pixels.
  const project = ([lng, lat]) => ({ x: lng * 10, y: lat * 10 })
  const at = (id, x, y, extra = {}) => feature(id, x / 10, y / 10, { collection_location: `Site ${id}`, ...extra })
  const under = at('T1', 604.7, 12.1) // Anangu in the bbox case: 12 px below the top, under the title
  const legendPoint = at('L1', 18.8, 442.6) // Apuya in the auto case: behind the legend
  const near = at('N1', 300, 40) // centre below the strip, disc of radius 10 reaches it
  const clear = at('C1', 400, 300)
  const labelled = at('B1', 300, 200)
  const marker = (f, radius = 10, kind = 'site', id = f.properties.id) =>
    ({ kind, id, lng: f.properties.lng, lat: f.properties.lat, ...project([f.properties.lng, f.properties.lat]), radius, records: [f] })
  const anchor = f => JSON.stringify([siteKeyForFeature(f), f.properties.lng, f.properties.lat])

  it('measures overlays relative to the canvas and drops empty or off-frame boxes', () => {
    const canvas = { left: 100, top: 50, width: 760, height: 570 }
    const rects = overlayRects([
      { kind: 'title', rect: { left: 100, top: 50, width: 760, height: 31.4 } },
      { kind: 'legend', rect: { left: 110, top: 470, width: 200, height: 120 } },
      { kind: 'scale', rect: { left: 0, top: 0, width: 0, height: 10 } },
      { kind: 'attribution', rect: { left: 900, top: 50, width: 40, height: 10 } },
    ], canvas)
    expect(rects).toEqual([
      { kind: 'title', x: 0, y: 0, width: 760, height: 31.4 },
      { kind: 'legend', x: 10, y: 420, width: 200, height: 120 },
    ])
  })

  it('counts a marker disc that only reaches an overlay as touching it', () => {
    const title = overlays[0]
    expect(circleTouchesRect({ x: 300, y: 40, radius: 10 }, title)).toBe(true)
    expect(circleTouchesRect({ x: 300, y: 41.5, radius: 10 }, title)).toBe(false)
    expect(circleTouchesRect({ x: 604.7, y: 12.1, radius: 4 }, title)).toBe(true)
  })

  it('flags sites under the title or legend as occluded and lists only labels clear of every overlay', () => {
    const markers = [marker(under), marker(legendPoint), marker(near), marker(clear), marker(labelled)]
    const labels = [
      // Placed just below the strip but its box reaches into it.
      { label: 'Site T1', anchorKey: anchor(under), box: { x: 560, y: 25, width: 90, height: 24 } },
      { label: 'Site L1', anchorKey: anchor(legendPoint), box: { x: 30, y: 430, width: 90, height: 24 } },
      { label: 'Site B1', anchorKey: anchor(labelled), box: { x: 250, y: 160, width: 90, height: 24 } },
      // A label for a clear marker, but its box runs off the frame.
      { label: 'Site C1', anchorKey: anchor(clear), box: { x: 700, y: 290, width: 90, height: 24 } },
    ]
    const { sites } = exportSites(markers, labels, null, { frame, overlays })
    const byId = Object.fromEntries(sites.map(site => [site.members[0].record_ids[0].split('|')[1], site]))
    expect(byId.T1).toMatchObject({ occluded: true, occluded_by: ['title'], label: null, labels: [], hidden_labels: 1 })
    expect(byId.L1).toMatchObject({ occluded: true, occluded_by: ['legend'], label: null, hidden_labels: 1 })
    expect(byId.N1).toMatchObject({ occluded: true, occluded_by: ['title'] })
    expect(byId.C1).toMatchObject({ occluded: false, label: null, hidden_labels: 1 })
    expect(byId.B1).toMatchObject({ occluded: false, occluded_by: [], label: 'Site B1', hidden_labels: 0,
      x: 300, y: 200, radius: 10, label_boxes: [{ x: 250, y: 160, width: 90, height: 24 }] })
    expect(occlusionScore(sites)).toEqual({ records: 3, sites: 3 })
  })

  it('marks records in_picture only when their recorded point is in the frame, clear of overlays, in a visible marker', () => {
    const outside = at('O1', 900, 300)
    const features = [under, legendPoint, near, clear, outside]
    const result = buildExportResult({ pngBase64: null, width: null, height: null, params: { applied: {}, ignored: [] },
      basemap: 'light', colorBy: 'subspecies', title: 'Tithorea harmonia · females · Ecuador',
      view: { bbox: [0, 0, 1, 1], center: [0, 0], zoom: 8, frame }, features,
      plan: planColors(features, { attribute: 'subspecies' }),
      markers: [marker(under), marker(legendPoint), marker(near), marker(clear)], labels: [], overlays, project,
      legendPlacement: { corner: 'bottom-left', placements_tried: 1, occluded_sites: 3, occluded_records: 3 } })
    const byId = Object.fromEntries(result.records.map(r => [r.id, r]))
    expect(byId.T1).toMatchObject({ x: 604.7, y: 12.1, in_picture: false })
    expect(byId.L1.in_picture).toBe(false)
    // Its own point is below the strip, but its marker reaches under it: not counted visible.
    expect(byId.N1.in_picture).toBe(false)
    expect(byId.C1).toMatchObject({ x: 400, y: 300, in_picture: true })
    expect(byId.O1.in_picture).toBe(false)
    // x/y is the recorded point, the same as lng/lat, never a display offset.
    for (const r of result.records) {
      const p = project([r.lng, r.lat])
      expect([r.x, r.y]).toEqual([Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])
    }
    expect(result.view.overlays).toEqual(overlays)
    expect(result.view.legend_placement.corner).toBe('bottom-left')
  })

  it('keeps the version 1 fields unchanged when no geometry is given', () => {
    const [row] = exportRecords([clear])
    expect('in_picture' in row).toBe(false)
    const { sites } = exportSites([marker(clear)], [], null)
    expect('occluded' in sites[0]).toBe(false)
  })
})
