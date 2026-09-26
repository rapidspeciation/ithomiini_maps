import { describe, expect, it } from 'vitest'
import { drawLocalityLeader, groupLocalityAnchors, leaderImageSpec } from '../localityArrows'

const point = (id, lng, lat, geometry = [lng, lat]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: geometry },
  properties: { id, lng, lat, collection_location: 'Suchipakari', country: 'Ecuador' },
})

describe('locality arrow anchors', () => {
  it('groups only records at the same genuine coordinate and locality', () => {
    const anchors = groupLocalityAnchors([
      point('a', -77.6, -1), point('b', -77.6, -1), point('c', -77.601, -1),
    ])
    expect(anchors).toHaveLength(2)
    expect(anchors[0]).toMatchObject({ coordinates: [-77.6, -1], recordCount: 2, label: 'Suchipakari' })
    expect(anchors[1]).toMatchObject({ coordinates: [-77.601, -1], recordCount: 1 })
    expect(anchors[0].siteId).toBe(anchors[1].siteId)
  })

  it('anchors scattered display points to the original observation', () => {
    const feature = point('a', -77.6, -1, [-77.55, -1.05])
    feature.properties._originalLng = -77.6
    feature.properties._originalLat = -1
    expect(groupLocalityAnchors([feature])[0].coordinates).toEqual([-77.6, -1])
  })

  it('draws a thin connector with a filled triangle and a contrasting edge', () => {
    const spec = leaderImageSpec(30, 6)
    expect(spec).toMatchObject({ length: 30, radius: 6, emphasized: false })
    const icon = drawLocalityLeader(spec)
    expect(icon).toMatchObject({ width: 16, height: 64, pixelRatio: 2 })
    const pixels = []
    for (let i = 0; i < icon.data.length; i += 4) {
      if (icon.data[i + 3]) pixels.push([...icon.data.slice(i, i + 4)])
    }
    expect(pixels).toContainEqual([29, 43, 40, 255])
    expect(pixels).toContainEqual([255, 255, 255, 255])
    expect(pixels.length).toBeLessThan(250)
    expect(leaderImageSpec(30.4, 6).id).toBe(spec.id)
    expect(leaderImageSpec(30, 6, true).id).not.toBe(spec.id)
  })

  it('inverts leader ink on dark basemaps and keys the sprite by theme', () => {
    const spec = leaderImageSpec(30, 6, false, 'dark')
    expect(spec.id).not.toBe(leaderImageSpec(30, 6).id)
    const icon = drawLocalityLeader(spec)
    const pixels = []
    for (let i = 0; i < icon.data.length; i += 4) {
      if (icon.data[i + 3]) pixels.push([...icon.data.slice(i, i + 4)])
    }
    expect(pixels).toContainEqual([238, 242, 240, 255])
    expect(pixels).toContainEqual([16, 18, 28, 255])
  })
})
