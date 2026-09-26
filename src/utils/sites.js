import { countUniqueIndividuals } from './clusterStats'
import { individualsPosition, OTHER_COLOR, rampColor } from './colorPlan'

/** Records within ~11 m share a marker; this matches popup coordinate lookup. */
export const siteKeyFor = ([lng, lat]) => `${lat.toFixed(4)},${lng.toFixed(4)}`

/** Group occurrence features by their recorded coordinate. */
export function groupRecordsBySite(features) {
  const sites = new Map()
  for (const feature of features || []) {
    const coordinates = feature.geometry?.coordinates
    if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) continue
    const key = siteKeyFor(coordinates)
    const site = sites.get(key)
    if (site) site.records.push(feature)
    else sites.set(key, { key, coordinates, records: [feature] })
  }
  return sites
}

/**
 * Radius grows gently with the logarithm of individuals (1 → 1×, 10 → 1.35×,
 * 100 → 1.7×, capped at 1.8×). Colour also encodes individuals, so size only
 * needs to make busy sites stand out without merging neighbouring markers.
 */
export function markerSizeFactor(individuals) {
  return Math.min(1.8, 1 + 0.35 * Math.log10(Math.max(1, individuals)))
}

function mostCommon(values) {
  const counts = new Map()
  for (const value of values) {
    if (!value || value === 'Unknown') continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null
}

/**
 * Summarise every site for display. In category mode each site lists colour
 * segments in legend order ("Other" last); in individuals mode its fill comes
 * from the ramp position relative to the busiest site.
 */
export function summarizeSites(siteIndex, { plan, ramp, sizeByIndividuals = true }) {
  const order = new Map((plan?.groups || []).map((group, index) => [group.key, index]))
  const summaries = []
  let maximum = 1
  for (const site of siteIndex.values()) {
    const properties = site.records.map(record => record.properties)
    const individuals = countUniqueIndividuals(properties)
    maximum = Math.max(maximum, individuals)
    let segments = []
    if (plan?.mode === 'categories') {
      const byGroup = new Map()
      for (const record of properties) {
        const group = plan.groupForRecord(record)
        const entry = byGroup.get(group.key)
        if (entry) entry.count++
        else byGroup.set(group.key, { key: group.key, label: group.label, color: group.color, count: 1 })
      }
      segments = [...byGroup.values()].sort((a, b) =>
        (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity))
      for (const segment of segments) segment.fraction = segment.count / properties.length
    }
    summaries.push({
      key: site.key,
      coordinates: site.coordinates,
      records: site.records,
      individuals,
      recordCount: properties.length,
      speciesCount: new Set(properties.map(record => record.scientific_name).filter(Boolean)).size,
      locality: mostCommon(properties.map(record => record.collection_location)),
      country: mostCommon(properties.map(record => record.country)),
      segments,
      sizeFactor: sizeByIndividuals ? markerSizeFactor(individuals) : 1,
    })
  }
  for (const summary of summaries) {
    summary.fill = plan?.mode === 'categories'
      ? (summary.segments.length === 1 ? summary.segments[0].color : null)
      : rampColor(ramp, individualsPosition(summary.individuals, maximum))
    if (plan?.mode === 'categories' && !summary.segments.length) summary.fill = OTHER_COLOR
  }
  return { sites: summaries, maxIndividuals: maximum }
}

/** Pie images are cached by quantized composition so similar sites share one image. */
export function pieSignature(segments, resolution = 24) {
  return segments.map(segment => `${segment.color}:${Math.max(1, Math.round(segment.fraction * resolution))}`).join('|')
}

/**
 * Draw a filled pie with an outer border into ImageData. The icon is 32 CSS
 * pixels square at pixelRatio 2, so icon-size 1 renders a 16 px radius.
 */
export function drawSitePie(segments, { stroke = '#ffffff', strokeWidth = 2, fillOpacity = 1, strokeOpacity = 1 } = {}) {
  const pixelRatio = 2
  const size = 32 * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  const lineWidth = Math.max(0, strokeWidth) * pixelRatio
  const radius = center - lineWidth / 2 - 1
  let angle = -Math.PI / 2
  context.globalAlpha = fillOpacity
  for (const segment of segments) {
    const next = angle + Math.PI * 2 * segment.fraction
    context.beginPath()
    context.moveTo(center, center)
    context.arc(center, center, radius, angle, next)
    context.closePath()
    context.fillStyle = segment.color
    context.fill()
    angle = next
  }
  if (lineWidth > 0) {
    context.globalAlpha = strokeOpacity
    context.beginPath()
    context.arc(center, center, radius, 0, Math.PI * 2)
    context.strokeStyle = stroke
    context.lineWidth = lineWidth
    context.stroke()
  }
  return context.getImageData(0, 0, size, size)
}
