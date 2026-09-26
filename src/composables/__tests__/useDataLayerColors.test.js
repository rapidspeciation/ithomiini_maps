import { describe, expect, it } from 'vitest'
import {
  buildClusterOutlineExpression, buildPointColorExpression, buildRangePointCirclePaint,
  buildSiteCirclePaint, buildSiteIconSize, siteFeatureCollection, visibleSiteRadius,
} from '../useDataLayer'
import { getColoredShapeImageName } from '../../utils/shapes'

const style = { pointSize: 10, borderWidth: 2, borderColor: '#ffffff', fillOpacity: 0.4, borderOpacity: 0.8 }

describe('range point color expressions', () => {
  const colorMap = { casabranca: '#111111', travella: '#222222' }
  const speciesColorMap = { 'Mechanitis polymnia': '#aabbcc' }
  const collapsedSpecies = ['Mechanitis polymnia']

  it('colours a collapsed species before checking subspecies', () => {
    expect(buildPointColorExpression({
      colorMap, colorAttribute: 'subspecies', speciesColorMap, collapsedSpecies,
    })).toEqual([
      'case',
      ['==', ['get', 'scientific_name'], 'Mechanitis polymnia'], '#aabbcc',
      ['match', ['get', 'subspecies'], 'casabranca', '#111111', 'travella', '#222222', '#6b7280'],
    ])
  })

  it('restores range point radii', () => {
    const paint = buildRangePointCirclePaint({
      radii: [[3, 1.5], [6, 2.5], [10, 4], [14, 6]],
      colorMap, colorAttribute: 'subspecies', speciesColorMap, collapsedSpecies,
      opacity: 0.5, strokeWidth: 0.5, strokeOpacity: 0.3,
    })
    expect(paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 3, 1.5, 6, 2.5, 10, 4, 14, 6])
    expect(paint['circle-color'][2]).toBe('#aabbcc')
    expect(paint['circle-opacity']).toBe(0.5)
  })
})

describe('site markers', () => {
  const site = {
    key: '-1.0000,-77.0000', coordinates: [-77, -1], individuals: 94, recordCount: 101,
    speciesCount: 2, sizeFactor: 2.18, fill: null, locality: 'Suchipakari', country: 'Ecuador',
  }

  it('writes one feature per site with size, sort order and optional icon', () => {
    const { features } = siteFeatureCollection([site], () => 'site-pie:x')
    expect(features).toHaveLength(1)
    expect(features[0].properties).toMatchObject({
      site_key: site.key, individuals: 94, record_count: 101, size_factor: 2.18,
      sort_key: -94, fill: '#6b7280', marker_icon: 'site-pie:x', collection_location: 'Suchipakari',
    })
    expect(siteFeatureCollection([site]).features[0].properties).not.toHaveProperty('marker_icon')
  })

  it('scales circle radius by each site size factor at every zoom stop', () => {
    const paint = buildSiteCirclePaint(style)
    expect(paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'],
      3, ['+', ['*', 3.375, ['get', 'size_factor']], 0],
      6, ['+', ['*', 5.625, ['get', 'size_factor']], 0],
      10, ['+', ['*', 9, ['get', 'size_factor']], 0],
      14, ['+', ['*', 13.5, ['get', 'size_factor']], 0]])
    expect(paint['circle-color']).toEqual(['get', 'fill'])
    expect(paint['circle-opacity']).toBe(0.4)
    expect(paint['circle-stroke-opacity']).toBe(0.8)
  })

  it('sizes icons to the same outer radius as circles', () => {
    const size = buildSiteIconSize(style)
    // At zoom 10 a size-1 site has radius 9 plus a 1 px half border: 10 / 16.
    const expression = size[size.indexOf(10) + 1]
    expect(expression).toEqual(['/', ['+', ['*', 9, ['get', 'size_factor']], 1], 16])
    expect(visibleSiteRadius(style, 10)).toBeCloseTo(10)
    expect(visibleSiteRadius(style, 10, 2)).toBeCloseTo(19)
    expect(visibleSiteRadius(style, 3)).toBeCloseTo(3.705)
  })

  it('uses distinct image signatures for independent opacity changes', () => {
    const original = getColoredShapeImageName('circle', '#aabbcc', '#ffffff', 2, 0.4, 0.8)
    expect(getColoredShapeImageName('circle', '#aabbcc', '#ffffff', 2, 0.5, 0.8)).not.toBe(original)
    expect(getColoredShapeImageName('circle', '#aabbcc', '#ffffff', 2, 0.4, 0.7)).not.toBe(original)
  })

  it('sizes cluster outlines by the individuals they contain', () => {
    expect(buildClusterOutlineExpression()).toEqual([
      'step', ['get', 'individuals'], 'cluster-outline-12',
      20, 'cluster-outline-16', 50, 'cluster-outline-20',
      100, 'cluster-outline-25', 500, 'cluster-outline-32',
    ])
  })
})
