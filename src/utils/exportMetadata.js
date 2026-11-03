// Export mode (?export=1) and window.ithomiiniMapsExport(): pure helpers that
// describe what the exported picture shows. See docs/field-sites.md.
import { recordedCoordinates, siteKeyForFeature } from './collectionSites'

export const EXPORT_METADATA_VERSION = 1
/** Fixed export frame (CSS px) and output: 1600 x 1200 PNG at pixel ratio about 2.1. */
export const EXPORT_FRAME = Object.freeze({ width: 760, height: 570 })
/** Camera padding (CSS px, all sides) for a bbox frame; the database worker computes the same fit. */
export const EXPORT_BBOX_PADDING = 32
export const EXPORT_BBOX_MAX_ZOOM = 12
export const COLOR_BY_VALUES = Object.freeze(['subspecies', 'species', 'genus', 'status', 'mimicry', 'source'])

/** Parameters the app reads from its link. Anything else is reported as ignored. */
const KNOWN_PARAMS = new Set([
  'family', 'tribe', 'genus', 'sp', 'ssp', 'mim', 'status', 'source', 'country', 'locality', 'sex', 'cam',
  'from', 'to', 'goat', 'goat_src', 'chr_min', 'chr_max', 'tax_combo',
  'sites', 'site_labels', 'site_min', 'site_compare', 'site_shortlist', 'site_hidden',
  'hp_bf', 'hp_taxa', 'hp_level', 'hp_evidence', 'hp_conf', 'hp_opacity',
  'viz', 'cluster_style', 'range_method', 'range_group', 'range_buffer', 'range_min', 'range_opacity', 'range_hex',
  'legend_closed', 'view', 'map_view', 'style', 'color_by', 'bbox', 'export',
])

/** `bbox=w,s,e,n` in degrees; null unless finite, ordered and inside Web Mercator limits. */
export function parseBbox(value) {
  if (typeof value !== 'string' || !value) return null
  const parts = value.split(',')
  if (parts.length !== 4 || parts.some(part => part.trim() === '')) return null
  const [w, s, e, n] = parts.map(Number)
  if (![w, s, e, n].every(Number.isFinite)) return null
  if (w < -180 || e > 180 || s < -85 || n > 85 || w >= e || s >= n) return null
  return [w, s, e, n]
}

/** The link's `style` and `color_by`, when they name a basemap or colour level the app has. */
export function parseStyleParam(value, styleKeys) {
  return typeof value === 'string' && styleKeys.includes(value) ? value : null
}
export function parseColorByParam(value) {
  return typeof value === 'string' && COLOR_BY_VALUES.includes(value) ? value : null
}

/**
 * What the app honoured from its link. Unknown names, repeated names (after the
 * first), values of `style`, `color_by`, `bbox`, `export` or `sex` it cannot use, and
 * `map_view` next to a usable `bbox`, are ignored.
 */
export function describeURLParams(search, { styleKeys = [] } = {}) {
  const params = new URLSearchParams(search)
  const applied = {}
  const ignored = []
  const valid = {
    style: value => parseStyleParam(value, styleKeys) !== null,
    color_by: value => parseColorByParam(value) !== null,
    bbox: value => parseBbox(value) !== null,
    export: value => value === '1',
    sex: value => ['male', 'female', 'all'].includes(value),
  }
  const ignore = name => { if (!ignored.includes(name)) ignored.push(name) }
  for (const [name, value] of params) {
    // The app reads the first value of a name; a repeated one is not used.
    if (!KNOWN_PARAMS.has(name) || (valid[name] && !valid[name](value)) || name in applied) {
      ignore(name)
      continue
    }
    applied[name] = name === 'bbox' ? parseBbox(value) : value
  }
  // A usable bbox frames the map; map_view is then not used.
  if (applied.bbox && 'map_view' in applied) {
    delete applied.map_view
    ignore('map_view')
  }
  return { applied, ignored }
}

function listText(values, max = 2) {
  if (values.length <= max) return values.join(', ')
  return `${values.slice(0, max).join(', ')} +${values.length - max}`
}

/** Title strip from the active filters only: taxon · sex · country. No free text. */
export function exportTitle(filters = {}) {
  const taxa = filters.subspecies?.length ? filters.subspecies
    : filters.species?.length ? filters.species
      : filters.genus?.length ? filters.genus : []
  const parts = [taxa.length ? listText(taxa) : 'All records']
  if (filters.sex === 'female') parts.push('females')
  else if (filters.sex === 'male') parts.push('males')
  if (filters.country?.length) parts.push(listText(filters.country))
  return parts.join(' · ')
}

/**
 * Year of a record's observation_date, by the same rule as the assistant's map tools
 * (database repo server/maps-tools.mjs yearOf), so both sides compare equal: a
 * 4-digit 18xx-20xx anywhere; else `18-Jan-22` or `12/03/15` as 20YY when YY is not
 * after the current year, otherwise 19YY. The raw value is returned as `date` too.
 */
