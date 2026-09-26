// Color palette and mapping logic for map visualization
// Extracted from data.js for maintainability (~130 lines)

import { computed } from 'vue'
import { STATUS_COLORS, SOURCE_COLORS } from '../utils/constants'
import { OTHER_COLOR, planColors } from '../utils/colorPlan'
import { countUniqueIndividuals } from '../utils/clusterStats'
import { groupRecordsBySite } from '../utils/sites'
import { useLegendStore } from './legend'

/**
 * Composable for color mapping logic
 * @param {import('vue').Ref} colorBy - Current color-by mode
 * @param {import('vue').ComputedRef} displayGeoJSON - The displayed GeoJSON
 * @param {import('vue').ComputedRef} colorByAttribute - The attribute key for color-by
 */
export function useColorMapping(colorBy, displayGeoJSON, colorByAttribute) {

  const COLOR_PALETTES = {
    status: STATUS_COLORS,
    source: SOURCE_COLORS
  }

  // Build species-subspecies mapping from displayed data
  const speciesSubspeciesMap = computed(() => {
    const geo = displayGeoJSON.value
    if (!geo?.features) return {}

    const map = {}
    for (const feature of geo.features) {
      const species = feature.properties.scientific_name
      const subspecies = feature.properties.subspecies

      if (!species || !subspecies) continue
      if (subspecies === 'Unknown' || subspecies === 'NA') continue

      if (!map[species]) {
        map[species] = new Set()
      }
      map[species].add(subspecies)
    }

    const result = {}
    for (const [species, subspeciesSet] of Object.entries(map)) {
      result[species] = [...subspeciesSet].sort()
    }

    return result
  })

  /**
   * One decision drives map, legend, clusters and exports: which groups get a
   * colour, in what order, or whether sites are coloured by individuals.
   */
  const colorPlan = computed(() => {
    const legendStore = useLegendStore()
    const attr = colorByAttribute.value
    const hidden = new Set(legendStore.hiddenItems)
    const features = (displayGeoJSON.value?.features || [])
      .filter(feature => !hidden.has(feature.properties[attr]))
    return planColors(features, {
      attribute: attr,
      collapsedSpecies: colorBy.value === 'subspecies' ? legendStore.collapsedSpecies : [],
      fixedColors: COLOR_PALETTES[colorBy.value] || null,
      customColors: legendStore.customColors,
      override: legendStore.colorOverride,
    })
  })

  /** Busiest site's individuals, for the individuals legend scale. */
  const maxSiteIndividuals = computed(() => {
    let maximum = 1
    for (const site of groupRecordsBySite(displayGeoJSON.value?.features || []).values()) {
      maximum = Math.max(maximum, countUniqueIndividuals(site.records.map(record => record.properties)))
    }
    return maximum
  })

  // Every displayed category keeps an entry so the legend and filters can list
  // it; groups outside the coloured set are grey.
  const buildColorMap = (useCustom) => {
    const attr = colorByAttribute.value
    const plan = colorPlan.value
    const result = {}
    for (const feature of displayGeoJSON.value?.features || []) {
      const label = feature.properties[attr]
      if (!label || label === 'Unknown' || label === 'NA' || label === 'null' || result[label]) continue
      result[label] = OTHER_COLOR
    }
    for (const group of plan.groups) {
      if (group.collapsed) continue
      result[group.label] = group.colored ? (useCustom ? group.color : group.baseColor) : OTHER_COLOR
    }
    // Subspecies of a collapsed species take that species' colour.
    if (colorBy.value === 'subspecies') {
      const speciesGroups = new Map(plan.groups.filter(group => group.collapsed).map(group => [group.species, group]))
      for (const feature of displayGeoJSON.value?.features || []) {
        const group = speciesGroups.get(feature.properties.scientific_name)
        const label = feature.properties.subspecies
        if (group && label && result[label] === OTHER_COLOR) {
          result[label] = group.colored ? (useCustom ? group.color : group.baseColor) : OTHER_COLOR
        }
      }
    }
    return result
  }

  // Base color map without custom overrides (used for reset in the legend)
  const baseColorMap = computed(() => buildColorMap(false))

  // Active color map = base + custom overrides
  const activeColorMap = computed(() => buildColorMap(true))

  const speciesColorMap = computed(() => {
    const colors = {}
    for (const group of colorPlan.value.groups) {
      if (group.collapsed) colors[group.species] = group.color
    }
    return colors
  })

  /** Labels drawn in colour; the rest of the legend's categories are "Other". */
  const coloredLabels = computed(() => new Set(
    Object.entries(activeColorMap.value).filter(([, color]) => color !== OTHER_COLOR).map(([label]) => label)
  ))

  // Legend title based on colorBy
  const legendTitle = computed(() => {
    const legendStore = useLegendStore()
    if (colorPlan.value.mode === 'individuals') return 'Individuals per site'
    if (colorBy.value === 'subspecies' &&
        legendStore.effectiveGroupBy === 'species' &&
        legendStore.collapsedSpecies.length > 0) {
      return 'Species / subspecies'
    }
    const titles = {
      'status': 'Sequencing Status',
      'subspecies': 'Subspecies',
      'species': 'Species',
      'genus': 'Genus',
      'mimicry': 'Mimicry Ring',
      'source': 'Data Source'
    }
    return titles[colorBy.value] || 'Legend'
  })

  return {
    speciesSubspeciesMap,
    colorPlan,
    maxSiteIndividuals,
    baseColorMap,
    activeColorMap,
    speciesColorMap,
    coloredLabels,
    legendTitle
  }
}
