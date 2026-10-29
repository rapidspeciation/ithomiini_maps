#!/usr/bin/env node
// Country outlines of the Americas for the host-plant layer's country filter.
// Plant occurrence records carry coordinates but no country, so the map (and the
// lab app's assistant) place each record in a country with these outlines.
//
// Input: Natural Earth 1:50m admin 0 countries (public domain), e.g.
//   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
// Usage: node scripts/build_country_boundaries.mjs <ne_50m_admin_0_countries.geojson> public/data/country_boundaries.json
//
// Names follow the butterfly records' `country` spelling, so the filter's
// values work for both layers. French Guiana is France's South American part.

import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: node scripts/build_country_boundaries.mjs <ne_50m_admin_0_countries.geojson> <output.json>')
  process.exit(1)
}

const RENAME = { 'United States of America': 'United States', 'The Bahamas': 'Bahamas' }
const LEFT_OUT = new Set(['Canada', 'Greenland'])
const DIGITS = 3

const round = value => Number(value.toFixed(DIGITS))
const ringOf = ring => {
  const out = []
  for (const [lng, lat] of ring) {
    const point = [round(lng), round(lat)]
    const last = out[out.length - 1]
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point)
  }
  return out.length >= 4 ? out : null
}
const polygonsOf = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
const bboxOf = polygons => {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0]) {
      w = Math.min(w, lng); e = Math.max(e, lng)
      s = Math.min(s, lat); n = Math.max(n, lat)
    }
  }
  return [w, s, e, n]
}

const source = JSON.parse(readFileSync(input, 'utf8'))
const countries = []
for (const feature of source.features) {
  const p = feature.properties
  let name = RENAME[p.ADMIN] || p.ADMIN
  let iso = p.ISO_A2_EH || p.ISO_A2
  let polygons = polygonsOf(feature.geometry)
  if (p.ADMIN === 'France') {
    // Only French Guiana: the part of France in South America.
    polygons = polygons.filter(polygon => polygon[0].every(([lng, lat]) => lng < -50 && lat > 0 && lat < 7))
    name = 'French Guiana'
    iso = 'GF'
  } else if (!['North America', 'South America'].includes(p.CONTINENT) || LEFT_OUT.has(p.ADMIN)) {
    continue
  }
  const kept = polygons
    .map(polygon => polygon.map(ringOf).filter(Boolean))
    .filter(polygon => polygon.length > 0)
  if (kept.length === 0) continue
  countries.push({ name, iso_a2: iso, bbox: bboxOf(kept), polygons: kept })
}
countries.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(output, JSON.stringify({
  metadata: {
    source: 'Natural Earth 1:50m Admin 0 countries (public domain), https://www.naturalearthdata.com/',
    generated_at: new Date().toISOString(),
    coordinate_digits: DIGITS,
    note: 'Outlines at 1:50m: a record within a few km of a border or coast can fall in the neighbouring country or in none.',
  },
  countries,
}))
console.log(`${countries.length} countries -> ${output}`)
