import { computed } from 'vue'
import { dateSortValue } from '../utils/dateHelpers'

const baseHues = [145, 198, 38, 270, 12, 170, 310, 220, 92, 335]

function groupPlantItems(items) {
  const grouped = {}
  for (const item of items) {
    if (!item.scientific_name) continue
    if (!grouped[item.scientific_name]) {
      grouped[item.scientific_name] = { count: 0, subspecies: {}, butterflyTaxa: new Set(), hostTaxonSlugs: new Set(), hostTaxonRanks: new Set() }
    }
    if (item.host_taxon_slug) grouped[item.scientific_name].hostTaxonSlugs.add(item.host_taxon_slug)
    if (item.host_taxon_rank) grouped[item.scientific_name].hostTaxonRanks.add(item.host_taxon_rank)
    grouped[item.scientific_name].count += 1
    for (const name of item.associated_butterflies || []) {
      grouped[item.scientific_name].butterflyTaxa.add(name)
    }
    if (!grouped[item.scientific_name].subspecies[item.subspecies]) {
      grouped[item.scientific_name].subspecies[item.subspecies] = { count: 0, individuals: [] }
    }
    grouped[item.scientific_name].subspecies[item.subspecies].count += 1
    grouped[item.scientific_name].subspecies[item.subspecies].individuals.push(item)
  }
  return grouped
}

