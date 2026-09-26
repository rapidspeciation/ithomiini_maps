import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { parseDate } from '../utils/dateHelpers'
import { getStorage, setStorage } from '../utils/storageHelpers'
import { isValidValue } from '../utils/validation'
import { useDatasetStore } from './datasetStore'
import { log } from '../utils/logger'

/**
 * Subspecies narrow only the species they belong to. With M. polymnia and
 * I. salapia selected, choosing I. salapia's travella keeps every
 * M. polymnia record. Returns species -> selected subspecies, or null when
 * the selection is not scoped (no species chosen, or OR combinator).
 */
export function buildSubspeciesScope(features, species, subspecies, combinator = 'AND') {
  if (!species.length || !subspecies.length || combinator === 'OR') return null
  const speciesSet = new Set(species)
  const subspeciesSet = new Set(subspecies)
  const scope = new Map()
  for (const item of features) {
    if (!speciesSet.has(item.scientific_name) || !subspeciesSet.has(item.subspecies)) continue
    if (!scope.has(item.scientific_name)) scope.set(item.scientific_name, new Set())
    scope.get(item.scientific_name).add(item.subspecies)
  }
  return scope
}

export function matchesSubspeciesSelection(item, subspeciesSet, scope) {
  if (!subspeciesSet) return true
  if (!scope) return subspeciesSet.has(item.subspecies)
  const selected = scope.get(item.scientific_name)
  return !selected || selected.has(item.subspecies)
}

