import { describe, expect, it } from 'vitest'
import { OTHER_COLOR, planColors } from '../colorPlan'
import { foldMinorSegments, groupRecordsBySite, markerSizeFactor, MERGED_SIZE_CAP, mergeSiteSummaries, pieSignature, siteKeyFor, summarizeSites } from '../sites'

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
    const { sites } = summarizeSites(groupRecordsBySite(features), { plan })
    const mixed = sites.find(site => site.recordCount === 3)
    expect(mixed).toMatchObject({ individuals: 2, speciesCount: 2, locality: 'Mindo', country: 'Ecuador', fill: null })
    expect(mixed.segments.map(segment => [segment.label, segment.count])).toEqual([['casabranca', 2], ['veritabilis', 1]])
    expect(sites.find(site => site.recordCount === 1).fill).toBe(plan.colorForRecord({ subspecies: 'veritabilis' }))
  })

  it('can keep equal marker sizes', () => {
    const features = [record('a', -78, -1), record('b', -78, -1), record('c', -77, -2)]
    const plan = planColors(features, { attribute: 'subspecies' })
    const { sites } = summarizeSites(groupRecordsBySite(features), { plan, sizeByIndividuals: false })
    expect(sites.map(site => [site.individuals, site.sizeFactor])).toEqual([[2, 1], [1, 1]])
  })

  it('greys sites whose records are all outside the coloured groups', () => {
    const plan = { groups: [], groupForRecord: () => ({ key: 'other', label: 'Other', color: OTHER_COLOR }) }
    const { sites } = summarizeSites(groupRecordsBySite([record('a', 0, 0)]), { plan })
    expect(sites[0].fill).toBe(OTHER_COLOR)
  })

  it('folds small and surplus slices into grey Other', () => {
    const segment = (key, color, count) => ({ key, label: key, color, count })
    const folded = foldMinorSegments([
      segment('a', '#111111', 50), segment('b', '#222222', 5), segment('other', OTHER_COLOR, 45),
    ])
    expect(folded.map(({ key, count }) => [key, count])).toEqual([['a', 50], ['other', 50]])
    expect(folded[1].fraction).toBeCloseTo(0.5)
    const many = foldMinorSegments(['a', 'b', 'c', 'd', 'e', 'f'].map((key, index) => segment(key, `#00000${index}`, 20 - index)))
    expect(many.map(item => item.key)).toEqual(['a', 'b', 'c', 'd', 'other'])
    expect(many.at(-1).count).toBe(15 + 16)
  })

  it('merges nearby sites into one marker with summed individuals and segments', () => {
    const features = [
      record('a', -78, -1, { subspecies: 'casabranca' }),
      record('b', -78.001, -1, { subspecies: 'veritabilis', scientific_name: 'Ithomia salapia', collection_location: 'Tena' }),
      record('c', -78.001, -1, { subspecies: 'veritabilis', scientific_name: 'Ithomia salapia', collection_location: 'Tena' }),
    ]
    const plan = planColors(features, { attribute: 'subspecies' })
    const { sites } = summarizeSites(groupRecordsBySite(features), { plan })
    const order = new Map(plan.groups.map((group, index) => [group.key, index]))
    const merged = mergeSiteSummaries(sites, [-78.0005, -1], { order })
    expect(merged).toMatchObject({ individuals: 3, recordCount: 3, speciesCount: 2, siteCount: 2, locality: 'Tena', fill: null })
    expect(merged.segments.map(item => [item.label, item.count])).toEqual([['veritabilis', 2], ['casabranca', 1]])
    expect(merged.sizeFactor).toBeCloseTo(markerSizeFactor(3, MERGED_SIZE_CAP))
    expect(markerSizeFactor(5000, MERGED_SIZE_CAP)).toBe(2.2)
  })

  it('quantizes pie compositions so similar sites share an image', () => {
    const a = pieSignature([{ color: '#111111', fraction: 0.5 }, { color: '#222222', fraction: 0.5 }])
    const b = pieSignature([{ color: '#111111', fraction: 0.51 }, { color: '#222222', fraction: 0.49 }])
    expect(a).toBe(b)
    expect(pieSignature([{ color: '#111111', fraction: 0.001 }])).toBe('#111111:1')
  })
})
