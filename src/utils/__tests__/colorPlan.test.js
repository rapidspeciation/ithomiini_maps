import { describe, expect, it } from 'vitest'
import { DYNAMIC_COLORS } from '../constants'
import { OTHER_COLOR, planColors } from '../colorPlan'

const records = counts => Object.entries(counts).flatMap(([label, count]) =>
  Array.from({ length: count }, () => ({ properties: { subspecies: label, scientific_name: `Species ${label}` } })))

describe('colour plan', () => {
  it('colours every group when there are at most ten, by rank of record count', () => {
    const plan = planColors(records({ rare: 1, common: 5, middle: 3 }), { attribute: 'subspecies' })
    expect(plan.groups.map(group => [group.label, group.color])).toEqual([
      ['common', DYNAMIC_COLORS[0]], ['middle', DYNAMIC_COLORS[1]], ['rare', DYNAMIC_COLORS[2]],
    ])
    expect(plan.otherGroupCount).toBe(0)
    expect(plan.colorForRecord({ subspecies: 'rare' })).toBe(DYNAMIC_COLORS[2])
  })

  it('colours the top ten and greys the rest when they cover most records', () => {
    const counts = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`g${index}`, index < 10 ? 10 : 1]))
    const plan = planColors(records(counts), { attribute: 'subspecies' })
    expect(plan.colored).toHaveLength(10)
    expect(plan.otherGroupCount).toBe(2)
    expect(plan.otherRecordCount).toBe(2)
    expect(plan.groupForRecord({ subspecies: 'g11' })).toMatchObject({ key: 'other', color: OTHER_COLOR })
  })

  it('colours the ten most abundant even when most records are grey', () => {
    const counts = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`g${String(index).padStart(2, '0')}`, index < 3 ? 5 : 1]))
    const plan = planColors(records(counts), { attribute: 'subspecies' })
    expect(plan.colored.map(group => group.label).slice(0, 3)).toEqual(['g00', 'g01', 'g02'])
    expect(plan.colored).toHaveLength(10)
    expect(plan.otherGroupCount).toBe(30)
    expect(plan.colorForRecord({ subspecies: 'g00' })).toBe(DYNAMIC_COLORS[0])
    expect(plan.colorForRecord({ subspecies: 'g39' })).toBe(OTHER_COLOR)
  })

  it('never colours placeholder names such as "Unknown species"', () => {
    const features = [
      ...Array.from({ length: 5 }, () => ({ properties: { scientific_name: 'Unknown species' } })),
      { properties: { scientific_name: 'Ithomia salapia' } },
    ]
    const plan = planColors(features, { attribute: 'scientific_name' })
    expect(plan.groups.map(group => group.label)).toEqual(['Ithomia salapia'])
    expect(plan.missing).toBe(5)
    expect(plan.colorForRecord({ scientific_name: 'Unknown species' })).toBe(OTHER_COLOR)
  })

  it('treats a collapsed species as one group and ignores missing values', () => {
    const features = [
      { properties: { scientific_name: 'Mechanitis polymnia', subspecies: 'casabranca' } },
      { properties: { scientific_name: 'Mechanitis polymnia', subspecies: 'Unknown' } },
      { properties: { scientific_name: 'Ithomia salapia', subspecies: 'derasa' } },
      { properties: { scientific_name: 'Ithomia salapia', subspecies: 'Unknown' } },
    ]
    const plan = planColors(features, { attribute: 'subspecies', collapsedSpecies: ['Mechanitis polymnia'] })
    expect(plan.groups.map(group => [group.label, group.count, group.collapsed])).toEqual([
      ['Mechanitis polymnia', 2, true], ['derasa', 1, false],
    ])
    expect(plan.missing).toBe(1)
    expect(plan.colorForRecord({ scientific_name: 'Mechanitis polymnia', subspecies: 'Unknown' })).toBe(DYNAMIC_COLORS[0])
    expect(plan.colorForRecord({ scientific_name: 'Ithomia salapia', subspecies: 'Unknown' })).toBe(OTHER_COLOR)
  })

  it('applies fixed palettes and custom colours without changing the default', () => {
    const plan = planColors(records({ Sequenced: 2, Pending: 1 }), {
      attribute: 'subspecies', fixedColors: { Sequenced: '#00ff00' }, customColors: { Pending: '#123456' },
    })
    expect(plan.groups.find(group => group.label === 'Sequenced')).toMatchObject({ color: '#00ff00', baseColor: '#00ff00' })
    expect(plan.groups.find(group => group.label === 'Pending')).toMatchObject({ color: '#123456', baseColor: DYNAMIC_COLORS[1] })
  })
})
