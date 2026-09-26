import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLegendStore } from '../legend'
import { usePersistenceStore } from '../persistence'

describe('useLegendStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts with the legend visible', () => {
    const store = useLegendStore()

    expect(store.showLegend).toBe(true)
  })

  it('supports custom color add/remove', () => {
    const store = useLegendStore()

    store.setCustomColor('Tiger', '#ff6600')
    expect(store.customColors.Tiger).toBe('#ff6600')

    store.setCustomColor('Tiger', null)
    expect(store.customColors.Tiger).toBeUndefined()
  })

  it('toggles hidden items in hiddenItems', () => {
    const store = useLegendStore()

    store.toggleItemVisibility('Tiger')
    expect(store.hiddenItems).toContain('Tiger')

    store.toggleItemVisibility('Tiger')
    expect(store.hiddenItems).not.toContain('Tiger')
  })

  it('uses expected defaults for grouping and sorting', () => {
    const store = useLegendStore()

    expect(store.groupingSettings.groupBy).toBe('species')
    // Most common groups first: the same order colours are assigned in.
    expect(store.sortBy).toBe('abundance')
    expect(store.sortOrder).toBe('desc')
    expect(store.colorOverride).toBeNull()
  })

  it('persists per-species collapse without hiding legend items', () => {
    usePersistenceStore().setEnabled(true)
    const store = useLegendStore()
    store.setSpeciesCollapsed('Mechanitis polymnia', true)
    store.setSpeciesCollapsed('Mechanitis polymnia', true)
    store.setSpeciesCollapsed('Mechanitis lysimnia', true)

    expect(store.collapsedSpecies).toEqual(['Mechanitis polymnia', 'Mechanitis lysimnia'])
    expect(store.hiddenItems).toEqual([])
    expect(JSON.parse(localStorage.getItem('legend-collapsed-species'))).toEqual(store.collapsedSpecies)

    store.setSpeciesCollapsed('Mechanitis polymnia', false)
    expect(store.isSpeciesCollapsed('Mechanitis polymnia')).toBe(false)
    expect(store.isSpeciesCollapsed('Mechanitis lysimnia')).toBe(true)
  })
})
