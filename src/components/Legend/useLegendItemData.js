// Legend item computation, grouping, sorting, and label formatting
// Extracted from Legend.vue for maintainability (~490 lines)

import { computed } from 'vue'
import { generateSpeciesBorderColors } from '../../utils/colors'
import { applyAbbreviationFormat } from '../../utils/abbreviations'

// Map groupBy setting to GeoJSON property name
const groupByPropertyMap = {
  'subspecies': 'subspecies',
  'species': 'scientific_name',
  'genus': 'genus',
  'tribe': 'tribe',
  'subfamily': 'subfamily',
  'family': 'family',
  'status': 'sequencing_status',
  'mimicry': 'mimicry_ring',
  'source': 'source'
}

export function useLegendBaseData(dataStore, legendStore, isExportMode) {
  // Color map from data store (includes custom overrides - used for display)
  const colorMap = computed(() => dataStore.activeColorMap)
  const activeColorMap = colorMap
  // Base color map (without custom overrides - used for defaultColor/reset)
  const baseColors = computed(() => dataStore.baseColorMap)

  // Build item→group mapping from displayed data
  const itemGroupMap = computed(() => {
    const geo = dataStore.displayGeoJSON
    if (!geo?.features) return {}

    const groupBy = legendStore.effectiveGroupBy
    const groupProperty = groupByPropertyMap[groupBy]
    if (!groupProperty) return {}

    const itemProperty = dataStore.colorByAttribute

    const map = {}
    for (const feature of geo.features) {
      const groupVal = feature.properties[groupProperty]
      const itemVal = feature.properties[itemProperty]

      if (!groupVal || !itemVal) continue
      if (itemVal === 'Unknown' || itemVal === 'NA') continue

      if (!map[groupVal]) {
        map[groupVal] = new Set()
      }
      map[groupVal].add(itemVal)
    }

    return map
  })

  // Reverse lookup: item label → array of group names (O(1) per item)
  const itemToGroupsMap = computed(() => {
    const reverse = new Map()
    for (const [group, items] of Object.entries(itemGroupMap.value)) {
      for (const item of items) {
        if (!reverse.has(item)) reverse.set(item, [])
        reverse.get(item).push(group)
      }
    }
    return reverse
  })

  // Map subspecies label → species name
  const subspeciesSpeciesMap = computed(() => {
    const geo = dataStore.displayGeoJSON
    if (!geo?.features || dataStore.colorBy !== 'subspecies') return {}
    const map = {}
    for (const f of geo.features) {
      const subsp = f.properties.subspecies
      const species = f.properties.scientific_name
      if (subsp && species && !map[subsp]) map[subsp] = species
    }
    return map
  })

  // Get list of groups (sorted)
  const groupList = computed(() => Object.keys(itemGroupMap.value).sort())

  // Generate border colors for groups
  const groupBorderColors = computed(() => {
    if (!legendStore.speciesStyling.borderColor) return {}
    return generateSpeciesBorderColors(groupList.value, legendStore.speciesBorderColors)
  })

  function getGroupBorderColor(groupName) {
    return groupBorderColors.value[groupName] || dataStore.mapStyle.borderColor
  }

  function hasCustomizedStyle(groupName) {
    const shape = legendStore.getGroupShape(groupName)
    const hasCustomShape = shape && shape !== 'circle'
    const hasCustomBorder = !!legendStore.speciesBorderColors[groupName]
    return hasCustomShape || hasCustomBorder
  }

  const anyGroupHasCustomStyle = computed(() => {
    return groupList.value.some(name => hasCustomizedStyle(name))
  })

  function getGroupForItem(itemLabel) {
    const groups = itemToGroupsMap.value.get(itemLabel)
    return groups ? groups[0] : null
  }

  function getGroupsForItem(itemLabel) {
    return itemToGroupsMap.value.get(itemLabel) || []
  }

  function formatLabel(itemLabel, groupName) {
    const isGroupedBySpecies = legendStore.effectiveGroupBy === 'species'

    if (dataStore.colorBy === 'subspecies' && !isGroupedBySpecies) {
      if (legendStore.prefixFormat === 'none') return itemLabel
      const species = subspeciesSpeciesMap.value[itemLabel]
      if (species) {
        const abbreviation = legendStore.getSpeciesAbbreviation(species)
        if (abbreviation) return `${abbreviation} ${itemLabel}`
      }
      return itemLabel
    }

    if (!groupName || !legendStore.isAbbreviationVisible(groupName)) {
      return itemLabel
    }

    const abbreviation = legendStore.getSpeciesAbbreviation(groupName)
    return `${abbreviation} ${itemLabel}`
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGEND COUNTS
  // ═══════════════════════════════════════════════════════════════════════════

  const legendCounts = computed(() => {
    const geo = dataStore.displayGeoJSON
    if (!geo?.features) return {}
    const attr = dataStore.colorByAttribute
    const hidden = new Set(legendStore.hiddenItems)
    const counts = {}
    for (const feature of geo.features) {
      const val = feature.properties[attr]
      if (val && val !== 'Unknown' && val !== 'NA' && !hidden.has(val)) {
        counts[val] = (counts[val] || 0) + 1
      }
    }
    return counts
  })

  const legendGroupCounts = computed(() => {
    const geo = dataStore.displayGeoJSON
    if (!geo?.features) return {}
    if (!legendStore.isGrouped) return {}
    const attr = dataStore.colorByAttribute
    const groupBy = legendStore.effectiveGroupBy
    const groupProperty = groupByPropertyMap[groupBy]
    if (!groupProperty) return {}
    const hidden = new Set(legendStore.hiddenItems)
    const counts = {}
    for (const feature of geo.features) {
      const val = feature.properties[attr]
      const groupVal = feature.properties[groupProperty]
      if (val && val !== 'Unknown' && val !== 'NA' && !hidden.has(val) && groupVal) {
        const key = `${groupVal}\0${val}`
        counts[key] = (counts[key] || 0) + 1
      }
    }
    return counts
  })

  function getGroupItemCount(groupName, itemLabel) {
    return legendGroupCounts.value[`${groupName}\0${itemLabel}`] || 0
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SORTED ITEMS
  // ═══════════════════════════════════════════════════════════════════════════

  const sortedAllItems = computed(() => {
    const sortByVal = legendStore.sortBy
    const sortOrderVal = legendStore.sortOrder
    const counts = legendCounts.value
    const entries = Object.entries(colorMap.value)

    const items = []
    const baseMap = baseColors.value
    // Only coloured groups get rows; the rest are summarised as "Other".
    const colored = dataStore.coloredLabels
    for (const [label, color] of entries) {
      if (!legendStore.isItemVisible(label)) continue
      if (!colored.has(label)) continue
      items.push({
        label,
        color,
        defaultColor: baseMap[label] || color,
        customLabel: legendStore.customLabels[label] || '',
        customColor: legendStore.customColors[label] || '',
        visible: true
      })
    }

    if (sortByVal === 'abundance') {
      items.sort((a, b) => {
        const countA = counts[a.label] || 0
        const countB = counts[b.label] || 0
        return sortOrderVal === 'asc' ? countA - countB : countB - countA
      })
    } else {
      items.sort((a, b) => {
        const textA = a.label.toLowerCase()
        const textB = b.label.toLowerCase()
        return sortOrderVal === 'asc' ? textA.localeCompare(textB) : textB.localeCompare(textA)
      })
    }

    return items
  })

  return {
    legendCounts,
    legendGroupCounts,
    sortedAllItems,
    itemGroupMap,
    itemToGroupsMap,
    subspeciesSpeciesMap,
    baseColors,
    colorMap,
    activeColorMap,
    groupBorderColors,
    getGroupBorderColor,
    hasCustomizedStyle,
    anyGroupHasCustomStyle,
    getGroupForItem,
    getGroupsForItem,
    formatLabel,
    getGroupItemCount
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SORT HELPERS & GROUPED DATA
// ═══════════════════════════════════════════════════════════════════════════

function sortItemsByText(items, order) {
  return items.slice().sort((a, b) => {
    const textA = (a.displayLabel || a.label).toLowerCase()
    const textB = (b.displayLabel || b.label).toLowerCase()
    return order === 'asc' ? textA.localeCompare(textB) : textB.localeCompare(textA)
  })
}

function sortItemsByAbundance(items, order, counts) {
  return items.slice().sort((a, b) => {
    const countA = counts[a.label] || 0
    const countB = counts[b.label] || 0
    return order === 'asc' ? countA - countB : countB - countA
  })
}

function sortGroups(groups, sortBy, sortOrder, counts) {
  if (sortBy === 'abundance') {
    groups.sort((a, b) => {
      const totalA = a.items.reduce((sum, item) => sum + (counts[item.label] || 0), 0)
      const totalB = b.items.reduce((sum, item) => sum + (counts[item.label] || 0), 0)
      return sortOrder === 'asc' ? totalA - totalB : totalB - totalA
    })
  } else {
    groups.sort((a, b) => {
      const textA = a.name.toLowerCase()
      const textB = b.name.toLowerCase()
      return sortOrder === 'asc' ? textA.localeCompare(textB) : textB.localeCompare(textA)
    })
  }
  return groups
}

function contractSpeciesName(speciesName) {
  if (!speciesName) return ''
  const parts = speciesName.split(' ')
  if (parts.length >= 2) {
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
  }
  return speciesName
}

function groupItemsByGroup(items, getGroupsForItem) {
  const byGroup = {}
  for (const item of items) {
    const groups = getGroupsForItem(item.label)
    for (const group of groups) {
      if (!byGroup[group]) byGroup[group] = []
      byGroup[group].push(item)
    }
  }
  return byGroup
}

function buildGroupData({
  groupName,
  items,
  sortByVal,
  sortOrderVal,
  counts,
  multiGroupLabels,
  legendStore,
  formatLabel,
  getGroupBorderColor
}) {
  let customLabel = legendStore.getSpeciesDisplayName(groupName)
  if (!customLabel && legendStore.displayNameFormat !== 'firstLetterGenus') {
    customLabel = applyAbbreviationFormat(groupName, legendStore.displayNameFormat)
  }

  const headersHidden = !legendStore.groupingSettings.showHeaders && !legendStore.isNonTaxonomyGroupBy
  const needsDisambiguation = headersHidden && multiGroupLabels

  let mappedItems = items.map(item => {
    const shouldDisambiguate = needsDisambiguation && multiGroupLabels.has(item.label)
    // When disambiguating, skip the abbreviation prefix from formatLabel
    // to avoid double species info (prefix + suffix).
    let displayLabel = shouldDisambiguate
      ? item.label
      : formatLabel(item.label, groupName)
    if (shouldDisambiguate) {
      displayLabel += ` (${contractSpeciesName(groupName)})`
    }
    return { ...item, displayLabel }
  })

  mappedItems = sortByVal === 'abundance'
    ? sortItemsByAbundance(mappedItems, sortOrderVal, counts)
    : sortItemsByText(mappedItems, sortOrderVal)

  return {
    name: groupName,
    borderColor: getGroupBorderColor(groupName),
    shape: legendStore.getGroupShape(groupName),
    abbreviation: legendStore.getSpeciesAbbreviation(groupName),
    abbreviationVisible: legendStore.isAbbreviationVisible(groupName),
    customLabel: customLabel || '',
    items: mappedItems
  }
}

/**
 * Composable for legend item display computation
 * @param {ReturnType<typeof useLegendBaseData>} base - Base legend data
 * @param {Object} dataStore - Data store instance
 * @param {Object} legendStore - Legend store instance
 * @param {Function} getEffectiveMaxItems - Getter for max items (lazy, avoids circular dep with measurement)
 * @param {import('vue').ComputedRef} isExportMode - Whether export mode is active
 */
export function useLegendDisplayData(base, dataStore, legendStore, getEffectiveMaxItems, isExportMode) {
  const {
    baseColors,
    colorMap,
    formatLabel,
    getGroupBorderColor,
    getGroupsForItem,
    legendCounts,
    sortedAllItems,
    itemGroupMap
  } = base

  const legendItems = computed(() => {
    const maxItems = getEffectiveMaxItems()
    // Collapsed species consume one rendered row, regardless of how many
    // subspecies they contain. Keep all candidates until groups are built.
    const hasCollapsedSpecies = dataStore.colorBy === 'subspecies' &&
      legendStore.effectiveGroupBy === 'species' && legendStore.collapsedSpecies.length > 0
    const items = hasCollapsedSpecies
      ? sortedAllItems.value.slice()
      : sortedAllItems.value.slice(0, maxItems)

    if (!isExportMode.value) {
      const baseMap = baseColors.value
      for (const label of legendStore.hiddenItems) {
        if (colorMap.value[label]) {
          items.push({
            label,
            color: colorMap.value[label],
            defaultColor: baseMap[label] || colorMap.value[label],
            customLabel: legendStore.customLabels[label] || '',
            customColor: legendStore.customColors[label] || '',
            visible: false
          })
        }
      }
    }

    return items
  })

  const groupedLegendData = computed(() => {
    const sortByVal = legendStore.sortBy
    const sortOrderVal = legendStore.sortOrder
    const counts = legendCounts.value

    if (!legendStore.isGrouped) {
      return { type: 'flat', items: legendItems.value.slice() }
    }

    const itemsByGroup = groupItemsByGroup(legendItems.value, getGroupsForItem)

    const labelGroupCount = new Map()
    for (const items of Object.values(itemsByGroup)) {
      for (const item of items) {
        labelGroupCount.set(item.label, (labelGroupCount.get(item.label) || 0) + 1)
      }
    }

    const multiGroupLabels = new Set()
    for (const [label, count] of labelGroupCount) {
      if (count > 1) multiGroupLabels.add(label)
    }

    const canCollapse = dataStore.colorBy === 'subspecies' && legendStore.effectiveGroupBy === 'species'
    let groups = Object.keys(itemsByGroup).map(groupName => ({
      ...buildGroupData({
        groupName,
        items: itemsByGroup[groupName],
        sortByVal,
        sortOrderVal,
        counts,
        multiGroupLabels: multiGroupLabels.size > 0 ? multiGroupLabels : null,
        legendStore,
        formatLabel,
        getGroupBorderColor
      }),
      collapsible: canCollapse,
      collapsed: canCollapse && legendStore.isSpeciesCollapsed(groupName),
      speciesColor: dataStore.speciesColorMap?.[groupName] || itemsByGroup[groupName][0]?.color,
    }))

    groups = sortGroups(groups, sortByVal, sortOrderVal, counts)

    const maxVisible = getEffectiveMaxItems()
    let totalRendered = 0
    groups = groups.map(g => {
      if (totalRendered >= maxVisible) return null
      const remaining = maxVisible - totalRendered
      const visible = g.items.filter(item => item.visible !== false)
      const hidden = g.items.filter(item => item.visible === false)
      const kept = g.collapsed ? visible : visible.slice(0, remaining)
      totalRendered += g.collapsed ? (visible.length > 0 ? 1 : 0) : kept.length
      if (kept.length === 0 && hidden.length === 0) return null
      return { ...g, items: [...kept, ...hidden] }
    }).filter(Boolean)

    return { type: 'grouped', groups }
  })

  function countShownLabels() {
    const gld = groupedLegendData.value
    const shown = new Set()
    if (gld.type === 'grouped') {
      for (const g of gld.groups) {
        if (g.collapsed) {
          for (const label of itemGroupMap.value[g.name] || []) {
            if (legendStore.isItemVisible(label)) shown.add(label)
          }
        }
        for (const item of g.items) {
          if (item.visible !== false) shown.add(item.label)
        }
      }
    } else {
      for (const item of (gld.items || [])) {
        if (item.visible !== false) shown.add(item.label)
      }
    }
    return shown
  }

  const moreCount = computed(() => {
    const totalVisible = sortedAllItems.value.length
    const shown = countShownLabels()
    return Math.max(0, totalVisible - shown.size)
  })

  const morePointCount = computed(() => {
    if (!legendStore.showCounts || moreCount.value === 0) return null
    const shown = countShownLabels()
    const counts = legendCounts.value
    let total = 0
    for (const [label, cnt] of Object.entries(counts)) {
      if (!shown.has(label)) {
        total += cnt
      }
    }
    return total
  })

  return {
    legendItems,
    groupedLegendData,
    moreCount,
    morePointCount
  }
}
