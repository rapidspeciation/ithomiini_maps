import { DYNAMIC_COLORS } from './constants'

/** Categorical palettes stop being distinguishable beyond about ten hues. */
export const MAX_CATEGORY_COLORS = 10
export const OTHER_COLOR = '#6b7280'
const OTHER_GROUP = Object.freeze({ key: 'other', label: 'Other', color: OTHER_COLOR })

const MISSING = new Set(['', 'NA', 'null', 'NOT_FOUND'])
/** Blank and placeholder values ("Unknown", "Unknown species") never take a colour. */
export const isMissingValue = value => value == null || MISSING.has(value) || /^unknown\b/i.test(value)

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
 * Up to MAX_CATEGORY_COLORS groups each get a palette colour. With more, the
 * largest MAX_CATEGORY_COLORS are coloured and the rest are grey "Other".
 *
 * Palette colours follow rank by record count, so the most common groups get
 * the most distinguishable colours.
 */
export function planColors(features, {
  attribute,
  collapsedSpecies = [],
  fixedColors = null,
  customColors = {},
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
  const colored = ranked.slice(0, MAX_CATEGORY_COLORS)
  const coverage = total ? colored.reduce((sum, group) => sum + group.count, 0) / total : 1
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
    colorForRecord(properties) {
      return this.groupForRecord(properties).color
    },
  }
}
