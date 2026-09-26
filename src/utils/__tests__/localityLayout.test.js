import { describe, expect, it } from 'vitest'
import { labelBudget, layoutLocalityLabels, wrapLocalityLabel } from '../localityLayout'

const measure = text => text.length * 7
const view = { project: coordinates => ({ x: coordinates[0], y: coordinates[1] }),
  width: 400, height: 300, measure }
const item = (key, x, y, priority = 0, label = key) => ({ key, label,
  coordinates: [x, y], radius: 12, priority })
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const box = (x, y, radius) => ({ left: x - radius, right: x + radius,
  top: y - radius, bottom: y + radius })

describe('screen-space locality placement', () => {
  it('wraps labels before measuring their boxes', () => {
    expect(wrapLocalityLabel('Suchipakari and nearby localities on the Napo', measure))
      .toContain('\n')
  })

  it('keeps labels off marker boxes, keeps leaders attached, and permits line crossings', () => {
    const { placements } = layoutLocalityLabels([
      item('a', 100, 100, -3, 'Suchipakari'),
      item('b', 140, 100, -2, 'Jatun Sacha'),
    ], { ...view, markerObstacles: [{ x: 100, y: 70, radius: 13 }] })
    expect(placements).toHaveLength(2)
    for (const placed of placements) {
      expect(placed.leader.shaft[1]).toEqual(placed.leader.arrowhead.point)
      for (const marker of [box(100, 100, 12), box(140, 100, 12), box(100, 70, 13)]) {
        expect(intersects(placed.rect, marker)).toBe(false)
      }
      const tip = placed.leader.arrowhead.point
      expect(Math.hypot(tip.x - placed.anchor.x, tip.y - placed.anchor.y)).toBeCloseTo(12)
    }
    expect(intersects(placements[0].rect, placements[1].rect)).toBe(false)
    expect(placements[0].candidate).not.toBe(0)
  })

  it('names only the largest sites within the budget and always keeps shortlisted ones', () => {
    const sites = [item('small', 60, 60, -1), item('large', 200, 150, -50), item('medium', 330, 240, -10)]
    const shortlisted = { ...item('shortlisted', 330, 60, 0), shortlisted: true }
    const { placements } = layoutLocalityLabels([...sites, shortlisted], { ...view, maxLabels: 2 })
    expect(placements.map(placed => placed.item.key).sort()).toEqual(['large', 'medium', 'shortlisted'])
  })

  it('does not push ordinary labels onto long leaders', () => {
    // Every near position is blocked; only the far ring is free.
    const blockers = [[200, 110], [200, 190], [140, 150], [260, 150]].map(([x, y]) => ({ x, y, radius: 30 }))
    const site = item('site', 200, 150, -5, 'Río')
    expect(layoutLocalityLabels([site], { ...view, markerObstacles: blockers }).placements).toHaveLength(0)
    expect(layoutLocalityLabels([{ ...site, shortlisted: true }], { ...view, markerObstacles: blockers })
      .placements[0].candidate).toBeGreaterThanOrEqual(8)
  })

  it('scales the label budget with the map area', () => {
    expect(labelBudget(1450, 1380)).toBe(8)
    expect(labelBudget(390, 600)).toBe(3)
    expect(labelBudget(4000, 3000)).toBe(12)
  })

  it('places selected first and reuses a previous candidate after a small pan', () => {
    const entries = [item('ordinary', 150, 150, 0), item('selected', 150, 150, -2000000)]
    const first = layoutLocalityLabels(entries, view)
    expect(first.placements[0].item.key).toBe('selected')
    const next = layoutLocalityLabels(entries.map(entry => ({ ...entry,
      coordinates: [entry.coordinates[0] + 2, entry.coordinates[1] + 2] })),
    { ...view, preferred: first.choices })
    expect(next.choices.get('selected')).toBe(first.choices.get('selected'))
  })

  it('rotates an up-facing triangle toward the marker in viewport coordinates', () => {
    const { placements } = layoutLocalityLabels([item('north', 200, 150)], view)
    expect(placements[0].candidate).toBe(0)
    expect(placements[0].leader.arrowhead.rotation).toBeCloseTo(180)
  })

  it('keeps collision padding while connecting ink to the visible marker edge', () => {
    const close = { ...item('near', 200, 150, 0, 'Suchipakari'), leaderRadius: 7 }
    const placed = layoutLocalityLabels([close], view).placements[0]
    const start = placed.leader.shaft[0]
    const tip = placed.leader.arrowhead.point
    expect(Math.hypot(tip.x - placed.anchor.x, tip.y - placed.anchor.y)).toBeCloseTo(7)
    expect(start.y).toBeGreaterThan(placed.rect.top)
    expect(start.y).toBeLessThan(placed.rect.bottom)
    expect(placed.leader.shaft[1]).toEqual(tip)
  })

  it('culls offscreen anchors and omits labels when every position is blocked', () => {
    const blocked = layoutLocalityLabels([item('a', 200, 150), item('far', -500, 0)],
      { ...view, markerObstacles: [{ x: 200, y: 150, radius: 140 }] })
    expect(blocked.placements).toEqual([])
  })
})
