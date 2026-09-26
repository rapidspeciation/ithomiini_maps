import { DYNAMIC_COLORS } from './constants'

/** Categorical palettes stop being distinguishable beyond about ten hues. */
export const MAX_CATEGORY_COLORS = 10
/** Colour by taxon only when the coloured groups explain most of the map. */
export const MIN_TOP_COVERAGE = 0.6
export const OTHER_COLOR = '#6b7280'
const OTHER_GROUP = Object.freeze({ key: 'other', label: 'Other', color: OTHER_COLOR })

/** Sequential ramps for individuals per site, low → high, chosen per basemap. */
export const INDIVIDUAL_RAMPS = {
  dark: ['#3171a1', '#428fac', '#65b9ac', '#b8dd9b', '#f6e8a5'],
  light: ['#fdd49e', '#fc8d59', '#ef6548', '#d7301f', '#7f0000'],
}

const MISSING = new Set(['', 'Unknown', 'NA', 'null'])
export const isMissingValue = value => value == null || MISSING.has(value)

/**
 * A colour group is a category value, or a whole species when that species is
 * collapsed in a subspecies legend.
 */
export function colorGroupFor(properties, { attribute, collapsedSpecies }) {
  const species = properties?.scientific_name
  if (collapsedSpecies?.has(species)) return { key: `species:${species}`, label: species, species, collapsed: true }
  const value = properties?.[attribute]
  if (isMissingValue(value)) return null
  return { key: `value:${value}`, label: value, species: null, collapsed: false }
}

/**
 * Decide how the map is coloured.
 *
 * - Up to MAX_CATEGORY_COLORS groups: every group gets a palette colour.
 * - More groups: colour the largest MAX_CATEGORY_COLORS and show the rest as
 *   "Other", but only when those groups cover MIN_TOP_COVERAGE of records.
 *   Otherwise colour sites by individuals, because most points would be grey.
 * - `override` ('categories' | 'individuals') replaces the automatic choice.
 *
 * Palette colours follow rank by record count, so the most common groups get
 * the most distinguishable colours.
 */
export function planColors(features, {
  attribute,
  collapsedSpecies = [],
  fixedColors = null,
  customColors = {},
  override = null,
  palette = DYNAMIC_COLORS,
} = {}) {
  const collapsed = new Set(collapsedSpecies)
  const groups = new Map()
  let total = 0
  let missing = 0
  for (const feature of features || []) {
    const properties = feature.properties || feature
    total++
    const group = colorGroupFor(properties, { attribute, collapsedSpecies: collapsed })
    if (!group) { missing++; continue }
    const entry = groups.get(group.key)
    if (entry) entry.count++
    else groups.set(group.key, { ...group, count: 1 })
  }

  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const overflow = ranked.length > MAX_CATEGORY_COLORS
  const topCount = ranked.slice(0, MAX_CATEGORY_COLORS).reduce((sum, group) => sum + group.count, 0)
  const coverage = total ? topCount / total : 1
  const automatic = !overflow || coverage >= MIN_TOP_COVERAGE ? 'categories' : 'individuals'
  const mode = overflow && (override === 'categories' || override === 'individuals') ? override : automatic

  const colored = mode === 'categories' ? ranked.slice(0, MAX_CATEGORY_COLORS) : []
  const coloredKeys = new Set(colored.map(group => group.key))
  colored.forEach((group, index) => {
    group.baseColor = fixedColors?.[group.label] || palette[index % palette.length]
    group.color = customColors[group.label] || group.baseColor
  })
  for (const group of ranked) {
    group.colored = coloredKeys.has(group.key)
    if (!group.colored) group.color = group.baseColor = OTHER_COLOR
  }

  const colorByKey = new Map(ranked.map(group => [group.key, group.color]))
  const others = ranked.filter(group => !group.colored)
  return {
    mode,
    automatic,
    overflow,
    coverage,
    total,
    missing,
    groups: ranked,
    colored,
    otherGroupCount: others.length,
    otherRecordCount: others.reduce((sum, group) => sum + group.count, 0),
    /** Coloured group of a record, or the grey "Other" group. */
    groupForRecord(properties) {
      const group = colorGroupFor(properties, { attribute, collapsedSpecies: collapsed })
      const color = group && colorByKey.get(group.key)
      return group && color && color !== OTHER_COLOR
        ? { key: group.key, label: group.label, color }
        : OTHER_GROUP
    },
    /** Colour of a record in category mode; null in individuals mode. */
    colorForRecord(properties) {
      return mode === 'categories' ? this.groupForRecord(properties).color : null
    },
  }
}

const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))

/** Colour for a position t ∈ [0, 1] along a ramp, interpolated in sRGB. */
export function rampColor(ramp, t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  const scaled = clamped * (ramp.length - 1)
  const index = Math.min(ramp.length - 2, Math.floor(scaled))
  const mix = scaled - index
  const a = hexToRgb(ramp[index])
  const b = hexToRgb(ramp[index + 1])
  return `#${a.map((value, i) => Math.round(value + (b[i] - value) * mix).toString(16).padStart(2, '0')).join('')}`
}

/** Log position of a site's individuals relative to the busiest site. */
export function individualsPosition(individuals, maximum) {
  if (!(maximum > 1)) return 1
  return Math.log1p(Math.max(0, individuals - 1)) / Math.log1p(maximum - 1)
}
