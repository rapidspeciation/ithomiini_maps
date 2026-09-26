import { describe, expect, it } from 'vitest'
import { resolvePointFeatures, resolveRangeFeatures, resolveSiteFeatures, screenGeometry, snapshotLegend } from '../rExport/snapshot'

const feature = (properties, coordinates = [-70, -5]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates }, properties
})
const project = ([lng, lat]) => ({ x: (lng + 80) * 10, y: (lat + 10) * 10 })

describe('R export snapshot', () => {
  const records = [
    feature({ scientific_name: 'A', subspecies: 'A a', sequencing_status: 'Sequenced', mimicry_ring: 'Tiger' }),
    feature({ scientific_name: 'B', subspecies: 'B b', sequencing_status: 'Unknown', mimicry_ring: 'Unknown' }, [-69, -4])
  ]

  it('uses the displayed attribute and legend palette, preserving projected point locations', () => {
    for (const [attribute, palette] of [
      ['scientific_name', { A: '#123456', B: '#6b7280' }],
      ['sequencing_status', { Sequenced: '#123456' }],
      ['mimicry_ring', { Tiger: '#123456' }]
    ]) {
      const out = resolvePointFeatures(records, { attribute, palette, hiddenItems: [], project })
      expect(out).toHaveLength(2)
      expect(out[0].properties.display_color).toBe('#123456')
      expect(out[1].properties.display_color).toBe('#6b7280')
      expect(out[0].properties.screen_x).toBe(100)
      expect(out[0].properties.screen_y).toBe(50)
    }
  })

  it('filters hidden categories before exporting the rendered point source', () => {
    const out = resolvePointFeatures(records, {
      attribute: 'scientific_name', palette: { A: '#123456', B: '#654321' },
      hiddenItems: ['B'], project
    })
    expect(out.map(f => f.properties.scientific_name)).toEqual(['A'])
  })

  it('exports one marker per site with pie slices, size and large sites first', () => {
    const site = (key, coordinates, individuals, segments, fill) => ({
      key, coordinates, individuals, recordCount: individuals, speciesCount: segments.length || 1,
      sizeFactor: 1 + individuals / 100, fill, locality: key, country: 'Ecuador', segments,
      records: [feature({ scientific_name: `Sp ${key}` }, coordinates)],
    })
    const out = resolveSiteFeatures([
      site('small', [-70, -5], 1, [{ key: 'value:a', label: 'a', color: '#111111', count: 1, fraction: 1 }], '#111111'),
      site('big', [-69, -4], 50, [
        { key: 'value:a', label: 'a', color: '#111111', count: 30, fraction: 0.6 },
        { key: 'other', label: 'Other', color: '#6b7280', count: 20, fraction: 0.4 },
      ], null),
    ], { project, shapeFor: () => 'triangle', strokeFor: () => '#ffffff' })
    expect(out.map(f => f.properties.collection_location)).toEqual(['big', 'small'])
    expect(out[0].properties).toMatchObject({
      individuals: 50, display_color: null, display_shape: 'circle', display_size_factor: 1.5,
      display_segments: [{ label: 'a', color: '#111111', fraction: 0.6 }, { label: 'Other', color: '#6b7280', fraction: 0.4 }],
      screen_x: 110, screen_y: 60,
    })
    expect(out[1].properties).toMatchObject({
      display_color: '#111111', display_segments: null, display_label: 'a', display_shape: 'triangle', species: 'Sp small',
    })
  })

  it('preserves the exact polygon geometry and resolved range colors in screen coordinates', () => {
    const source = [
      feature({ scientific_name: 'A' }, [-70, -5]),
      feature({ scientific_name: 'A' }, [-69, -5]),
      feature({ scientific_name: 'A' }, [-70, -4])
    ]
    const polygons = resolveRangeFeatures({ type: 'FeatureCollection', features: source }, {
      method: 'hulls', groupBy: 'species', bufferKm: 0, minPoints: 3
    }, { A: '#123456' }, project)
    expect(polygons.features).toHaveLength(1)
    expect(polygons.features[0].properties.color).toBe('#0072B2')
    expect(polygons.features[0].geometry.type).toBe('Polygon')
    expect(polygons.features[0].screen_geometry.coordinates[0]).toContainEqual([100, 50])
    expect(screenGeometry({ type: 'Polygon', coordinates: [[[-70, -5], [-69, -5], [-69, -4], [-70, -5]]] }, project))
      .toEqual({ type: 'Polygon', coordinates: [[[100, 50], [110, 50], [110, 60], [100, 50]]] })
  })

  it('records rendered font size after the legend preview transform', () => {
    const container = document.createElement('div')
    const legend = document.createElement('div')
    legend.className = 'legend-container'
    const title = document.createElement('div')
    title.className = 'legend-title'
    title.style.fontSize = '12px'
    title.innerHTML = '<span>Species</span>'
    legend.append(title)
    container.append(legend)
    document.body.append(container)
    container.getBoundingClientRect = () => ({ x: 0, y: 0, width: 500, height: 300 })
    Object.defineProperty(legend, 'offsetWidth', { value: 200 })
    legend.getClientRects = () => [{}]
    title.getClientRects = () => [{}]
    title.querySelector('span').getClientRects = () => [{}]
    title.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20 })
    title.querySelector('span').getBoundingClientRect = () => ({ x: 0, y: 0, width: 80, height: 20 })
    for (const scale of [0.5, 1.5]) {
      legend.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200 * scale, height: 100 * scale })
      expect(snapshotLegend(container).rows[0].fontSize).toBe(12 * scale)
    }
    container.remove()
  })
})