export function recordYear(record, today = new Date()) {
  const raw = record?.observation_date == null ? '' : String(record.observation_date).trim()
  const four = /(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/.exec(raw)
  if (four) return Number(four[1])
  const two = /^\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ](\d{2})$/.exec(raw) ?? /^\d{1,2}\/\d{1,2}\/(\d{2})$/.exec(raw)
  if (!two) return null
  const yy = Number(two[1])
  return yy <= today.getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy
}

export const recordKey = record => `${record?.source ?? ''}|${record?.id ?? ''}`

/**
 * One row per record drawn, with the fields as the map has them (no workbook values).
 * With `geometry` ({ project, frame, overlays, markerOf }): `x`, `y` are the recorded
 * lng/lat (the same `lng`, `lat`, never a display offset) projected to CSS px of the
 * map canvas, and `in_picture` is true only when that point is inside the frame,
 * outside every overlay, and the marker drawn for the record is not occluded.
 */
export function exportRecords(features, geometry = null) {
  return (features || []).map(feature => {
    const record = feature.properties ?? feature
    const [lng, lat] = recordedCoordinates(feature) ?? [null, null]
    const row = {
      source: record.source ?? null,
      id: record.id == null ? null : String(record.id),
      sex: record.sex ?? null,
      country: record.country ?? null,
      year: recordYear(record),
      date: record.observation_date ?? null,
      subspecies: record.subspecies ?? null,
      lng, lat,
    }
    if (geometry) {
      const point = lng == null ? null : geometry.project([lng, lat])
      row.x = point ? round2(point.x) : null
      row.y = point ? round2(point.y) : null
      const marker = geometry.markerOf?.(recordKey(record))
      row.in_picture = Boolean(point && pointInFrame(point, geometry.frame) &&
        !geometry.overlays.some(rect => pointInRect(point, rect)) && marker && !marker.occluded)
    }
    return row
  })
}

export function unknownLegendLabel(colorBy) {
  return ['subspecies', 'species', 'genus'].includes(colorBy) ? `Unknown ${colorBy}` : 'Unknown'
}

/** Legend rows as drawn in export mode: coloured groups, "Other", and the unknown row. */
export function legendRows(plan, colorBy) {
  const rows = (plan?.colored || []).map(group => ({ label: group.label, records: group.count, unknown: false }))
  if (plan?.otherRecordCount > 0) rows.push({ label: 'Other', records: plan.otherRecordCount, unknown: false, groups: plan.otherGroupCount })
  if (plan?.missing > 0) rows.push({ label: unknownLegendLabel(colorBy), records: plan.missing, unknown: true })
  return rows
}

/** Locality sites inside one marker, by the app's site identity (locality + country + ~5 km cell). */
export function markerMembers(records) {
  const byKey = new Map()
  for (const feature of records) {
    const key = siteKeyForFeature(feature)
    if (!key) continue
    const record = feature.properties ?? feature
    let member = byKey.get(key)
    if (!member) {
      member = { key, locality: record.collection_location ?? null, record_ids: [] }
      byKey.set(key, member)
    }
    member.record_ids.push(recordKey(record))
  }
  return [...byKey.values()]
}

const sameCoordinate = (a, b) => a && b && a[0] === b[0] && a[1] === b[1]

/**
 * Drawn markers with the labels drawn for them. `markers`: [{ kind, id, lng, lat, records,
 * x, y, radius }] (records = features; x, y, radius: the drawn marker in CSS px of the canvas).
 * `labels`: placed label features from the locality layer: a cluster label names `clusterId`;
 * a site label names `anchorKey` = JSON [siteId, lng, lat]; `box` { x, y, width, height } is
 * the label's placed box. With `geometry` ({ frame, overlays }) a site is `occluded` when its
 * marker disc or one of its label boxes touches an overlay; a label is listed only when its
 * box is inside the frame and clear of every overlay (else it counts in `hidden_labels`).
 */
