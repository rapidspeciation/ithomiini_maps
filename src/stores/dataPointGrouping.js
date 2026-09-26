// Coordinate grouping helpers for popups

import { computed } from 'vue'
import { dedupePointsByIndividual } from '../utils/clusterStats'

/**
 * @param {import('vue').Ref} filteredGeoJSON - The filtered GeoJSON ref
 */
export function usePointGrouping(filteredGeoJSON) {

  /**
   * Get all points at the same coordinates (within tolerance)
   */
  const getPointsAtCoordinates = (lat, lng, tolerance = 0.0001) => {
    const geo = filteredGeoJSON.value
    if (!geo || !geo.features) return []

    return geo.features
      .filter(f => {
        const [fLng, fLat] = f.geometry.coordinates
        return Math.abs(fLat - lat) < tolerance && Math.abs(fLng - lng) < tolerance
      })
      .map(f => f.properties)
  }

  /**
   * Group points by species, then by subspecies
   */
  const groupPointsBySpecies = (points) => {
    const groups = {}

    for (const point of points) {
      const species = point.scientific_name || 'Unknown'
      const subspecies = point.subspecies || 'No subspecies'

      if (!groups[species]) {
        groups[species] = { count: 0, subspecies: {} }
      }

      groups[species].count++

      if (!groups[species].subspecies[subspecies]) {
        groups[species].subspecies[subspecies] = { count: 0, individuals: [] }
      }

      groups[species].subspecies[subspecies].count++
      groups[species].subspecies[subspecies].individuals.push(point)
    }

    for (const speciesGroup of Object.values(groups)) {
      let speciesIndividualCount = 0
      for (const subspGroup of Object.values(speciesGroup.subspecies)) {
        subspGroup.recordCount = subspGroup.count
        subspGroup.individuals = dedupePointsByIndividual(subspGroup.individuals)
        subspGroup.count = subspGroup.individuals.length
        speciesIndividualCount += subspGroup.count
      }
      speciesGroup.recordCount = speciesGroup.count
      speciesGroup.count = speciesIndividualCount
    }

    return groups
  }

  /**
   * Get species list prioritized by those with photos
   */
  const getSpeciesWithPhotos = (points) => {
    const speciesMap = {}

    for (const point of points) {
      const species = point.scientific_name || 'Unknown'
      if (!speciesMap[species]) {
        speciesMap[species] = { species, hasPhoto: false, photoUrl: null, records: [] }
      }
      speciesMap[species].records.push(point)
      if (point.image_url && !speciesMap[species].hasPhoto) {
        speciesMap[species].hasPhoto = true
        speciesMap[species].photoUrl = point.image_url
      }
    }

    return Object.values(speciesMap).map(item => ({
      species: item.species,
      hasPhoto: item.hasPhoto,
      photoUrl: item.photoUrl,
      count: dedupePointsByIndividual(item.records).length,
      recordCount: item.records.length
    })).sort((a, b) => {
      if (a.hasPhoto && !b.hasPhoto) return -1
      if (!a.hasPhoto && b.hasPhoto) return 1
      return b.count - a.count
    })
  }

  // Occurrences render as one marker per site (see utils/sites.js), so the
  // displayed data is the filtered data.
  const displayGeoJSON = computed(() => filteredGeoJSON.value)

  return {
    getPointsAtCoordinates,
    groupPointsBySpecies,
    getSpeciesWithPhotos,
    displayGeoJSON,
  }
}
