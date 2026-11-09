// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { toSearchResults, useLocationSearch } from '../useLocationSearch'

const rows = [
  { display_name: 'Tena, Napo, Ecuador', lat: '-0.99', lon: '-77.81', type: 'town', boundingbox: ['-1.0', '-0.98', '-77.82', '-77.80'] },
  { display_name: 'Tena, Napo, Ecuador', lat: '-0.99', lon: '-77.81', type: 'administrative' },
  { display_name: 'Tena, Cundinamarca, Colombia', lat: '4.65', lon: '-74.39', type: 'village' },
]
const key = k => ({ key: k, preventDefault: vi.fn() })

describe('useLocationSearch', () => {
  it('keeps one row per place name', () => {
    expect(toSearchResults(rows).map(r => r.name)).toEqual(['Tena, Napo, Ecuador', 'Tena, Cundinamarca, Colombia'])
    expect(toSearchResults(rows)[0]).toMatchObject({ lat: -0.99, lng: -77.81 })
  })

  it('Enter goes to the first place, arrows choose another', () => {
    const map = { fitBounds: vi.fn(), flyTo: vi.fn() }
    const search = useLocationSearch(ref(map))
    search.searchResults.value = toSearchResults(rows)
    search.showSearchResults.value = true

    search.onSearchKeydown(key('Enter'))
    // Nominatim's boundingbox is [south, north, west, east]; MapLibre takes [[west, south], [east, north]].
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.fitBounds).toHaveBeenCalledWith([[-77.82, -1], [-77.8, -0.98]], expect.anything())
    expect(search.showSearchResults.value).toBe(false)

    search.searchResults.value = toSearchResults(rows)
    const down = key('ArrowDown')
    search.onSearchKeydown(down)
    search.onSearchKeydown(key('ArrowDown'))
    expect(down.preventDefault).toHaveBeenCalled()
    expect(search.activeIndex.value).toBe(1)
    search.onSearchKeydown(key('ArrowDown'))
    expect(search.activeIndex.value).toBe(0) // wraps
    search.onSearchKeydown(key('ArrowUp'))
    expect(search.activeIndex.value).toBe(1)
    search.onSearchKeydown(key('Enter'))
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-74.39, 4.65] }))
    expect(search.activeIndex.value).toBe(-1)
  })

  it('does nothing without results', () => {
    const search = useLocationSearch(ref({ fitBounds: vi.fn(), flyTo: vi.fn() }))
    const enter = key('Enter')
    search.onSearchKeydown(enter)
    expect(enter.preventDefault).not.toHaveBeenCalled()
  })
})
