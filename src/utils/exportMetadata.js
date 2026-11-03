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
 * What the app honoured from its link. Unknown names, and values of `style`,
 * `color_by`, `bbox`, `export`, `sex` or `map_view` it cannot use, are ignored.
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
  for (const [name, value] of params) {
    if (!KNOWN_PARAMS.has(name) || (valid[name] && !valid[name](value))) {
      if (!ignored.includes(name)) ignored.push(name)
      continue
    }
    applied[name] = name === 'bbox' ? parseBbox(value) : value
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

/** One row per record drawn, with the fields as the map has them (no workbook values). */
export function exportRecords(features) {
  return (features || []).map(feature => {
    const record = feature.properties ?? feature
    const [lng, lat] = recordedCoordinates(feature) ?? [null, null]
    return {
      source: record.source ?? null,
      id: record.id == null ? null : String(record.id),
      sex: record.sex ?? null,
      country: record.country ?? null,
      year: recordYear(record),
      date: record.observation_date ?? null,
      subspecies: record.subspecies ?? null,
      lng, lat,
    }
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
 * Drawn markers with the labels drawn for them. `markers`: [{ kind, id, lng, lat, records }]
 * (records = features). `labels`: placed label features from the locality layer:
 * a cluster label names `clusterId`; a site label names `anchorKey` = JSON [siteId, lng, lat].
 */
export function exportSites(markers, labels, viewBbox) {
  const sites = markers.map(marker => {
    const members = markerMembers(marker.records)
    return {
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
    site.labels.push(text)
    site.label ??= text
  }
  for (const site of sites) delete site._marker
  return { sites, unmatchedLabels: unmatched }
}

export function insideBbox([lng, lat], [w, s, e, n]) {
  return lng >= w && lng <= e && lat >= s && lat <= n
}

/** The complete return value of window.ithomiiniMapsExport(). */
export function buildExportResult({ pngBase64, width, height, params, basemap, colorBy, title, view,
  features, plan, legendTruncated = false, markers = [], labels = [] }) {
  const records = exportRecords(features)
  const { sites, unmatchedLabels } = exportSites(markers, labels, view?.bbox)
  return {
    version: EXPORT_METADATA_VERSION,
    png_base64: pngBase64,
    width,
    height,
    params,
    basemap,
    color_by: colorBy,
    title,
    view,
    records,
    legend: { unit: 'records', rows: legendRows(plan, colorBy), truncated: !!legendTruncated },
    sites,
    unmatched_labels: unmatchedLabels,
  }
}