export function useHostPlantGalleryData(hostPlantStore) {
  const butterflyTaxaByHostSlug = computed(() => {
    const bySlug = new Map()
    for (const association of hostPlantStore.associations || []) {
      if (!association.host_taxon_slug || !association.butterfly_taxon) continue
      const list = bySlug.get(association.host_taxon_slug) || []
      list.push(association.butterfly_taxon)
      bySlug.set(association.host_taxon_slug, list)
    }
    for (const [slug, names] of bySlug.entries()) {
      bySlug.set(slug, [...new Set(names)].sort((a, b) => a.localeCompare(b)))
    }
    return bySlug
  })

  const galleryDataset = computed(() => {
    const selected = new Set(hostPlantStore.selectedTaxonSlugs || [])
    const gallery = hostPlantStore.galleryDataset || {}
    const allItems = gallery.items || (gallery.records || []).filter(item => item.image_url)
    const items = selected.size > 0
      ? allItems.filter(item => selected.has(item.host_taxon_slug))
      : allItems
    const statsBySlug = gallery.stats_by_slug || {}
    const selectedStats = selected.size > 0
      ? [...selected].map(slug => statsBySlug[slug]).filter(Boolean)
      : Object.values(statsBySlug)
    const totalRecords = selectedStats.reduce((sum, stats) => sum + (stats.total_records || 0), 0)
    const recordsWithoutImages = selectedStats.reduce((sum, stats) => sum + (stats.records_without_images || 0), 0)
    const contextOrder = new Map((hostPlantStore.galleryPhotoContextOrder || ['field', 'ambiguous', 'preserved'])
      .map((key, index) => [key, index]))
    const dateMultiplier = hostPlantStore.galleryDateOrder === 'asc' ? 1 : -1
    const enrichedItems = items
      .map(item => ({
        ...item,
        associated_butterflies: butterflyTaxaByHostSlug.value.get(item.host_taxon_slug) || [],
      }))
      .sort((a, b) => {
        const contextDiff = (contextOrder.get(a.photo_context) ?? 99) - (contextOrder.get(b.photo_context) ?? 99)
        if (contextDiff) return contextDiff
        const dateDiff = (dateSortValue(a.observation_date) - dateSortValue(b.observation_date)) * dateMultiplier
        if (dateDiff) return dateDiff
        return String(a.id || '').localeCompare(String(b.id || ''))
      })

    return {
      items: enrichedItems,
      totalRecords,
      recordsWithoutImages,
    }
  })

  const allFilteredIndividuals = computed(() => galleryDataset.value.items)

  const specimensWithImages = computed(() => galleryDataset.value.items)

  const groupedBySpecies = computed(() => groupPlantItems(specimensWithImages.value))

  const speciesList = computed(() =>
    Object.entries(groupedBySpecies.value)
      .map(([species, data]) => ({
        species,
        count: data.count,
        meta: `${data.count} images`,
        searchText: [
          species,
          ...data.butterflyTaxa,
        ].join(' ').toLowerCase(),
      }))
      .sort((a, b) => {
        const order = { species: 0, genus: 1, family: 2 }
        const rankA = groupedBySpecies.value[a.species]?.hostTaxonRanks?.has('species') ? 'species' : (groupedBySpecies.value[a.species]?.hostTaxonRanks?.has('genus') ? 'genus' : 'family')
        const rankB = groupedBySpecies.value[b.species]?.hostTaxonRanks?.has('species') ? 'species' : (groupedBySpecies.value[b.species]?.hostTaxonRanks?.has('genus') ? 'genus' : 'family')
        return (order[rankA] ?? 9) - (order[rankB] ?? 9) || a.species.localeCompare(b.species)
      })
  )

  const totalSpecies = computed(() => Object.keys(groupedBySpecies.value).length)
  const totalIndividuals = computed(() => specimensWithImages.value.length)
  const allFilteredTotal = computed(() => galleryDataset.value.totalRecords)
  const allFilteredWithoutImages = computed(() => galleryDataset.value.recordsWithoutImages)
  const totalSubspeciesCount = computed(() => totalSpecies.value)

  const speciesColors = computed(() => {
    const colors = {}
    Object.keys(groupedBySpecies.value).forEach((name, idx) => {
      const hue = baseHues[idx % baseHues.length]
      colors[name] = {
        main: `hsl(${hue}, 70%, 52%)`,
        border: `hsl(${hue}, 70%, 42%)`,
        bg: `hsla(${hue}, 70%, 52%, 0.15)`,
        hue,
      }
    })
    return colors
  })

  const getSubspeciesColor = (species) => speciesColors.value[species] || {
    main: '#4ade80',
    border: '#22c55e',
    bg: 'rgba(74, 222, 128, 0.15)',
  }

  const groupedThumbnails = computed(() =>
    Object.entries(groupedBySpecies.value)
      .map(([speciesName, speciesData]) => {
        const individuals = Object.values(speciesData.subspecies)
          .flatMap(group => group.individuals)
        const hostTaxonSlugs = [...(speciesData.hostTaxonSlugs || [])]
        const hostTaxonRank = speciesData.hostTaxonRanks?.has('species') ? 'species' : (speciesData.hostTaxonRanks?.has('genus') ? 'genus' : 'family')
        const primarySlug = hostTaxonSlugs.length === 1 ? hostTaxonSlugs[0] : null
        const index = primarySlug ? hostPlantStore.galleryIndexCache?.[primarySlug] : null
        const totalAvailable = index?.total_images || individuals.length
        const stats = primarySlug ? hostPlantStore.galleryDataset?.stats_by_slug?.[primarySlug] : null
        const availableImages = stats?.records_with_images || totalAvailable
        const loadedLimit = primarySlug ? (hostPlantStore.galleryVisibleLimitBySlug?.[primarySlug] || individuals.length) : individuals.length
        return {
          type: 'species',
          name: speciesName,
          color: speciesColors.value[speciesName],
          totalImages: individuals.length,
          totalAvailableImages: availableImages,
          loadedLimit,
          canLoadMore: Boolean(primarySlug && availableImages > loadedLimit),
          hostTaxonSlug: primarySlug,
          hostTaxonRank,
          subspecies: Object.entries(speciesData.subspecies)
            .map(([subspeciesName, subspeciesData]) => ({
              type: 'subspecies',
              name: subspeciesName,
              color: getSubspeciesColor(speciesName),
              individuals: subspeciesData.individuals,
              parentSpecies: speciesName,
            })),
        }
      })
      .filter(group => group.totalImages > 0)
      .sort((a, b) => {
        const order = { species: 0, genus: 1, family: 2 }
        return (order[a.hostTaxonRank] ?? 9) - (order[b.hostTaxonRank] ?? 9) || a.name.localeCompare(b.name)
      })
  )

  return {
    allFilteredIndividuals,
    specimensWithImages,
    groupedBySpecies,
    speciesList,
    totalSpecies,
    totalIndividuals,
    allFilteredTotal,
    allFilteredWithoutImages,
    totalSubspeciesCount,
    speciesColors,
    getSubspeciesColor,
    groupedThumbnails,
  }
}