export function exportSites(markers, labels, viewBbox, geometry = null) {
  const sites = markers.map(marker => {
    const members = markerMembers(marker.records)
    const site = {
      marker: marker.kind,
      lng: marker.lng,
      lat: marker.lat,
      center_in_view: viewBbox ? insideBbox([marker.lng, marker.lat], viewBbox) : null,
      records: marker.records.length,
      merged_sites: members.length,
      label: null,
      labels: [],
      members,
      _marker: marker,
    }
    if (geometry) {
      const disc = { x: marker.x, y: marker.y, radius: marker.radius }
      Object.assign(site, {
        x: round2(marker.x), y: round2(marker.y), radius: round2(marker.radius),
        label_boxes: [], hidden_labels: 0,
        occluded_by: overlayKinds(geometry.overlays, rect => circleTouchesRect(disc, rect)),
      })
    }
    return site
  })
  let unmatched = 0
  for (const label of labels) {
    const props = label.properties ?? label
    let site = null
    if (props.clusterId != null && props.clusterId !== '') {
      site = sites.find(entry => entry._marker.kind !== 'site' && String(entry._marker.id) === String(props.clusterId))
    } else if (props.anchorKey) {
      let anchor = null
      try { anchor = JSON.parse(props.anchorKey) } catch { /* not an anchor label */ }
      if (Array.isArray(anchor) && anchor.length === 3) {
        const [siteId, lng, lat] = anchor
        site = sites.find(entry => entry._marker.records.some(feature =>
          siteKeyForFeature(feature) === siteId && sameCoordinate(recordedCoordinates(feature), [lng, lat])))
      }
    }
    if (!site || typeof props.label !== 'string') { unmatched++; continue }
    // The layout wraps long names; the text is the same with spaces.
    const text = props.label.replace(/\s+/g, ' ').trim()
    if (geometry) {
      const box = props.box
      const valid = box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
      const covered = valid ? overlayKinds(geometry.overlays, rect => rectsOverlap(box, rect)) : []
      if (valid) site.label_boxes.push({ x: round2(box.x), y: round2(box.y), width: round2(box.width), height: round2(box.height) })
      for (const kind of covered) if (!site.occluded_by.includes(kind)) site.occluded_by.push(kind)
      if (!valid || covered.length || !rectInFrame(box, geometry.frame)) { site.hidden_labels++; continue }
    }
    site.labels.push(text)
    site.label ??= text
  }
  for (const site of sites) {
    if (geometry) site.occluded = site.occluded_by.length > 0
    delete site._marker
  }
  return { sites, unmatchedLabels: unmatched }
}

const round2 = value => Math.round(value * 100) / 100

/** Positive-area overlap of two { x, y, width, height } boxes. */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
/** A disc { x, y, radius } touches a box (also when it only grazes the edge). */
export function circleTouchesRect({ x, y, radius }, rect) {
  const dx = x - Math.max(rect.x, Math.min(x, rect.x + rect.width))
  const dy = y - Math.max(rect.y, Math.min(y, rect.y + rect.height))
  return dx * dx + dy * dy <= radius * radius
}
export function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}
export function pointInFrame(point, frame) {
  return point.x >= 0 && point.x <= frame.width && point.y >= 0 && point.y <= frame.height
}
function rectInFrame(box, frame) {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= frame.width && box.y + box.height <= frame.height
}
function overlayKinds(overlays, touches) {
  return [...new Set(overlays.filter(touches).map(rect => rect.kind))]
}

/**
 * Overlays drawn over the map canvas in the picture (title strip, legend, scale bar,
 * credits), as { kind, x, y, width, height } in CSS px relative to the canvas.
 * `boxes`: [{ kind, rect: DOMRect-like }]; `canvas`: the canvas DOMRect; empty or
 * off-frame boxes are left out.
 */
export function overlayRects(boxes, canvas) {
  const frame = { width: canvas.width, height: canvas.height }
  const rects = []
  for (const { kind, rect } of boxes) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue
    const box = { kind, x: round2(rect.left - canvas.left), y: round2(rect.top - canvas.top),
      width: round2(rect.width), height: round2(rect.height) }
    if (!rectsOverlap(box, { x: 0, y: 0, ...frame })) continue
    rects.push(box)
  }
  return rects
}

/** How much a placement of the overlays hides: records in occluded markers, then occluded markers. */
export function occlusionScore(sites) {
  const hidden = sites.filter(site => site.occluded)
  return { records: hidden.reduce((sum, site) => sum + site.records, 0), sites: hidden.length }
}

export function insideBbox([lng, lat], [w, s, e, n]) {
  return lng >= w && lng <= e && lat >= s && lat <= n
}

/**
 * The complete return value of window.ithomiiniMapsExport(). `overlays` and `project`
 * (lng/lat → CSS px of the canvas at the captured camera) add the picture geometry:
 * view.overlays, records[].x/y/in_picture and sites[].x/y/radius/label_boxes/occluded.
 */
export function buildExportResult({ pngBase64, width, height, params, basemap, colorBy, title, titleTruncated = false,
  view, features, plan, legendTruncated = false, markers = [], labels = [], overlays = null, project = null,
  legendPlacement = null, attempts = 1 }) {
  const geometry = overlays && project && view?.frame ? { frame: view.frame, overlays, project } : null
  const { sites, unmatchedLabels } = exportSites(markers, labels, view?.bbox, geometry)
  if (geometry) {
    const byRecord = new Map()
    for (const site of sites) for (const member of site.members) for (const id of member.record_ids) byRecord.set(id, site)
    geometry.markerOf = key => byRecord.get(key)
  }
  const records = exportRecords(features, geometry)
  return {
    version: EXPORT_METADATA_VERSION,
    png_base64: pngBase64,
    width,
    height,
    params,
    basemap,
    color_by: colorBy,
    title,
    title_truncated: !!titleTruncated,
    view: geometry ? { ...view, overlays, legend_placement: legendPlacement } : view,
    records,
    legend: { unit: 'records', rows: legendRows(plan, colorBy), truncated: !!legendTruncated },
    sites,
    unmatched_labels: unmatchedLabels,
    capture_attempts: attempts,
  }
}
