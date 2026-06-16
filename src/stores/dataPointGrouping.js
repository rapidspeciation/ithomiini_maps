// Scatter visualization and coordinate grouping logic
// Extracted from data.js for maintainability (~330 lines)

import { computed } from 'vue'
import { log } from '../utils/logger'
import { dedupePointsByIndividual } from '../utils/clusterStats'

/**
 * Composable for scatter/overlap visualization logic
 * @param {import('vue').Ref} filteredGeoJSON - The filtered GeoJSON ref
 * @param {import('vue').Ref} scatterOverlappingPoints - Whether scatter is enabled
 * @param {import('vue').Ref} clusteringEnabled - Whether clustering is enabled
 */
export function useScatterVisualization(filteredGeoJSON, scatterOverlappingPoints, clusteringEnabled) {

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

  /**
   * Groups all points in filteredGeoJSON by their exact coordinates
   */
  const coordinateGroups = computed(() => {
    log.perf.start('coordinateGroups')
    const groups = new Map()
    const geo = filteredGeoJSON.value
    if (!geo || !geo.features) return groups

    for (const feature of geo.features) {
      const [lng, lat] = feature.geometry.coordinates
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(feature.properties)
    }

    const multiGroups = new Map()
    for (const [key, points] of groups) {
      if (points.length >= 2) {
        multiGroups.set(key, points)
      }
    }

    log.perf.end('coordinateGroups', `${multiGroups.size} groups with overlaps`)
    return multiGroups
  })

  /**
   * Calculate scattered positions using Fibonacci spiral
   */
  const calculateScatteredPosition = (originalLat, originalLng, index, totalPoints, radiusKm = 2) => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const angle = index * goldenAngle
    const radiusFraction = Math.sqrt(index / totalPoints)
    const pointRadius = radiusFraction * radiusKm

    const kmPerDegreeLat = 111.32
    const kmPerDegreeLng = 111.32 * Math.cos(originalLat * Math.PI / 180)

    const offsetLat = (pointRadius / kmPerDegreeLat) * Math.cos(angle)
    const offsetLng = (pointRadius / kmPerDegreeLng) * Math.sin(angle)

    return {
      lat: originalLat + offsetLat,
      lng: originalLng + offsetLng
    }
  }

  /**
   * Group points by subspecies at each coordinate location
   */
  const subspeciesGroups = computed(() => {
    const groups = new Map()
    const geo = filteredGeoJSON.value
    if (!geo || !geo.features) return groups

    for (const feature of geo.features) {
      const [lng, lat] = feature.geometry.coordinates
      const coordKey = `${lat.toFixed(4)},${lng.toFixed(4)}`
      const props = feature.properties
      const species = props.scientific_name || 'Unknown'
      const subspecies = props.subspecies || 'No subspecies'
      const subspeciesKey = `${species}|${subspecies}`

      if (!groups.has(coordKey)) {
        groups.set(coordKey, new Map())
      }

      const locationGroup = groups.get(coordKey)

      if (!locationGroup.has(subspeciesKey)) {
        locationGroup.set(subspeciesKey, {
          representative: props,
          allPoints: [props],
          species,
          subspecies
        })
      } else {
        const subspGroup = locationGroup.get(subspeciesKey)
        subspGroup.allPoints.push(props)
        if (props.image_url && !subspGroup.representative.image_url) {
          subspGroup.representative = props
        }
      }
    }

    return groups
  })

  /**
   * Scattered positions - one per subspecies at each location
   */
  const scatteredPositions = computed(() => {
    const positions = new Map()
    if (!scatterOverlappingPoints.value) return positions

    for (const [coordKey, subspeciesMap] of subspeciesGroups.value) {
      const [lat, lng] = coordKey.split(',').map(Number)
      const subspeciesList = Array.from(subspeciesMap.entries())
      const totalSubspecies = subspeciesList.length

      if (totalSubspecies < 2) continue

      subspeciesList.forEach(([subspeciesKey, data], index) => {
        const scattered = calculateScatteredPosition(lat, lng, index, totalSubspecies)
        const representative = data.representative

        positions.set(representative.id, {
          scatteredLat: scattered.lat,
          scatteredLng: scattered.lng,
          originalLat: lat,
          originalLng: lng,
          subspeciesKey,
          species: data.species,
          subspecies: data.subspecies,
          isRepresentative: true
        })

        data.allPoints.forEach(point => {
          if (point.id !== representative.id) {
            positions.set(point.id, {
              scatteredLat: scattered.lat,
              scatteredLng: scattered.lng,
              originalLat: lat,
              originalLng: lng,
              subspeciesKey,
              species: data.species,
              subspecies: data.subspecies,
              isRepresentative: false,
              representativeId: representative.id
            })
          }
        })
      })
    }

    return positions
  })

  /**
   * The GeoJSON to display - handles scatter, clustering, and aggregation
   */
  const displayGeoJSON = computed(() => {
    log.perf.start('displayGeoJSON')
    const geo = filteredGeoJSON.value
    if (!geo) return geo

    // Scatter mode takes priority
    if (scatterOverlappingPoints.value) {
      const positions = scatteredPositions.value
      if (positions.size === 0) return geo

      const features = []

      for (const feature of geo.features) {
        const pos = positions.get(feature.properties.id)

        if (pos) {
          if (pos.isRepresentative) {
            features.push({
              ...feature,
              geometry: {
                ...feature.geometry,
                coordinates: [pos.scatteredLng, pos.scatteredLat]
              },
              properties: {
                ...feature.properties,
                _originalLat: pos.originalLat,
                _originalLng: pos.originalLng,
                _isScattered: true,
                _subspeciesKey: pos.subspeciesKey,
                _scatteredSpecies: pos.species,
                _scatteredSubspecies: pos.subspecies
              }
            })
          }
          // Non-representative points are hidden
        } else {
          features.push(feature)
        }
      }

      return {
        type: 'FeatureCollection',
        features
      }
    }

    // Clustering mode - pass all points to MapLibre
    log.perf.end('displayGeoJSON', `${geo.features.length} features`)
    return geo
  })

  /**
   * Data needed to draw scatter visualization circles
   */
  const scatterVisualizationData = computed(() => {
    if (!scatterOverlappingPoints.value) {
      return { circles: [] }
    }

    const circles = []

    for (const [coordKey, subspeciesMap] of subspeciesGroups.value) {
      if (subspeciesMap.size < 2) continue
      const [lat, lng] = coordKey.split(',').map(Number)
      circles.push({
        center: [lng, lat],
        radiusKm: 2
      })
    }

    return { circles }
  })

  return {
    getPointsAtCoordinates,
    groupPointsBySpecies,
    getSpeciesWithPhotos,
    coordinateGroups,
    scatteredPositions,
    displayGeoJSON,
    scatterVisualizationData
  }
}
