import { describe, expect, it } from 'vitest'
import {
  computeClusterStats,
  countUniqueIndividuals,
  dedupePointsByIndividual
} from '../clusterStats'

describe('clusterStats individual counting', () => {
  it('counts duplicate records with the same occurrence id as one individual', () => {
    const points = [
      { id: 'gbif-1', scientific_name: 'Mechanitis polymnia', image_url: 'a.jpg' },
      { id: 'gbif-1', scientific_name: 'Mechanitis polymnia', image_url: 'b.jpg' },
      { id: 'gbif-2', scientific_name: 'Mechanitis polymnia' }
    ]

    expect(countUniqueIndividuals(points)).toBe(2)
    expect(dedupePointsByIndividual(points)).toHaveLength(2)
  })

  it('keeps unkeyed records separate to avoid undercounting unknown individuals', () => {
    const points = [
      { scientific_name: 'Mechanitis polymnia' },
      { scientific_name: 'Mechanitis polymnia' },
      { gbifID: '123', scientific_name: 'Mechanitis polymnia' },
      { gbifID: '123', scientific_name: 'Mechanitis polymnia' }
    ]

    expect(countUniqueIndividuals(points)).toBe(3)
    expect(dedupePointsByIndividual(points)).toHaveLength(3)
  })

  it('reports raw records separately from unique individuals in cluster stats', () => {
    const features = [
      {
        geometry: { coordinates: [-78.5, -0.2] },
        properties: { id: 'occ-1', scientific_name: 'Mechanitis polymnia', country: 'Ecuador' }
      },
      {
        geometry: { coordinates: [-78.5, -0.2] },
        properties: { id: 'occ-1', scientific_name: 'Mechanitis polymnia', country: 'Ecuador' }
      },
      {
        geometry: { coordinates: [-78.6, -0.3] },
        properties: { id: 'occ-2', scientific_name: 'Ithomia agnosia', country: 'Ecuador' }
      }
    ]

    const stats = computeClusterStats(features, -0.25, -78.55)

    expect(stats.recordCount).toBe(3)
    expect(stats.individualCount).toBe(2)
    expect(stats.specimenCount).toBe(2)
    expect(stats.locationCount).toBe(2)
  })
})
