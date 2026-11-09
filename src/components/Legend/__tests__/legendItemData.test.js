// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { useLegendBaseData } from '../useLegendItemData'

// The legend's own counts and species groups, from the composable Legend.vue uses (replaces legendLogic.test.js,
// which tested copies of these functions written inside the test).
const record = (scientific_name, subspecies) => ({ properties: { scientific_name, subspecies } })
const features = [
  record('Mechanitis polymnia', 'casabranca'),
  record('Mechanitis polymnia', 'casabranca'),
  record('Mechanitis polymnia', 'veritabilis'),
  record('Mechanitis menapis', 'isthmia'),
  record('Methona confusa', 'lysimnia'),
  record('Methona confusa', 'lysimnia'),
  record('Methona confusa', 'Unknown'),
  record('Methona confusa', 'NA'),
]

function legend(hiddenItems = []) {
  const dataStore = { displayGeoJSON: { features }, colorBy: 'subspecies', colorByAttribute: 'subspecies' }
  const legendStore = { hiddenItems, effectiveGroupBy: 'species', isGrouped: true }
  return useLegendBaseData(dataStore, legendStore, false)
}

describe('legend counts and groups (useLegendBaseData)', () => {
  it('counts the records of each subspecies, leaving Unknown and NA out', () => {
    expect(legend().legendCounts.value).toEqual({ casabranca: 2, veritabilis: 1, isthmia: 1, lysimnia: 2 })
  })

  it('a hidden legend item is not counted, in the list or within its species group', () => {
    const { legendCounts, getGroupItemCount } = legend(['lysimnia'])
    expect(legendCounts.value).toEqual({ casabranca: 2, veritabilis: 1, isthmia: 1 })
    expect(getGroupItemCount('Methona confusa', 'lysimnia')).toBe(0)
    expect(getGroupItemCount('Mechanitis polymnia', 'casabranca')).toBe(2)
  })

  it('groups each subspecies under its species, without an Unknown row', () => {
    const { itemGroupMap, getGroupForItem, getGroupsForItem } = legend()
    expect(Object.fromEntries(Object.entries(itemGroupMap.value).map(([group, items]) => [group, [...items].sort()])))
      .toEqual({
        'Mechanitis polymnia': ['casabranca', 'veritabilis'],
        'Mechanitis menapis': ['isthmia'],
        'Methona confusa': ['lysimnia'],
      })
    expect(getGroupsForItem('casabranca')).toEqual(['Mechanitis polymnia'])
    expect(getGroupForItem('isthmia')).toBe('Mechanitis menapis')
    expect(getGroupForItem('Unknown')).toBeNull()
  })

  it('has no counts or groups before data is loaded', () => {
    const base = useLegendBaseData({ displayGeoJSON: null, colorByAttribute: 'subspecies' },
      { hiddenItems: [], effectiveGroupBy: 'species', isGrouped: true }, false)
    expect(base.legendCounts.value).toEqual({})
    expect(base.itemGroupMap.value).toEqual({})
  })
})
