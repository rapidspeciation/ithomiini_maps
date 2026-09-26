import { describe, expect, it } from 'vitest'
import { combineSiteSegments, clusterCircleRadius } from '../clusterComposition'

describe('cluster composition', () => {
  it('sums site segments so each record contributes once', () => {
    const result = combineSiteSegments([
      { segments: [{ color: '#aaaaaa', count: 2 }, { color: '#222222', count: 1 }] },
      { segments: [{ color: '#222222', count: 1 }, { color: '#6b7280', count: 1 }] },
      undefined, // a stale leaf with no site summary is ignored
    ])
    expect(result.total).toBe(5)
    expect(result.segments).toEqual([
      { color: '#222222', count: 2, fraction: 0.4 },
      { color: '#6b7280', count: 1, fraction: 0.2 },
      { color: '#aaaaaa', count: 2, fraction: 0.4 },
    ])
  })

  it('keeps deterministic radius thresholds without a minimum segment size', () => {
    expect([2, 20, 50, 100, 500].map(clusterCircleRadius)).toEqual([12, 16, 20, 25, 32])
    const result = combineSiteSegments([{ segments: [{ color: '#111111', count: 99 }, { color: '#333333', count: 1 }] }])
    expect(result.segments.find(segment => segment.color === '#333333').fraction).toBe(0.01)
  })
})
