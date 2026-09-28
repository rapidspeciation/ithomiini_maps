import { countUniqueIndividuals } from './clusterStats'
import { OTHER_COLOR } from './colorPlan'

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

export const SITE_SIZE_CAP = 1.8
/** Merged markers stand for several sites, so they may grow a little larger. */
export const MERGED_SIZE_CAP = 2.2

/**
 * Radius grows gently with the logarithm of individuals (1 → 1×, 10 → 1.35×,
 * 100 → 1.7×, capped at 1.8×, or 2.2× for merged markers), so busy sites
 * stand out; sites that would overlap are merged rather than enlarged.
 */
export function markerSizeFactor(individuals, cap = SITE_SIZE_CAP) {
  return Math.min(cap, 1 + 0.35 * Math.log10(Math.max(1, individuals)))
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
 * Summarise every site for display. Each site lists colour segments in legend
 * order ("Other" last); a site with one segment is filled with its colour.
 */
export function summarizeSites(siteIndex, { plan, sizeByIndividuals = true }) {
  const order = new Map((plan?.groups || []).map((group, index) => [group.key, index]))
  const summaries = []
  for (const site of siteIndex.values()) {
    const properties = site.records.map(record => record.properties)
    const individuals = countUniqueIndividuals(properties)
    let segments = []
    if (plan) {
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
    summary.fill = summary.segments.length === 1 ? summary.segments[0].color
      : summary.segments.length ? null : OTHER_COLOR
  }
  return { sites: summaries }
}

/**
 * Keep a pie readable at marker size: coloured slices under `minFraction`, and
 * any beyond the `maxColored` largest, join the grey "Other" slice (last).
 */
export function foldMinorSegments(segments, { minFraction = 0.1, maxColored = 4 } = {}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  if (!total) return segments
  const kept = new Set(segments
    .filter(segment => segment.color !== OTHER_COLOR && segment.count / total >= minFraction)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColored))
  const folded = segments.filter(segment => kept.has(segment))
  const otherCount = total - folded.reduce((sum, segment) => sum + segment.count, 0)
  if (otherCount > 0) folded.push({ key: 'other', label: 'Other', color: OTHER_COLOR, count: otherCount })
  return folded.map(segment => ({ ...segment, fraction: segment.count / total }))
}

/**
 * One marker for several nearby sites, as drawn merged in point view: summed
 * individuals and colour segments (in `order`, "Other" last).
 */
export function mergeSiteSummaries(members, coordinates, { order = new Map(), sizeByIndividuals = true } = {}) {
  const counts = new Map()
  for (const site of members) {
    for (const segment of site.segments) {
      const entry = counts.get(segment.key)
      if (entry) entry.count += segment.count
      else counts.set(segment.key, { key: segment.key, label: segment.label, color: segment.color, count: segment.count })
    }
  }
  const recordCount = members.reduce((sum, site) => sum + site.recordCount, 0)
  const segments = [...counts.values()]
    .sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity))
    .map(segment => ({ ...segment, fraction: segment.count / recordCount }))
  const busiest = [...members].sort((a, b) => b.individuals - a.individuals)[0]
  const records = members.flatMap(site => site.records)
  const individuals = members.reduce((sum, site) => sum + site.individuals, 0)
  return {
    key: `merged:${members.map(site => site.key).sort().join('|')}`,
    coordinates,
    records,
    individuals,
    recordCount,
    speciesCount: new Set(records.map(record => record.properties.scientific_name).filter(Boolean)).size,
    locality: busiest.locality,
    country: busiest.country,
    segments,
    siteCount: members.length,
    sizeFactor: sizeByIndividuals ? markerSizeFactor(individuals, MERGED_SIZE_CAP) : 1,
    fill: segments.length === 1 ? segments[0].color : segments.length ? null : OTHER_COLOR,
  }
}

/** Pie images are cached by quantized composition so similar sites share one image. */
export function pieSignature(segments, resolution = 24) {
  return segments.map(segment => `${segment.color}:${Math.max(1, Math.round(segment.fraction * resolution))}`).join('|')
}

/**
 * Draw a filled pie with an outer border into ImageData. The icon is 32 CSS
 * pixels square at pixelRatio 2, so icon-size 1 renders a 16 px radius.
 * `merged` markers (several nearby sites) get a second, inner border.
 */
export function drawSitePie(segments, { stroke = '#ffffff', strokeWidth = 2, fillOpacity = 1, strokeOpacity = 1, merged = false } = {}) {
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
  if (merged) {
    const innerWidth = Math.max(1, strokeWidth * 0.6) * pixelRatio
    context.globalAlpha = strokeOpacity
    context.beginPath()
    context.arc(center, center, radius - lineWidth / 2 - innerWidth * 1.8, 0, Math.PI * 2)
    context.strokeStyle = stroke
    context.lineWidth = innerWidth
    context.stroke()
  }
  return context.getImageData(0, 0, size, size)
}
