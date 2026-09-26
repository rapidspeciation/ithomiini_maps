import { describe, expect, it } from 'vitest'
import { OTHER_COLOR, planColors } from '../colorPlan'
import { groupRecordsBySite, markerSizeFactor, pieSignature, siteKeyFor, summarizeSites } from '../sites'

const record = (id, lng, lat, extra = {}) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { id, scientific_name: 'Mechanitis polymnia', subspecies: 'casabranca', collection_location: 'Mindo', country: 'Ecuador', ...extra },
})

describe('sites', () => {
  it('groups records within the popup coordinate tolerance into one site', () => {
    const sites = groupRecordsBySite([
      record('a', -78.77001, -0.05), record('b', -78.77004, -0.05), record('c', -77, -1),
      { type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 1] }, properties: {} },
    ])
    expect([...sites.keys()]).toEqual([siteKeyFor([-78.77001, -0.05]), siteKeyFor([-77, -1])])
    expect(sites.get(siteKeyFor([-78.77, -0.05])).records.map(r => r.properties.id)).toEqual(['a', 'b'])
  })

  it('grows markers with the logarithm of individuals and caps them', () => {
    expect(markerSizeFactor(1)).toBe(1)
    expect(markerSizeFactor(10)).toBeCloseTo(1.35)
    expect(markerSizeFactor(100)).toBeCloseTo(1.7)
    expect(markerSizeFactor(683)).toBe(1.8)
  })

  it('summarises individuals, species and legend-ordered pie segments', () => {
    const features = [
      record('a', -78, -1, { subspecies: 'casabranca' }),
      record('a', -78, -1, { subspecies: 'casabranca' }), // duplicate record of one individual
      record('b', -78, -1, { subspecies: 'veritabilis', scientific_name: 'Ithomia salapia' }),
      record('c', -77, -2, { subspecies: 'veritabilis', scientific_name: 'Ithomia salapia' }),
    ]
    const plan = planColors(features, { attribute: 'subspecies' })
    const { sites, maxIndividuals } = summarizeSites(groupRecordsBySite(features), { plan, ramp: ['#000000', '#ffffff'] })
    const mixed = sites.find(site => site.recordCount === 3)
    expect(mixed).toMatchObject({ individuals: 2, speciesCount: 2, locality: 'Mindo', country: 'Ecuador', fill: null })
    expect(mixed.segments.map(segment => [segment.label, segment.count])).toEqual([['casabranca', 2], ['veritabilis', 1]])
    expect(sites.find(site => site.recordCount === 1).fill).toBe(plan.colorForRecord({ subspecies: 'veritabilis' }))
    expect(maxIndividuals).toBe(2)
  })

  it('fills sites from the ramp in individuals mode and can keep equal sizes', () => {
    const features = [record('a', -78, -1), record('b', -78, -1), record('c', -77, -2)]
    const plan = { mode: 'individuals', groups: [] }
    const { sites } = summarizeSites(groupRecordsBySite(features), { plan, ramp: ['#000000', '#ffffff'], sizeByIndividuals: false })
    expect(sites.map(site => [site.individuals, site.fill, site.sizeFactor])).toEqual([[2, '#ffffff', 1], [1, '#000000', 1]])
    expect(sites[0].segments).toEqual([])
  })

  it('greys sites whose records are all outside the coloured groups', () => {
    const plan = { mode: 'categories', groups: [], groupForRecord: () => ({ key: 'other', label: 'Other', color: OTHER_COLOR }) }
    const { sites } = summarizeSites(groupRecordsBySite([record('a', 0, 0)]), { plan, ramp: [] })
    expect(sites[0].fill).toBe(OTHER_COLOR)
  })

  it('quantizes pie compositions so similar sites share an image', () => {
    const a = pieSignature([{ color: '#111111', fraction: 0.5 }, { color: '#222222', fraction: 0.5 }])
    const b = pieSignature([{ color: '#111111', fraction: 0.51 }, { color: '#222222', fraction: 0.49 }])
    expect(a).toBe(b)
    expect(pieSignature([{ color: '#111111', fraction: 0.001 }])).toBe('#111111:1')
  })
})
