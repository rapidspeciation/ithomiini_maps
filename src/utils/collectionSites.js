// A fixed geohash cell keeps site identity independent of the map zoom and filters.
// Precision 5 is roughly 5 km at the equator. A locality can span several cells;
// nearby records on opposite cell edges can also remain separate sites.
const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz'
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

function geohash(latitude, longitude) {
  let lat = [-90, 90]
  let lng = [-180, 180]
  let hash = ''
  let bits = 0
  let value = 0
  while (hash.length < 5) {
    const range = bits % 2 === 0 ? lng : lat
    const coordinate = bits % 2 === 0 ? longitude : latitude
    const midpoint = (range[0] + range[1]) / 2
    value = (value << 1) | Number(coordinate >= midpoint)
    range[coordinate >= midpoint ? 0 : 1] = midpoint
    bits++
    if (bits % 5 === 0) {
      hash += GEOHASH_ALPHABET[value]
      value = 0
    }
  }
  return hash
}

function geohashCenter(hash) {
  const lat = [-90, 90]
  const lng = [-180, 180]
  let bit = 0
  for (const character of hash) {
    const value = GEOHASH_ALPHABET.indexOf(character)
    for (let mask = 16; mask > 0; mask >>= 1) {
      const range = bit++ % 2 === 0 ? lng : lat
      range[value & mask ? 0 : 1] = (range[0] + range[1]) / 2
    }
  }
  return [(lng[0] + lng[1]) / 2, (lat[0] + lat[1]) / 2]
}

/** Return the recorded point, ignoring any geometry shifted for display. */
export function recordedCoordinates(feature) {
  const record = feature?.properties ?? feature
  if (!record) return null
  const coordinates = feature?.geometry?.coordinates
  const hasCoordinate = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
  const coordinatePairs = [
    [record._originalLng, record._originalLat],
    [record.lng, record.lat],
    [coordinates?.[0], coordinates?.[1]],
  ]
  const pair = coordinatePairs.find(([lng, lat]) =>
    hasCoordinate(lng) && hasCoordinate(lat) &&
    Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) &&
    Math.abs(Number(lng)) <= 180 && Math.abs(Number(lat)) <= 90
  )
  if (!pair) return null
  return pair.map(Number)
}

/** Unique recorded locations, in source order, without display offsets. */
export function recordedPointsForFeatures(features) {
  const points = new Map()
  for (const feature of features) {
    const point = recordedCoordinates(feature)
    if (point) points.set(JSON.stringify(point), point)
  }
  return [...points.values()]
}

function siteParts(feature) {
  const record = feature?.properties ?? feature
  if (!record) return null
  const pair = recordedCoordinates(feature)
  if (!pair) return null
  const [longitude, latitude] = pair
  const rawName = typeof record.collection_location === 'string' ? record.collection_location.trim().replace(/\s+/g, ' ') : ''
  const named = !!rawName && !/^(unknown|n\/a|na|null|none|-)$/i.test(rawName)
  const name = named ? rawName : null
  const country = typeof record.country === 'string' ? record.country.trim() : ''
  const cell = geohash(latitude, longitude)
  // Include country as a guard for localities or cells that cross borders.
  const id = `site:${encodeURIComponent(country.normalize('NFC').toLowerCase())}:${encodeURIComponent(name?.normalize('NFC').toLowerCase() ?? '')}:${cell}`
  return { record, longitude, latitude, name, named, country, cell, id }
}

export function siteKeyForFeature(feature) {
  return siteParts(feature)?.id ?? null
}

