/**
 * Which country a coordinate lies in, from the outlines in
 * public/data/country_boundaries.json (scripts/build_country_boundaries.mjs).
 * Host-plant occurrence records carry no country, so the country filter
 * places them with these outlines.
 */

// A record this close (degrees, about 5 km) to a country's coast or border,
// and in no country, is counted in it: 1:50m outlines cut off coastal records.
export const COAST_TOLERANCE_DEG = 0.05

function inRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(lng, lat, polygon) {
  if (!inRing(lng, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) if (inRing(lng, lat, polygon[i])) return false
  return true
}

const inBox = (lng, lat, [w, s, e, n], pad = 0) => lng >= w - pad && lng <= e + pad && lat >= s - pad && lat <= n + pad

/** Squared distance (degrees, longitude scaled by latitude) from a point to a ring's edges. */
function ringDistance2(lng, lat, ring) {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * k
    const ay = ring[j][1]
    const bx = ring[i][0] * k
    const by = ring[i][1]
    const px = lng * k
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / len)) : 0
    const ex = ax + t * dx - px
    const ey = ay + t * dy - lat
    best = Math.min(best, ex * ex + ey * ey)
  }
  return best
}

/** The country a point lies in, the nearest one within COAST_TOLERANCE_DEG when it lies in none, else null. */
export function countryOfPoint(lng, lat, boundaries) {
  const countries = boundaries?.countries || []
  for (const country of countries) {
    if (!inBox(lng, lat, country.bbox)) continue
    if (country.polygons.some(polygon => inPolygon(lng, lat, polygon))) return country.name
  }
  let nearest = null
  let best = COAST_TOLERANCE_DEG ** 2
  for (const country of countries) {
    if (!inBox(lng, lat, country.bbox, COAST_TOLERANCE_DEG)) continue
    for (const polygon of country.polygons) {
      const d = ringDistance2(lng, lat, polygon[0])
      if (d <= best) {
        best = d
        nearest = country.name
      }
    }
  }
  return nearest
}

const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()

/**
 * A test of [lng, lat] for the countries and box asked, or null when nothing
 * limits the region. `bbox`: [west, south, east, north] or { sw: {lng, lat}, ne: {lng, lat} }.
 * Countries the outlines do not know are listed in `unknownCountries`.
 */
export function makeRegionTest({ countries = [], bbox = null } = {}, boundaries = null) {
  const box = Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)
    ? bbox
    : bbox?.sw && bbox?.ne ? [bbox.sw.lng, bbox.sw.lat, bbox.ne.lng, bbox.ne.lat] : null
  const asked = new Set((countries || []).map(fold).filter(Boolean))
  if (!box && asked.size === 0) return null
  const known = new Set((boundaries?.countries || []).map(country => fold(country.name)))
  const outlines = (boundaries?.countries || []).filter(country => asked.has(fold(country.name)))
  const test = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false
    if (box && !inBox(lng, lat, box)) return false
    if (asked.size === 0) return true
    // Cheap reject: outside every asked country's box (with the coast margin).
    if (!outlines.some(country => inBox(lng, lat, country.bbox, COAST_TOLERANCE_DEG))) return false
    return asked.has(fold(countryOfPoint(lng, lat, boundaries)))
  }
  test.unknownCountries = [...asked].filter(name => !known.has(name))
  return test
}
