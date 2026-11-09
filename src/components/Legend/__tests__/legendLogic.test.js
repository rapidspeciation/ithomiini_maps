// @vitest-environment node
import { describe, it, expect } from 'vitest'

/**
 * Tests for pure legend data transformation logic.
 * These test the same algorithms used in Legend.vue and useDataLayer.js
 * without needing Pinia/Vue component setup.
 */

// Replicate the legend counts logic from Legend.vue
function computeLegendCounts(features, colorByAttribute, hiddenItems = []) {
  const hidden = new Set(hiddenItems)
  const counts = {}
  for (const feature of features) {
    const val = feature.properties[colorByAttribute]
    if (val && val !== 'Unknown' && val !== 'NA' && !hidden.has(val)) {
      counts[val] = (counts[val] || 0) + 1
    }
  }
  return counts
}

// Replicate the hidden items filtering from useDataLayer.js
function filterHiddenFeatures(features, colorByAttribute, hiddenItems) {
  if (!hiddenItems.length) return features
  const hiddenSet = new Set(hiddenItems)
  return features.filter(f => !hiddenSet.has(f.properties[colorByAttribute]))
}

// Replicate the item→group mapping from Legend.vue
function buildItemGroupMap(features, groupByProperty, itemProperty) {
  const map = {}
  for (const feature of features) {
    const groupVal = feature.properties[groupByProperty]
    const itemVal = feature.properties[itemProperty]
    if (!groupVal || !itemVal) continue
    if (itemVal === 'Unknown' || itemVal === 'NA') continue
    if (!map[groupVal]) map[groupVal] = new Set()
    map[groupVal].add(itemVal)
  }
  const result = {}
  for (const [group, items] of Object.entries(map)) {
    result[group] = [...items].sort()
  }
  return result
}

// Test fixtures
const sampleFeatures = [
  { properties: { subspecies: 'casabranca', scientific_name: 'Mechanitis polymnia', genus: 'Mechanitis', sequencing_status: 'Sequenced' } },
  { properties: { subspecies: 'casabranca', scientific_name: 'Mechanitis polymnia', genus: 'Mechanitis', sequencing_status: 'Sequenced' } },
  { properties: { subspecies: 'veritabilis', scientific_name: 'Mechanitis polymnia', genus: 'Mechanitis', sequencing_status: 'Not sequenced' } },
  { properties: { subspecies: 'isthmia', scientific_name: 'Mechanitis menapis', genus: 'Mechanitis', sequencing_status: 'Sequenced' } },
  { properties: { subspecies: 'lysimnia', scientific_name: 'Methona confusa', genus: 'Methona', sequencing_status: 'Not sequenced' } },
  { properties: { subspecies: 'lysimnia', scientific_name: 'Methona confusa', genus: 'Methona', sequencing_status: 'Not sequenced' } },
  { properties: { subspecies: 'Unknown', scientific_name: 'Unknown', genus: 'Unknown', sequencing_status: 'Unknown' } },
]

describe('computeLegendCounts', () => {
  it('counts subspecies correctly', () => {
    const counts = computeLegendCounts(sampleFeatures, 'subspecies')
    expect(counts).toEqual({
      casabranca: 2,
      veritabilis: 1,
      isthmia: 1,
      lysimnia: 2
    })
  })

  it('counts species correctly', () => {
    const counts = computeLegendCounts(sampleFeatures, 'scientific_name')
    expect(counts).toEqual({
      'Mechanitis polymnia': 3,
      'Mechanitis menapis': 1,
      'Methona confusa': 2
    })
  })

  it('counts genus correctly', () => {
    const counts = computeLegendCounts(sampleFeatures, 'genus')
    expect(counts).toEqual({
      Mechanitis: 4,
      Methona: 2
    })
  })

  it('counts sequencing status correctly', () => {
    const counts = computeLegendCounts(sampleFeatures, 'sequencing_status')
    expect(counts).toEqual({
      Sequenced: 3,
      'Not sequenced': 3
    })
  })

  it('excludes Unknown/NA values', () => {
    const counts = computeLegendCounts(sampleFeatures, 'subspecies')
    expect(counts['Unknown']).toBeUndefined()
  })

  it('excludes hidden items from count', () => {
    const counts = computeLegendCounts(sampleFeatures, 'subspecies', ['casabranca'])
    expect(counts['casabranca']).toBeUndefined()
    expect(counts['veritabilis']).toBe(1)
  })

  it('handles empty features array', () => {
    const counts = computeLegendCounts([], 'subspecies')
    expect(counts).toEqual({})
  })
})

describe('filterHiddenFeatures', () => {
  it('returns all features when no hidden items', () => {
    const result = filterHiddenFeatures(sampleFeatures, 'subspecies', [])
    expect(result.length).toBe(sampleFeatures.length)
  })

  it('removes features matching hidden items', () => {
    const result = filterHiddenFeatures(sampleFeatures, 'subspecies', ['casabranca'])
    expect(result.length).toBe(5) // 7 - 2 casabranca
    expect(result.every(f => f.properties.subspecies !== 'casabranca')).toBe(true)
  })

  it('works with species attribute', () => {
    const result = filterHiddenFeatures(sampleFeatures, 'scientific_name', ['Mechanitis polymnia'])
    expect(result.length).toBe(4) // 7 - 3 M. polymnia
  })

  it('works with multiple hidden items', () => {
    const result = filterHiddenFeatures(sampleFeatures, 'subspecies', ['casabranca', 'lysimnia'])
    expect(result.length).toBe(3) // 7 - 2 casabranca - 2 lysimnia
  })
})

describe('buildItemGroupMap', () => {
  it('groups subspecies by species', () => {
    const map = buildItemGroupMap(sampleFeatures, 'scientific_name', 'subspecies')
    expect(map).toEqual({
      'Mechanitis polymnia': ['casabranca', 'veritabilis'],
      'Mechanitis menapis': ['isthmia'],
      'Methona confusa': ['lysimnia']
    })
  })

  it('groups subspecies by genus', () => {
    const map = buildItemGroupMap(sampleFeatures, 'genus', 'subspecies')
    expect(map).toEqual({
      'Mechanitis': ['casabranca', 'isthmia', 'veritabilis'],
      'Methona': ['lysimnia']
    })
  })

  it('groups species by genus', () => {
    const map = buildItemGroupMap(sampleFeatures, 'genus', 'scientific_name')
    expect(map).toEqual({
      'Mechanitis': ['Mechanitis menapis', 'Mechanitis polymnia'],
      'Methona': ['Methona confusa']
    })
  })

  it('excludes Unknown/NA item values', () => {
    const map = buildItemGroupMap(sampleFeatures, 'genus', 'subspecies')
    // Unknown subspecies should not appear
    for (const items of Object.values(map)) {
      expect(items).not.toContain('Unknown')
    }
  })

  it('returns sorted items within each group', () => {
    const map = buildItemGroupMap(sampleFeatures, 'genus', 'subspecies')
    expect(map['Mechanitis']).toEqual(['casabranca', 'isthmia', 'veritabilis'])
  })

  it('handles empty features', () => {
    const map = buildItemGroupMap([], 'genus', 'subspecies')
    expect(map).toEqual({})
  })
})
