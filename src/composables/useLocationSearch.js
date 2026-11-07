import { ref } from 'vue'
import { log } from '../utils/logger'

/** Nominatim rows to search results, keeping the first of rows with the same name (it lists some places twice). */
export function toSearchResults(rows) {
  const seen = new Set()
  const results = []
  for (const item of rows || []) {
    const name = item.display_name
    if (!name || seen.has(name)) continue
    seen.add(name)
    results.push({
      name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type,
      importance: item.importance,
      boundingbox: item.boundingbox
    })
  }
  return results
}

export function useLocationSearch(map) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const isSearching = ref(false)
  const showSearchResults = ref(false)
  // Row highlighted with the arrow keys (-1: none; Enter then takes the first row).
  const activeIndex = ref(-1)
  const searchInputRef = ref(null)
  let searchDebounceTimer = null

  const searchLocation = async (query) => {
    if (!query || query.length < 2) {
      searchResults.value = []
      return
    }

    isSearching.value = true

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        new URLSearchParams({
          q: query,
          format: 'json',
          limit: '8',
          addressdetails: '1'
        }),
        { headers: { 'Accept-Language': 'en' } }
      )

      if (response.ok) {
        const data = await response.json()
        searchResults.value = toSearchResults(data)
        activeIndex.value = -1
        showSearchResults.value = searchResults.value.length > 0
      }
    } catch (error) {
      log.map.error('Geocoding error:', error)
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }

  const onSearchInput = () => {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      searchLocation(searchQuery.value)
    }, 300)
  }

  const selectSearchResult = (result) => {
    if (!map.value) return

    showSearchResults.value = false
    searchQuery.value = ''
    activeIndex.value = -1

    if (result.boundingbox) {
      const [south, north, west, east] = result.boundingbox.map(parseFloat)
      map.value.fitBounds(
        [[west, south], [east, north]],
        { padding: 50, maxZoom: 14, duration: 1500 }
      )
    } else {
      map.value.flyTo({
        center: [result.lng, result.lat],
        zoom: 12,
        duration: 1500
      })
    }
  }

  // Arrow keys move through the results, Enter goes to the highlighted one (or the first).
  const onSearchKeydown = (event) => {
    const n = searchResults.value.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!n) return
      event.preventDefault()
      showSearchResults.value = true
      const step = event.key === 'ArrowDown' ? 1 : -1
      activeIndex.value = activeIndex.value < 0
        ? (step > 0 ? 0 : n - 1)
        : (activeIndex.value + step + n) % n
    } else if (event.key === 'Enter') {
      if (!n) return
      event.preventDefault()
      selectSearchResult(searchResults.value[Math.max(0, activeIndex.value)])
    }
  }

  const handleClickOutside = (event) => {
    if (searchInputRef.value && !searchInputRef.value.contains(event.target)) {
      showSearchResults.value = false
    }
  }

  const clearSearch = () => {
    searchQuery.value = ''
    searchResults.value = []
    showSearchResults.value = false
    activeIndex.value = -1
  }

  const cleanup = () => {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }

  return {
    searchQuery,
    searchResults,
    isSearching,
    showSearchResults,
    activeIndex,
    searchInputRef,
    onSearchInput,
    selectSearchResult,
    onSearchKeydown,
    handleClickOutside,
    clearSearch,
    cleanup
  }
}
