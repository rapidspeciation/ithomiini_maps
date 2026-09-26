import { describe, it, expect, vi } from 'vitest'
import { readClusterLeaves } from '../clusterLeaves'
import { withHeatmapWeights } from '../heatmap'

describe('exact cluster membership', () => {
  it('uses the Promise API without a timeout or neighbouring-point approximation', async () => {
    const leaves = [{ properties: { collection_location: 'Suchipakari' } }]
    const source = { getClusterLeaves: vi.fn().mockResolvedValue(leaves) }
    expect(await readClusterLeaves(source, 17, 106)).toBe(leaves)
    expect(source.getClusterLeaves).toHaveBeenCalledWith(17, 106, 0)
  })
  it('does not invent membership when the source rejects a stale cluster', async () => {
    await expect(readClusterLeaves({ getClusterLeaves: () => Promise.reject(new Error('stale')) }, 17, 2)).rejects.toThrow('stale')
  })
})
describe('heatmap scaling', () => {
  const point = (x, y) => ({ geometry: { coordinates: [x, y] }, properties: {} })
  const locationTotals = collection => {
    const totals = new Map()
    for (const feature of collection.features) {
      const key = feature.geometry.coordinates.join(',')
      totals.set(key, (totals.get(key) || 0) + feature.properties.heat_weight)
    }
    return totals
  }

  it('log-compresses stacked records so single records stay visible', () => {
    const stacked = Array.from({ length: 99 }, () => point(1, 2))
    const totals = locationTotals(withHeatmapWeights({ type: 'FeatureCollection', features: [...stacked, point(2, 3)] }))
    expect(totals.get('1,2')).toBeCloseTo(2.5)
    // Linear weighting would give the lone record 1/99 of the busiest site.
    expect(totals.get('2,3') / totals.get('1,2')).toBeCloseTo(Math.log(2) / Math.log(100))
  })

  it('keeps original properties and handles empty collections', () => {
    expect(withHeatmapWeights({ type: 'FeatureCollection', features: [] }).features).toEqual([])
    const [feature] = withHeatmapWeights({ features: [{ geometry: { coordinates: [0, 0] }, properties: { id: 'a' } }] }).features
    expect(feature.properties).toMatchObject({ id: 'a', heat_weight: 2.5 })
  })
})

import { parseSharedMapView } from '../sharedMapView'
describe('shared camera', () => {
  it('restores geographic views and rejects invalid coordinates', () => {
    expect(parseSharedMapView('-77.7,-1.03,9')).toEqual({ center: [-77.7, -1.03], zoom: 9 })
    for (const value of [null, 'table', '999,1,9', '1,90,9', '1,2,99', '1,2,NaN']) expect(parseSharedMapView(value)).toBeNull()
  })
})