export const useFilterStore = defineStore('filters', () => {
  const datasetStore = useDatasetStore()

  const showAdvancedFilters = ref(getStorage('app-show-advanced-filters', false))
  const showMimicryFilter = ref(getStorage('app-show-mimicry-filter', false))
  const showGoatFilter = ref(getStorage('app-show-goat-filter', false))
  const focusPoint = ref(null)
  const gallerySelection = ref(null)
  const boundingBox = ref(null)

  const defaultFilters = () => ({
    family: [],
    tribe: [],
    genus: [],
    species: [],
    subspecies: [],
    mimicry: [],
    status: [],
    source: ['Sanger Institute'],
    sex: 'all',
    country: [],
    collectionLocation: [],
    camidSearch: '',
    dateStart: null,
    dateEnd: null,
    goatCoverage: 'all',
    goatDataSource: [],
    goatChromosomeMin: null,
    goatChromosomeMax: null,
    taxonomyCombinators: {
      tribe: 'AND',
      genus: 'AND',
      species: 'AND',
      subspecies: 'AND',
    },
  })

  const filters = ref(defaultFilters())

  const loadSourcesForFilters = async () => {
    const needed = filters.value.source.filter(source => !datasetStore.loadedSources.has(source))
    if (needed.length <= 1) {
      await Promise.all(needed.map(source => datasetStore.loadSource(source)))
    } else {
      await Promise.all(needed.map(source => datasetStore.loadSource(source, { batch: true })))
    }
  }

  const parseListParam = (value) => {
    if (!value) return null
    return value === 'All' ? [] : value.split(',').filter(Boolean)
  }

  const restoreFiltersFromURL = () => {
    const params = new URLSearchParams(window.location.search)

    const family = parseListParam(params.get('family'))
    if (family) { filters.value.family = family; showAdvancedFilters.value = true }
    const tribe = parseListParam(params.get('tribe'))
    if (tribe) { filters.value.tribe = tribe; showAdvancedFilters.value = true }
    const genus = parseListParam(params.get('genus'))
    if (genus) { filters.value.genus = genus; showAdvancedFilters.value = true }
    if (params.get('sp')) filters.value.species = params.get('sp').split(',')
    if (params.get('ssp')) filters.value.subspecies = params.get('ssp').split(',')
    if (params.get('mim')) { filters.value.mimicry = params.get('mim').split(','); showMimicryFilter.value = true }
    if (params.get('status')) filters.value.status = params.get('status').split(',')
    if (params.get('source')) filters.value.source = params.get('source').split(',')
    const country = parseListParam(params.get('country'))
    if (country) filters.value.country = country
    if (params.has('locality')) {
      try {
        const locations = JSON.parse(params.get('locality'))
        if (Array.isArray(locations) && locations.every(value => typeof value === 'string' && isValidValue(value))) {
          filters.value.collectionLocation = [...new Set(locations)]
        }
      } catch { /* Ignore invalid shared locality filters. */ }
    }
    if (params.get('sex')) filters.value.sex = params.get('sex')
    if (params.get('cam')) filters.value.camidSearch = params.get('cam')
    if (params.get('from')) filters.value.dateStart = params.get('from')
    if (params.get('to')) filters.value.dateEnd = params.get('to')
    if (params.get('goat')) { filters.value.goatCoverage = params.get('goat'); showGoatFilter.value = true }
    if (params.get('goat_src')) { filters.value.goatDataSource = params.get('goat_src').split(','); showGoatFilter.value = true }
    if (params.get('chr_min')) { filters.value.goatChromosomeMin = Number(params.get('chr_min')); showGoatFilter.value = true }
    if (params.get('chr_max')) { filters.value.goatChromosomeMax = Number(params.get('chr_max')); showGoatFilter.value = true }
    const combo = params.get('tax_combo')
    if (combo) {
      const [tr, gn, sp, ssp] = combo.split('')
      filters.value.taxonomyCombinators = {
        tribe: tr === 'O' ? 'OR' : 'AND',
        genus: gn === 'O' ? 'OR' : 'AND',
        species: sp === 'O' ? 'OR' : 'AND',
        subspecies: ssp === 'O' ? 'OR' : 'AND',
      }
    }
  }

  const resetAllFilters = () => {
    filters.value = defaultFilters()
    boundingBox.value = null
  }

  const getFilteredSubset = (upToLevel) => {
    let data = datasetStore.allFeatures

    if (filters.value.source.length > 0) {
      data = data.filter(item => filters.value.source.includes(item.source))
    }

    if (upToLevel >= 1 && filters.value.family.length > 0) {
      data = data.filter(item => filters.value.family.includes(item.family))
    }
    if (upToLevel >= 2 && filters.value.tribe.length > 0) {
      data = data.filter(item => filters.value.tribe.includes(item.tribe))
    }
    if (upToLevel >= 3 && filters.value.genus.length > 0) {
      data = data.filter(item => filters.value.genus.includes(item.genus))
    }
    if (upToLevel >= 4 && filters.value.species.length > 0) {
      data = data.filter(item => filters.value.species.includes(item.scientific_name))
    }

    return data
  }

  const uniqueValuesOf = (data, field) =>
    Array.from(new Set(data.map(item => item[field]).filter(isValidValue))).sort()

  const uniqueFamilies = computed(() => uniqueValuesOf(datasetStore.allFeatures, 'family'))
  const uniqueTribes = computed(() => uniqueValuesOf(getFilteredSubset(1), 'tribe'))
  const uniqueGenera = computed(() => uniqueValuesOf(getFilteredSubset(2), 'genus'))
  const uniqueSpecies = computed(() => uniqueValuesOf(getFilteredSubset(3), 'scientific_name'))
  const uniqueSubspecies = computed(() => uniqueValuesOf(getFilteredSubset(4), 'subspecies'))
  const uniqueMimicry = computed(() => uniqueValuesOf(datasetStore.allFeatures, 'mimicry_ring'))

  const speciesFilterOptions = computed(() => {
    return uniqueSpecies.value.map(species => ({
      label: species,
      value: species,
      searchText: species.toLowerCase(),
    }))
  })

  const filterSpeciesOptions = (options, search) => {
    const query = (search || '').trim().toLowerCase()
    if (!query) return options
    const acceptedSet = new Set(options.map(option => option.value))
    const direct = options.filter(option => option.label.toLowerCase().includes(query))
    const directValues = new Set()
    for (const option of direct) directValues.add(option.value)
    const synonym = []
    for (const entry of datasetStore.taxonomySynonyms || []) {
      if (!acceptedSet.has(entry.accepted)) continue
      if (directValues.has(entry.accepted)) continue
      if (!entry.synonym?.toLowerCase().includes(query)) continue
      synonym.push({
        label: entry.accepted,
        value: entry.accepted,
        synonym: entry.synonym,
        synonymMeta: `synonym: ${entry.synonym}`,
        searchText: `${entry.accepted} ${entry.synonym}`.toLowerCase(),
      })
    }
    return [
      ...direct,
      ...synonym.sort((a, b) => a.label.localeCompare(b.label) || a.synonym.localeCompare(b.synonym)),
    ]
  }

  const subspeciesScope = computed(() => buildSubspeciesScope(
    datasetStore.allFeatures,
    filters.value.species,
    filters.value.subspecies,
    filters.value.taxonomyCombinators?.subspecies,
  ))

  /** One target per whole species, or per chosen subspecies when a species is narrowed. */
  const taxonTargets = computed(() => filters.value.species.flatMap(species => {
    const subspecies = subspeciesScope.value?.get(species)
    return subspecies?.size
      ? [...subspecies].sort().map(name => ({ label: `${species} ${name}`, species, subspecies: name }))
      : [{ label: species, species, subspecies: null }]
  }))

  /** Subspecies options grouped under their species so the per-species scope is visible. */
  const subspeciesOptionGroups = computed(() => {
    const groups = new Map()
    for (const item of getFilteredSubset(4)) {
      if (!isValidValue(item.subspecies) || !isValidValue(item.scientific_name)) continue
      if (!groups.has(item.scientific_name)) groups.set(item.scientific_name, new Set())
      groups.get(item.scientific_name).add(item.subspecies)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([species, names]) => ({ label: species, options: [...names].sort() }))
  })

  const availableMimicryRings = computed(() => {
    let data = datasetStore.allFeatures

    if (filters.value.family.length > 0) data = data.filter(item => filters.value.family.includes(item.family))
    if (filters.value.tribe.length > 0) data = data.filter(item => filters.value.tribe.includes(item.tribe))
    if (filters.value.genus.length > 0) data = data.filter(item => filters.value.genus.includes(item.genus))
    if (filters.value.species.length > 0) data = data.filter(item => filters.value.species.includes(item.scientific_name))
    if (filters.value.subspecies.length > 0) {
      const subspeciesSet = new Set(filters.value.subspecies)
      data = data.filter(item => matchesSubspeciesSelection(item, subspeciesSet, subspeciesScope.value))
    }

    return uniqueValuesOf(data, 'mimicry_ring')
  })

  const unavailableMimicryRings = computed(() => {
    const available = new Set(availableMimicryRings.value)
    return uniqueMimicry.value.filter(ring => !available.has(ring))
  })

  const uniqueStatuses = computed(() => uniqueValuesOf(datasetStore.allFeatures, 'sequencing_status'))
  const uniqueSources = computed(() => Object.keys(datasetStore.sourceConfig))
  const uniqueCountries = computed(() => uniqueValuesOf(datasetStore.allFeatures, 'country'))
  const uniqueCollectionLocations = computed(() => {
    const sources = filters.value.source
    const names = datasetStore.allFeatures
      .filter(item => sources.length === 0 || sources.includes(item.source))
      .map(item => item.collection_location)
      .filter(isValidValue)
    return [...new Set([...names, ...filters.value.collectionLocation])].sort()
  })
  const uniqueCamids = computed(() => uniqueValuesOf(datasetStore.allFeatures, 'id'))

  const temporalDistribution = computed(() => {
    let data = datasetStore.allFeatures
    if (!data.length) return []

    if (filters.value.source.length > 0) {
      data = data.filter(item => filters.value.source.includes(item.source))
    }

    const yearCounts = {}
    let minYear = Infinity
    let maxYear = -Infinity

    for (const item of data) {
      const dateStr = item.observation_date || item.date || item.preservation_date
      const d = parseDate(dateStr)
      if (!d) continue
      const year = d.getFullYear()
      yearCounts[year] = (yearCounts[year] || 0) + 1
      if (year < minYear) minYear = year
      if (year > maxYear) maxYear = year
    }

    if (minYear === Infinity) return []

    const result = []
    for (let year = minYear; year <= maxYear; year++) {
      result.push({ year, count: yearCounts[year] || 0 })
    }
    return result
  })

  // Taxonomy filters are purely additive — users manage their own filter state
  // via the active-filters UI; no auto-cascade on change to avoid surprising removals.

  watch(() => filters.value.source, async (selectedSources) => {
    const needed = selectedSources.filter(source => !datasetStore.loadedSources.has(source))
    if (needed.length <= 1) {
      for (const source of needed) await datasetStore.loadSource(source)
    } else {
      await Promise.all(needed.map(source => datasetStore.loadSource(source, { batch: true })))
    }
  }, { deep: true })

  const _featureCache = new Map()
  const getFeatureWrapper = (item) => {
    let cached = _featureCache.get(item)
    if (!cached) {
      cached = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        properties: item,
      }
      _featureCache.set(item, cached)
    }
    return cached
  }

  const filteredGeoJSON = computed(() => {
    if (!datasetStore.allFeatures.length) return null
    log.perf.start('filteredGeoJSON')

    let searchTerms = null
    if (filters.value.camidSearch) {
      searchTerms = filters.value.camidSearch
        .toUpperCase()
        .split(/[\s,\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
      if (searchTerms.length === 0) searchTerms = null
    }

    const familySet = filters.value.family.length > 0 ? new Set(filters.value.family) : null
    const tribeSet = filters.value.tribe.length > 0 ? new Set(filters.value.tribe) : null
    const genusSet = filters.value.genus.length > 0 ? new Set(filters.value.genus) : null
    const speciesSet = filters.value.species.length > 0 ? new Set(filters.value.species) : null
    const subspeciesSet = filters.value.subspecies.length > 0 ? new Set(filters.value.subspecies) : null
    const mimicrySet = filters.value.mimicry.length > 0 ? new Set(filters.value.mimicry) : null
    const statusSet = filters.value.status.length > 0 ? new Set(filters.value.status) : null
    const sourceSet = filters.value.source.length > 0 ? new Set(filters.value.source) : null
    const countrySet = filters.value.country.length > 0 ? new Set(filters.value.country) : null
    const collectionLocationSet = filters.value.collectionLocation.length > 0
      ? new Set(filters.value.collectionLocation)
      : null
    const scope = subspeciesScope.value

    const f = filters.value
    const bb = boundingBox.value
    const hasDateFilter = f.dateStart || f.dateEnd
    const dateStart = f.dateStart ? new Date(f.dateStart) : null
    const dateEnd = f.dateEnd ? new Date(f.dateEnd) : null

    const hasGoatFilter = f.goatCoverage !== 'all' || f.goatDataSource.length > 0 ||
      f.goatChromosomeMin != null || f.goatChromosomeMax != null
    const goatDataSourceSet = f.goatDataSource.length > 0 ? new Set(f.goatDataSource) : null

    const filtered = datasetStore.allFeatures.filter(item => {
      if (searchTerms) {
        const itemId = (item.id || '').toUpperCase()
        if (!searchTerms.some(term => itemId.includes(term))) return false
      }

      const taxLevels = [
        { set: familySet, value: item.family, combinator: 'AND' },
        { set: tribeSet, value: item.tribe, combinator: f.taxonomyCombinators?.tribe || 'AND' },
        { set: genusSet, value: item.genus, combinator: f.taxonomyCombinators?.genus || 'AND' },
        { set: speciesSet, value: item.scientific_name, combinator: f.taxonomyCombinators?.species || 'AND' },
        { set: subspeciesSet, value: item.subspecies, combinator: f.taxonomyCombinators?.subspecies || 'AND',
          matches: () => matchesSubspeciesSelection(item, subspeciesSet, scope) },
      ].filter(L => L.set)
      if (taxLevels.length > 0) {
        const levelMatches = level => level.matches ? level.matches() : level.set.has(level.value)
        let taxResult = levelMatches(taxLevels[0])
        for (let i = 1; i < taxLevels.length; i++) {
          const match = levelMatches(taxLevels[i])
          taxResult = taxLevels[i].combinator === 'OR' ? (taxResult || match) : (taxResult && match)
        }
        if (!taxResult) return false
      }
      if (mimicrySet && !mimicrySet.has(item.mimicry_ring)) return false
      if (statusSet && !statusSet.has(item.sequencing_status)) return false
      if (sourceSet && !sourceSet.has(item.source)) return false
      if (countrySet && !countrySet.has(item.country)) return false
      if (collectionLocationSet && !collectionLocationSet.has(item.collection_location)) return false
      if (f.sex !== 'all') {
        if (f.sex === 'male' && item.sex !== 'male') return false
        if (f.sex === 'female' && item.sex !== 'female') return false
      }

      if (hasDateFilter) {
        const itemDateStr = item.observation_date || item.date || item.preservation_date
        const d = parseDate(itemDateStr)
        if (!d) return false
        if (dateStart && d < dateStart) return false
        if (dateEnd && d > dateEnd) return false
      }

      if (bb) {
        if (item.lng < bb.sw.lng || item.lng > bb.ne.lng ||
            item.lat < bb.sw.lat || item.lat > bb.ne.lat) return false
      }

      if (hasGoatFilter && datasetStore.goatLoaded) {
        const inGoat = datasetStore.hasGoatData(item.scientific_name)
        const hasDirect = datasetStore.hasDirectGoatData(item.scientific_name)

        if (f.goatCoverage === 'in_goat' && !inGoat) return false
        if (f.goatCoverage === 'not_in_goat' && inGoat) return false

        if (goatDataSourceSet) {
          const wantDirect = goatDataSourceSet.has('direct')
          const wantEstimated = goatDataSourceSet.has('estimated')
          const wantNone = goatDataSourceSet.has('none')

          let passes = false
          if (wantDirect && hasDirect) passes = true
          if (wantEstimated && inGoat && !hasDirect) passes = true
          if (wantNone && !inGoat) passes = true
          if (!passes) return false
        }

        if (f.goatChromosomeMin != null || f.goatChromosomeMax != null) {
          const chrData = datasetStore.getChromosomeNumber(item.scientific_name)
          if (!chrData) return false
          const chrVal = chrData.value
          if (f.goatChromosomeMin != null && chrVal < f.goatChromosomeMin) return false
          if (f.goatChromosomeMax != null && chrVal > f.goatChromosomeMax) return false
        }
      }

      return true
    })

    const result = {
      type: 'FeatureCollection',
      features: filtered.map(getFeatureWrapper),
    }
    log.perf.end('filteredGeoJSON', `${datasetStore.allFeatures.length} → ${filtered.length} features`)
    return result
  })

  const appendFilterURLParams = (params) => {
    const f = filters.value

    if (f.family.length > 0) params.set('family', f.family.join(','))
    if (f.tribe.length > 0) params.set('tribe', f.tribe.join(','))
    if (f.genus.length > 0) params.set('genus', f.genus.join(','))
    if (f.species.length > 0) params.set('sp', f.species.join(','))
    if (f.subspecies.length > 0) params.set('ssp', f.subspecies.join(','))
    if (f.mimicry.length > 0) params.set('mim', f.mimicry.join(','))
    if (f.status.length > 0) params.set('status', f.status.join(','))
    if (f.source.length > 0 && !(f.source.length === 1 && f.source[0] === 'Sanger Institute')) {
      params.set('source', f.source.join(','))
    }
    if (f.country.length > 0) params.set('country', f.country.join(','))
    if (f.collectionLocation.length > 0) params.set('locality', JSON.stringify(f.collectionLocation))
    if (f.sex !== 'all') params.set('sex', f.sex)
    if (f.camidSearch) params.set('cam', f.camidSearch)
    if (f.dateStart) params.set('from', f.dateStart)
    if (f.dateEnd) params.set('to', f.dateEnd)
    if (f.goatCoverage !== 'all') params.set('goat', f.goatCoverage)
    if (f.goatDataSource.length > 0) params.set('goat_src', f.goatDataSource.join(','))
    if (f.goatChromosomeMin != null) params.set('chr_min', f.goatChromosomeMin)
    if (f.goatChromosomeMax != null) params.set('chr_max', f.goatChromosomeMax)
    const c = f.taxonomyCombinators
    if (c && (c.tribe === 'OR' || c.genus === 'OR' || c.species === 'OR' || c.subspecies === 'OR')) {
      const code = [c.tribe, c.genus, c.species, c.subspecies].map(v => v === 'OR' ? 'O' : 'A').join('')
      params.set('tax_combo', code)
    }
  }

  watch(showAdvancedFilters, value => setStorage('app-show-advanced-filters', value))
  watch(showMimicryFilter, value => setStorage('app-show-mimicry-filter', value))
  watch(showGoatFilter, value => setStorage('app-show-goat-filter', value))

  return {
    filters,
    showAdvancedFilters,
    showMimicryFilter,
    showGoatFilter,
    focusPoint,
    gallerySelection,
    boundingBox,
    uniqueFamilies,
    uniqueTribes,
    uniqueGenera,
    uniqueSpecies,
    speciesFilterOptions,
    filterSpeciesOptions,
    uniqueSubspecies,
    uniqueMimicry,
    availableMimicryRings,
    unavailableMimicryRings,
    uniqueStatuses,
    uniqueSources,
    uniqueCountries,
    uniqueCollectionLocations,
    subspeciesScope,
    taxonTargets,
    subspeciesOptionGroups,
    uniqueCamids,
    temporalDistribution,
    filteredGeoJSON,
    loadSourcesForFilters,
    restoreFiltersFromURL,
    resetAllFilters,
    appendFilterURLParams,
  }
})