// Only unambiguous day-level observation dates are used for recency. Two-digit
// years 00–25 are interpreted as 2000–2025 for the recent Sanger observations;
// 26–99 are ambiguous with historical dates and remain undated.
export function collectionDate(record) {
  const value = record?.observation_date || record?.date
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(raw)
  const short = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(raw)
  let year, month, day
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3])
    if ((iso[4] && Number(iso[4]) > 23) || (iso[5] && Number(iso[5]) > 59) ||
        (iso[6] && Number(iso[6]) > 59) || (iso[7] && Number(iso[7]) > 14) ||
        (iso[8] && Number(iso[8]) > 59)) return null
  } else if (short) {
    const shortYear = Number(short[3])
    if (shortYear > 25) return null
    year = 2000 + shortYear
    month = MONTHS[short[2].toLowerCase()]
    day = Number(short[1])
  } else return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  const dayString = date.toISOString().slice(0, 10)
  return dayString <= new Date().toISOString().slice(0, 10) ? dayString : null
}

/** Group a GeoJSON FeatureCollection or flat records into stable locality cells. */
export function groupCollectionSites(input, { minRecords = 1 } = {}) {
  const features = Array.isArray(input) ? input : input?.features ?? []
  const groups = new Map()
  for (const feature of features) {
    const part = siteParts(feature)
    if (!part) continue
    let group = groups.get(part.id)
    if (!group) {
      const center = geohashCenter(part.cell)
      group = {
        id: part.id,
        name: part.name || `Unnamed area near ${center[1].toFixed(2)}, ${center[0].toFixed(2)}`,
        named: part.named,
        country: part.country,
        cell: part.cell,
        latitude: 0,
        longitude: 0,
        coordinates: [0, 0],
        recordCount: 0,
        datedRecordCount: 0,
        earliestDate: null,
        latestDate: null,
        taxonCount: 0,
        taxonCounts: [],
        subspeciesCounts: [],
        featureIds: [],
        recordedPoints: [],
        _recordedPoints: new Set(),
        _taxa: new Map(),
        _subspecies: new Map(),
      }
      groups.set(part.id, group)
    }
    group.recordCount++
    group.latitude += part.latitude
    group.longitude += part.longitude
    const recordedPoint = [part.longitude, part.latitude]
    const pointKey = JSON.stringify(recordedPoint)
    if (!group._recordedPoints.has(pointKey)) {
      group._recordedPoints.add(pointKey)
      group.recordedPoints.push(recordedPoint)
    }
    if (part.record.id != null) group.featureIds.push(String(part.record.id))
    const taxon = typeof part.record.scientific_name === 'string' ? part.record.scientific_name.trim() : ''
    if (taxon && !/^unknown$/i.test(taxon)) {
      group._taxa.set(taxon, (group._taxa.get(taxon) || 0) + 1)
      const subspecies = typeof part.record.subspecies === 'string' ? part.record.subspecies.trim() : ''
      if (subspecies && subspecies !== taxon && !/^(unknown|n\/a|na)$/i.test(subspecies)) {
        const key = `${taxon}\0${subspecies}`
        group._subspecies.set(key, (group._subspecies.get(key) || 0) + 1)
      }
    }
    const date = collectionDate(part.record)
    if (date) {
      group.datedRecordCount++
      if (!group.earliestDate || date < group.earliestDate) group.earliestDate = date
      if (!group.latestDate || date > group.latestDate) group.latestDate = date
    }
  }
  const minimum = Number.isFinite(Number(minRecords)) ? Math.max(1, Math.floor(Number(minRecords))) : 1
  return [...groups.values()].filter(site => site.recordCount >= minimum).map(site => {
    site.latitude /= site.recordCount
    site.longitude /= site.recordCount
    site.coordinates = [site.longitude, site.latitude]
    site.taxonCounts = [...site._taxa].map(([taxon, count]) => ({ taxon, count })).sort((a, b) => b.count - a.count || a.taxon.localeCompare(b.taxon))
    site.taxonCount = site.taxonCounts.length
    site.subspeciesCounts = [...site._subspecies].map(([key, count]) => {
      const [taxon, subspecies] = key.split('\0')
      return { taxon, subspecies, count }
    })
    delete site._taxa
    delete site._subspecies
    delete site._recordedPoints
    return site
  }).sort((a, b) => b.recordCount - a.recordCount || a.id.localeCompare(b.id))
}
