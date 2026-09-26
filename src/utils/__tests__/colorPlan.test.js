import { describe, expect, it } from 'vitest'
import { DYNAMIC_COLORS } from '../constants'
import { individualsPosition, OTHER_COLOR, planColors, rampColor } from '../colorPlan'

const records = counts => Object.entries(counts).flatMap(([label, count]) =>
  Array.from({ length: count }, () => ({ properties: { subspecies: label, scientific_name: `Species ${label}` } })))

describe('colour plan', () => {
  it('colours every group when there are at most ten, by rank of record count', () => {
    const plan = planColors(records({ rare: 1, common: 5, middle: 3 }), { attribute: 'subspecies' })
    expect(plan.mode).toBe('categories')
    expect(plan.groups.map(group => [group.label, group.color])).toEqual([
      ['common', DYNAMIC_COLORS[0]], ['middle', DYNAMIC_COLORS[1]], ['rare', DYNAMIC_COLORS[2]],
    ])
    expect(plan.otherGroupCount).toBe(0)
    expect(plan.colorForRecord({ subspecies: 'rare' })).toBe(DYNAMIC_COLORS[2])
  })

  it('colours the top ten and greys the rest when they cover most records', () => {
    const counts = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`g${index}`, index < 10 ? 10 : 1]))
    const plan = planColors(records(counts), { attribute: 'subspecies' })
    expect(plan.mode).toBe('categories')
    expect(plan.colored).toHaveLength(10)
    expect(plan.otherGroupCount).toBe(2)
    expect(plan.otherRecordCount).toBe(2)
    expect(plan.groupForRecord({ subspecies: 'g11' })).toMatchObject({ key: 'other', color: OTHER_COLOR })
  })

  it('switches to individuals when the top ten would leave most of the map grey', () => {
    const counts = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`g${index}`, 1]))
    const plan = planColors(records(counts), { attribute: 'subspecies' })
    expect(plan.automatic).toBe('individuals')
    expect(plan.mode).toBe('individuals')
    expect(plan.colorForRecord({ subspecies: 'g0' })).toBeNull()
    expect(planColors(records(counts), { attribute: 'subspecies', override: 'categories' }).colored).toHaveLength(10)
    // Overrides only matter when there are too many groups.
    expect(planColors(records({ a: 1 }), { attribute: 'subspecies', override: 'individuals' }).mode).toBe('categories')
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

describe('individuals ramp', () => {
  it('interpolates between ramp stops', () => {
    const ramp = ['#000000', '#ffffff']
    expect(rampColor(ramp, 0)).toBe('#000000')
    expect(rampColor(ramp, 1)).toBe('#ffffff')
    expect(rampColor(ramp, 0.5)).toBe('#808080')
    expect(rampColor(ramp, 7)).toBe('#ffffff')
  })

  it('places sites on a log scale from one individual to the busiest site', () => {
    expect(individualsPosition(1, 683)).toBe(0)
    expect(individualsPosition(683, 683)).toBe(1)
    expect(individualsPosition(26, 683)).toBeCloseTo(Math.log(26) / Math.log(683))
    expect(individualsPosition(5, 1)).toBe(1)
  })
})
