<script setup>
import { ref, computed, watch, inject } from 'vue'
import { useDataStore } from '../stores/data'
import { useHostPlantStore } from '../stores/hostPlants'
import { parseDate } from '../utils/dateHelpers'
import { getStatusColor } from '../utils/constants'
import { getTableThumbnailUrl } from '../utils/imageProxy'
import { getCorrectionInfo, getGoatUrl } from '../utils/goatHelpers'
import { useTableSort } from '../composables/useTableSort'
import { useColumnResize } from '../composables/useColumnResize'
import { rowsToCsv, downloadCsv } from '../utils/tableExport'
import { useThemeStore } from '../stores/theme'
import { getThemeOptions } from '../themes/presets'
import { Sun, Moon, Palette } from 'lucide-vue-next'

const store = useDataStore()
const hostPlantStore = useHostPlantStore()
const themeStore = useThemeStore()
const openImageGallery = inject('openImageGallery')

// Pagination
const pageSize = ref(50)
const currentPage = ref(1)
const tableView = ref('records')
const hostPlantTableMode = ref('butterflies')
const expandedHostButterflies = ref(new Set())
const showThemeDropdown = ref(false)
const themeOptions = getThemeOptions()

const selectTheme = (themeKey) => {
  themeStore.setTheme(themeKey)
  showThemeDropdown.value = false
}

const currentThemeName = computed(() => {
  return themeStore.availableThemes[themeStore.currentTheme]?.name || 'Emerald'
})

// Drag-to-resize column widths (shared across all table views, namespaced).
const { getWidth: getColWidth, startResize: startColResize } = useColumnResize()
const colStyle = (ns, col) => {
  const resized = getColWidth(ns, col.key, null)
  if (resized) return { width: resized, minWidth: resized, maxWidth: resized }
  return { width: col.width }
}

const toggleThemeMode = () => {
  themeStore.toggleMode()
}


// Column visibility
const visibleColumns = ref({
  photo: true,
  id: true,
  scientific_name: true,
  subspecies: true,
  goat_chromosome: true,
  goat_genome: false,
  sex: true,
  mimicry_ring: true,
  sequencing_status: true,
  source: true,
  spatial_check: true,
  curated: true,
  observation_date: true,
  country: true,
  lat: false,
  lng: false,
})

// Column definitions
const columns = [
  { key: 'photo', label: 'Photo', width: '70px' },
  { key: 'id', label: 'ID', width: '120px' },
  { key: 'scientific_name', label: 'Species', width: '200px' },
  { key: 'subspecies', label: 'Subspecies', width: '130px' },
  { key: 'goat_chromosome', label: '2n', width: '100px' },
  { key: 'goat_genome', label: 'Genome', width: '120px' },
  { key: 'sex', label: 'Sex', width: '70px' },
  { key: 'mimicry_ring', label: 'Mimicry Ring', width: '120px' },
  { key: 'sequencing_status', label: 'Status', width: '130px' },
  { key: 'source', label: 'Source', width: '130px' },
  { key: 'spatial_check', label: 'Spatial check', width: '145px' },
  { key: 'curated', label: 'Curated', width: '130px' },
  { key: 'observation_date', label: 'Date', width: '130px' },
  { key: 'country', label: 'Country', width: '100px' },
  { key: 'lat', label: 'Latitude', width: '90px' },
  { key: 'lng', label: 'Longitude', width: '90px' },
]


// Get raw data from filtered GeoJSON
const rawData = computed(() => {
  const geo = store.filteredGeoJSON
  if (!geo || !geo.features) return []
  return geo.features.map(f => f.properties)
})

const getSpatialCheck = (row) => row.spatial_check || 'OK'

const columnFilteredData = computed(() => {
  const data = rawData.value
  const filters = columnFilters.value
  const skipFilters = new Set(['goat_chromosome_min', 'goat_chromosome_max', 'date_year_min', 'date_year_max'])
  const activeFilters = Object.entries(filters).filter(([k, v]) => !skipFilters.has(k) && v && String(v).trim())

  if (activeFilters.length === 0) return data

  return data.filter(row => {
    return activeFilters.every(([col, filterVal]) => {
      const val = String(filterVal).trim().toLowerCase()

      if (col === 'photo') {
        const hasPhoto = !!store.getPhotoForItem(row)
        return val === 'has' ? hasPhoto : !hasPhoto
      }

      if (col === 'goat_chromosome') {
        const chr = store.getChromosomeNumber(row.scientific_name)
        if (!chr) return false
        const chrVal = chr.value
        if (val.includes('-')) {
          const [min, max] = val.split('-').map(Number)
          return chrVal >= min && chrVal <= max
        }
        return String(chrVal).includes(val)
      }

      if (col === 'goat_genome') {
        const hasDirect = store.hasDirectGoatData(row.scientific_name)
        const hasData = store.hasGoatData(row.scientific_name)
        const status = hasDirect ? 'direct' : hasData ? 'estimated' : 'none'
        return status === val
      }

      if (col === 'observation_date') {
        const dateStr = row.observation_date || ''
        if (val === '__year_range__' || val === '__year_min__' || val === '__year_max__') {
          const yearMatch = dateStr.match(/(\d{2,4})$/)
          if (!yearMatch) return false
          let year = parseInt(yearMatch[1])
          if (year < 100) year += 2000
          const minYear = parseInt(columnFilters.value.date_year_min) || 0
          const maxYear = parseInt(columnFilters.value.date_year_max) || 9999
          return year >= minYear && year <= maxYear
        }
        return dateStr.toLowerCase().includes(val)
      }

      if (col === 'curated') {
        const info = getCorrectionInfo(row)
        const type = info ? info.type.toLowerCase() : ''
        return type.includes(val)
      }

      if (col === 'spatial_check') {
        return getSpatialCheck(row).toLowerCase() === val
      }

      const cellVal = String(row[col] || '').toLowerCase()
      return cellVal.includes(val)
    })
  })
})

const {
  sortKey,
  sortDirection,
  sortedData,
  toggleSort: toggleTableSort
} = useTableSort(columnFilteredData, {
  defaultSortKey: 'scientific_name',
  defaultDirection: 'asc',
  unsortableColumns: ['photo'],
  compareRows: (a, b, column, direction) => {
    let valA = a[column] || ''
    let valB = b[column] || ''

    if (column === 'lat' || column === 'lng') {
      valA = parseFloat(valA) || 0
      valB = parseFloat(valB) || 0
    } else if (column === 'curated') {
      const infoA = getCorrectionInfo(a)
      const infoB = getCorrectionInfo(b)
      valA = infoA ? infoA.type : ''
      valB = infoB ? infoB.type : ''
    } else if (column === 'observation_date') {
      const dateA = parseDate(valA)
      const dateB = parseDate(valB)
      if (!dateA && !dateB) return 0
      if (!dateA) return 1
      if (!dateB) return -1
      valA = dateA.getTime()
      valB = dateB.getTime()
    } else if (column === 'goat_chromosome') {
      const chrA = store.getChromosomeNumber(a.scientific_name)
      const chrB = store.getChromosomeNumber(b.scientific_name)
      valA = chrA ? chrA.value : -1
      valB = chrB ? chrB.value : -1
    } else if (column === 'goat_genome') {
      valA = store.hasDirectGoatData(a.scientific_name) ? 2 : store.hasGoatData(a.scientific_name) ? 1 : 0
      valB = store.hasDirectGoatData(b.scientific_name) ? 2 : store.hasGoatData(b.scientific_name) ? 1 : 0
    } else {
      valA = String(valA).toLowerCase()
      valB = String(valB).toLowerCase()
    }

    if (valA < valB) return direction === 'asc' ? -1 : 1
    if (valA > valB) return direction === 'asc' ? 1 : -1
    return 0
  }
})

const sortColumn = sortKey

// Paginated data
const paginatedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return sortedData.value.slice(start, end)
})

// Total pages
const totalPages = computed(() => Math.ceil(activeTableCount.value / pageSize.value))

// Page numbers to display
const visiblePages = computed(() => {
  const pages = []
  const total = totalPages.value
  const current = currentPage.value
  
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    
    if (current > 3) pages.push('...')
    
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)
    
    for (let i = start; i <= end; i++) pages.push(i)
    
    if (current < total - 2) pages.push('...')
    
    pages.push(total)
  }
  
  return pages
})

// Reset to page 1 when data changes
watch(rawData, () => {
  currentPage.value = 1
})

watch(tableView, (view) => {
  currentPage.value = 1
  if (view === 'hostplants') hostPlantStore.loadMetadata().catch(() => {})
})

watch(hostPlantTableMode, () => {
  currentPage.value = 1
})

// Sort handler
const toggleSort = (column) => {
  if (!toggleTableSort(column)) return
  currentPage.value = 1
}

// Column toggle panel
const showColumnSettings = ref(false)
const showColumnFilters = ref(false)
const columnFilters = ref({})

const clearColumnFilters = () => {
  columnFilters.value = {}
}

const activeFilterCount = computed(() => {
  const skip = new Set(['goat_chromosome_min', 'goat_chromosome_max', 'date_year_min', 'date_year_max'])
  return Object.entries(columnFilters.value).filter(([k, v]) => !skip.has(k) && v && String(v).trim()).length
})

const getFilterPlaceholder = (key) => {
  const placeholders = {
    id: 'Filter ID...',
    scientific_name: 'Filter species...',
    subspecies: 'Filter...',
    goat_chromosome: 'e.g. 30 or 20-40',
    goat_genome: 'direct/est.',
    sex: 'Filter...',
    mimicry_ring: 'Filter...',
    sequencing_status: 'Filter...',
    source: 'Filter...',
    spatial_check: 'Filter...',
    curated: 'Filter...',
    observation_date: 'e.g. 2023',
    country: 'Filter...',
    lat: 'Filter...',
    lng: 'Filter...',
  }
  return placeholders[key] || 'Filter...'
}

const uniqueValues = (key) => {
  const vals = new Set()
  for (const row of rawData.value) {
    const v = key === 'spatial_check' ? getSpatialCheck(row) : row[key]
    if (v && v !== 'Unknown') vals.add(v)
  }
  return [...vals].sort()
}

const uniqueAssemblyLevels = computed(() => {
  const vals = new Set()
  for (const sp of Object.values(store.goatSpecies)) {
    const al = sp.assembly_level
    if (al?.value && al.source === 'direct') vals.add(al.value)
  }
  return [...vals].sort()
})

const syncChromosomeFilter = () => {
  const min = columnFilters.value.goat_chromosome_min
  const max = columnFilters.value.goat_chromosome_max
  if (min || max) {
    columnFilters.value.goat_chromosome = `${min || '0'}-${max || '999'}`
  } else {
    delete columnFilters.value.goat_chromosome
  }
}

const syncDateFilter = () => {
  const min = columnFilters.value.date_year_min
  const max = columnFilters.value.date_year_max
  if (min && max) {
    columnFilters.value.observation_date = '__year_range__'
  } else if (min) {
    columnFilters.value.observation_date = '__year_min__'
  } else if (max) {
    columnFilters.value.observation_date = '__year_max__'
  } else {
    delete columnFilters.value.observation_date
  }
}

const speciesData = computed(() => {
  if (tableView.value !== 'species') return []

  const speciesMap = new Map()
  for (const row of rawData.value) {
    const name = row.scientific_name
    if (!name || speciesMap.has(name)) continue

    const goat = store.getGoatForSpecies(name)
    const chr = store.getChromosomeNumber(name)
    const hasDirect = store.hasDirectGoatData(name)
    const hasData = store.hasGoatData(name)

    speciesMap.set(name, {
      scientific_name: name,
      records: rawData.value.filter(r => r.scientific_name === name).length,
      chromosome_number: chr?.value ?? null,
      chr_source: chr?.source ?? null,
      genome_size: goat?.genome_size?.value ?? null,
      genome_size_source: goat?.genome_size?.source ?? null,
      haploid_number: goat?.haploid_number?.value ?? null,
      assembly_level: goat?.assembly_level?.value ?? null,
      bioproject: goat?.bioproject?.value ?? null,
      goat_status: hasDirect ? 'Direct' : hasData ? 'Estimated' : 'No data',
      taxon_id: goat?.taxon_id ?? null,
    })
  }

  return [...speciesMap.values()]
})

const filteredSpeciesData = computed(() => {
  const data = speciesData.value
  const filters = columnFilters.value
  const skipKeys = new Set(['goat_chromosome_min', 'goat_chromosome_max', 'date_year_min', 'date_year_max', 'photo'])
  const active = Object.entries(filters).filter(([k, v]) => !skipKeys.has(k) && v && String(v).trim())
  if (active.length === 0) return data

  return data.filter(sp => {
    return active.every(([col, filterVal]) => {
      const val = String(filterVal).trim().toLowerCase()

      if (col === 'scientific_name') return sp.scientific_name.toLowerCase().includes(val)
      if (col === 'goat_status') {
        const status = sp.goat_status.toLowerCase()
        if (val === 'direct') return status === 'direct'
        if (val === 'estimated') return status === 'estimated'
        if (val === 'none') return status === 'no data'
        return status.includes(val)
      }
      if (col === 'chromosome_number' || col === 'goat_chromosome') {
        if (sp.chromosome_number == null) return false
        if (val.includes('-')) {
          const [min, max] = val.split('-').map(Number)
          return sp.chromosome_number >= min && sp.chromosome_number <= max
        }
        return String(sp.chromosome_number).includes(val)
      }
      if (col === 'genome_size') {
        if (val === 'has') return sp.genome_size != null
        if (val === 'none') return sp.genome_size == null
        return sp.genome_size != null
      }
      if (col === 'assembly_level') {
        if (!val) return true
        return (sp.assembly_level || '').toLowerCase() === val.toLowerCase()
      }
      if (col === 'bioproject') {
        if (val === 'has') return !!sp.bioproject
        if (val === 'no' || val === 'none') return !sp.bioproject
        return String(sp.bioproject || '').toLowerCase().includes(val)
      }
      return String(sp[col] || '').toLowerCase().includes(val)
    })
  })
})

const sortedSpeciesData = computed(() => {
  const data = [...filteredSpeciesData.value]
  data.sort((a, b) => {
    let valA, valB
    const col = sortColumn.value

    if (col === 'goat_chromosome' || col === 'chromosome_number') {
      valA = a.chromosome_number ?? -1
      valB = b.chromosome_number ?? -1
    } else if (col === 'genome_size') {
      valA = a.genome_size ?? -1
      valB = b.genome_size ?? -1
    } else if (col === 'records') {
      valA = a.records
      valB = b.records
    } else {
      valA = String(a[col] || '').toLowerCase()
      valB = String(b[col] || '').toLowerCase()
    }

    if (valA < valB) return sortDirection.value === 'asc' ? -1 : 1
    if (valA > valB) return sortDirection.value === 'asc' ? 1 : -1
    return 0
  })
  return data
})

const paginatedSpeciesData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sortedSpeciesData.value.slice(start, start + pageSize.value)
})

const speciesColumns = [
  { key: 'scientific_name', label: 'Species', width: '200px' },
  { key: 'records', label: 'Records', width: '80px' },
  { key: 'goat_status', label: 'GoaT Status', width: '100px' },
  { key: 'chromosome_number', label: '2n', width: '70px' },
  { key: 'haploid_number', label: 'n', width: '60px' },
  { key: 'genome_size', label: 'Genome Size', width: '120px' },
  { key: 'assembly_level', label: 'Assembly', width: '120px' },
  { key: 'bioproject', label: 'BioProject', width: '130px' },
]

const activeButterflySpecies = computed(() => new Set(
  rawData.value.map(row => row.scientific_name).filter(Boolean)
))

const normalizeHostName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

const acceptedHostName = (taxon) => {
  const resolution = taxon?.gbif_resolution || {}
  const originalName = taxon?.canonical_name
  const resolvedName = resolution.accepted_canonical_name
    || resolution.accepted_scientific_name
    || resolution.canonical_name
    || resolution.genus
    || resolution.scientific_name
  const status = String(resolution.taxonomic_status || '').toUpperCase()
  const isSynonym = status === 'SYNONYM' || Boolean(resolution.accepted_usage_key)
  const isCorrectedName = originalName && resolvedName && normalizeHostName(resolvedName) !== normalizeHostName(originalName)
  return (isSynonym || isCorrectedName) && isCorrectedName && resolvedName ? resolvedName : null
}

const hostDisplayTitle = (plant) => [
  `${plant.rank} / ${plant.host_id_level}`,
  plant.accepted_name ? `Accepted: ${plant.accepted_name}` : null,
  plant.family,
  plant.evidence_display,
  plant.evidence_detail,
  `${Number(plant.gbif_records || 0).toLocaleString()} GBIF records`,
].filter(Boolean).join('; ')

const hostPlantEvidenceRows = computed(() => {
  const activeSpecies = activeButterflySpecies.value
  const rows = []
  for (const association of hostPlantStore.associations) {
    if (!association.butterfly_taxon || !activeSpecies.has(association.butterfly_taxon)) continue
    const taxon = hostPlantStore.taxaBySlug.get(association.host_taxon_slug)
    const source = association.citation_for_ui
      || association.source_citation
      || association.source_refs
      || '—'
    rows.push({
      id: association.id,
      butterfly: association.butterfly_taxon,
      host: association.host_taxon_name,
      reported_as: association.host_plant_name_verbatim,
      accepted_host: acceptedHostName(taxon),
      host_rank: association.host_taxon_rank,
      family: association.host_plant_family || taxon?.family || '—',
      evidence_level: association.evidence_level || 'needs_check',
      evidence_display: hostPlantStore.evidenceLevels.find(level => level.key === association.evidence_level)?.label || 'Needs check',
      host_id_level: association.host_id_level || association.host_taxon_rank,
      confidence: association.confidence === 'needs_check' ? 'needs check' : association.confidence,
      confidence_display: hostPlantStore.confidenceDisplayLabel(association.confidence),
      confidence_bucket: association.confidence_bucket || hostPlantStore.confidenceBucket(association.confidence),
      evidence: association.evidence_detail || association.evidence_basis || association.evidence_type || '—',
      source,
      source_url: association.doi_or_url,
      gbif_records: taxon?.occurrence_count || 0,
      mapped: (taxon?.occurrence_count || 0) > 0,
      notes: association.notes_for_web_app || association.caveats || '',
      searchText: [
        association.butterfly_taxon,
        association.host_taxon_name,
        association.host_plant_name_verbatim,
        acceptedHostName(taxon),
        association.host_taxon_rank,
        association.host_plant_family,
        association.evidence_level,
        association.host_id_level,
        association.evidence_detail,
        association.confidence,
        association.evidence_basis,
        association.evidence_type,
        source,
        association.notes_for_web_app,
        association.caveats,
      ].filter(Boolean).join(' ').toLowerCase(),
    })
  }
  return rows
})

const evidenceRank = { direct: 3, literature: 2, needs_check: 1, unknown: 0 }

const compactSourceLabel = (source) => {
  if (!source || source === '—') return null
  return source
    .replace(/\s+/g, ' ')
    .replace(/Catalogue row\.\s*/i, '')
    .split(/[.;|]/)[0]
    .trim()
}

const hostPlantButterflyRows = computed(() => {
  const byButterfly = new Map()
  for (const row of hostPlantEvidenceRows.value) {
    const entry = byButterfly.get(row.butterfly) || {
      butterfly: row.butterfly,
      hostPlants: new Map(),
      counts: { species: 0, genus: 0, family: 0 },
      families: new Set(),
      sources: new Map(),
      occurrenceBacked: new Set(),
    }
    const existing = entry.hostPlants.get(row.host)
    if (!existing || evidenceRank[row.evidence_level] > evidenceRank[existing.evidence_level]) {
      entry.hostPlants.set(row.host, {
        name: row.host,
        accepted_name: row.accepted_host,
        confidence: row.confidence,
        confidence_bucket: row.confidence_bucket,
        evidence_level: row.evidence_level,
        evidence_display: row.evidence_display,
        evidence_detail: row.evidence,
        host_id_level: row.host_id_level,
        rank: row.host_rank,
        family: row.family,
        gbif_records: row.gbif_records,
      })
    }
    if (entry.counts[row.host_id_level] != null) entry.counts[row.host_id_level] += 1
    if (row.family && row.family !== '—') entry.families.add(row.family)
    const source = compactSourceLabel(row.source)
    if (source && !entry.sources.has(source)) {
      entry.sources.set(source, { label: source, url: row.source_url })
    } else if (source && row.source_url && !entry.sources.get(source)?.url) {
      entry.sources.set(source, { label: source, url: row.source_url })
    }
    if (row.mapped) entry.occurrenceBacked.add(row.host)
    byButterfly.set(row.butterfly, entry)
  }

  return [...byButterfly.values()].map(entry => {
    const hosts = [...entry.hostPlants.values()].sort((a, b) => {
      const rankDiff = evidenceRank[b.evidence_level] - evidenceRank[a.evidence_level]
      if (rankDiff) return rankDiff
      return a.name.localeCompare(b.name)
    })
    return {
      butterfly: entry.butterfly,
      hostPlants: hosts,
      host_count: hosts.length,
      counts: entry.counts,
      families: [...entry.families].sort(),
      sources: [...entry.sources.keys()].sort(),
      sourceLinks: [...entry.sources.values()].sort((a, b) => a.label.localeCompare(b.label)),
      occurrence_backed_count: entry.occurrenceBacked.size,
      searchText: [
        entry.butterfly,
        ...hosts.map(host => host.name),
        // Include corrected/accepted names so the filter matches either the
        // originally reported name or the GBIF-resolved one.
        ...hosts.map(host => host.accepted_name).filter(Boolean),
        ...entry.families,
        ...entry.sources.keys(),
      ].join(' ').toLowerCase(),
    }
  })
})

const filteredHostPlantButterflyRows = computed(() => {
  const data = hostPlantButterflyRows.value
  const query = String(columnFilters.value.hostplants || columnFilters.value.scientific_name || '').trim().toLowerCase()
  if (!query) return data
  return data.filter(row => row.searchText.includes(query))
})

const filteredHostPlantEvidenceRows = computed(() => {
  const filters = columnFilters.value
  return hostPlantEvidenceRows.value.filter(row => {
    const butterfly = String(filters.butterfly || filters.scientific_name || '').trim().toLowerCase()
    const host = String(filters.host || '').trim().toLowerCase()
    const confidence = String(filters.confidence || '').trim().toLowerCase()
    const family = String(filters.family || '').trim().toLowerCase()
    const source = String(filters.source || '').trim().toLowerCase()
    const mapped = String(filters.mapped || '').trim().toLowerCase()
    if (butterfly && !row.butterfly.toLowerCase().includes(butterfly)) return false
    // Match either the originally reported host name or the corrected/accepted one.
    if (host && !`${row.host} ${row.accepted_host || ''}`.toLowerCase().includes(host)) return false
    if (confidence && row.evidence_level.toLowerCase() !== confidence) return false
    if (family && row.family.toLowerCase() !== family) return false
    if (source && !row.source.toLowerCase().includes(source)) return false
    if (mapped === 'yes' && !row.mapped) return false
    if (mapped === 'no' && row.mapped) return false
    return true
  })
})

const sortedHostPlantButterflyRows = computed(() => {
  const data = [...filteredHostPlantButterflyRows.value]
  data.sort((a, b) => {
    const col = sortColumn.value
    let valA = a[col]
    let valB = b[col]
    if (col === 'host_count') {
      valA = a.host_count
      valB = b.host_count
    } else if (col === 'occurrence_backed_count') {
      valA = a.occurrence_backed_count
      valB = b.occurrence_backed_count
    } else if (col === 'species') {
      valA = a.counts.species
      valB = b.counts.species
    } else if (col === 'genus') {
      valA = a.counts.genus
      valB = b.counts.genus
    } else if (col === 'family') {
      valA = a.counts.family
      valB = b.counts.family
    } else {
      valA = String(valA || '').toLowerCase()
      valB = String(valB || '').toLowerCase()
    }
    if (valA < valB) return sortDirection.value === 'asc' ? -1 : 1
    if (valA > valB) return sortDirection.value === 'asc' ? 1 : -1
    return 0
  })
  return data
})

const sortedHostPlantEvidenceRows = computed(() => {
  const data = [...filteredHostPlantEvidenceRows.value]
  data.sort((a, b) => {
    const col = sortColumn.value
    let valA = a[col]
    let valB = b[col]
    if (col === 'gbif_records') {
      valA = a.gbif_records
      valB = b.gbif_records
    } else if (col === 'evidence_level') {
      valA = evidenceRank[a.evidence_level] || 0
      valB = evidenceRank[b.evidence_level] || 0
    } else {
      valA = String(valA || '').toLowerCase()
      valB = String(valB || '').toLowerCase()
    }
    if (valA < valB) return sortDirection.value === 'asc' ? -1 : 1
    if (valA > valB) return sortDirection.value === 'asc' ? 1 : -1
    return 0
  })
  return data
})

const paginatedHostPlantButterflyRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sortedHostPlantButterflyRows.value.slice(start, start + pageSize.value)
})

const paginatedHostPlantEvidenceRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sortedHostPlantEvidenceRows.value.slice(start, start + pageSize.value)
})

const hostPlantButterflyColumns = [
  { key: 'butterfly', label: 'Butterfly species', width: '220px' },
  { key: 'host_count', label: 'Host plants', width: '420px' },
  { key: 'species', label: 'Species', width: '95px' },
  { key: 'genus', label: 'Genus', width: '95px' },
  { key: 'family', label: 'Family', width: '95px' },
  { key: 'families', label: 'Families', width: '180px' },
  { key: 'occurrence_backed_count', label: 'Mapped taxa', width: '105px' },
  { key: 'sources', label: 'Sources', width: '260px' },
]

const hostPlantEvidenceColumns = [
  { key: 'butterfly', label: 'Butterfly species', width: '210px' },
  { key: 'host', label: 'Host plant', width: '220px' },
  { key: 'reported_as', label: 'Reported as', width: '220px' },
  { key: 'host_rank', label: 'Host rank / ID level', width: '120px' },
  { key: 'family', label: 'Family', width: '130px' },
  { key: 'evidence_level', label: 'Evidence', width: '110px' },
  { key: 'evidence', label: 'Evidence basis', width: '280px' },
  { key: 'source', label: 'Source', width: '280px' },
  { key: 'gbif_records', label: 'GBIF records', width: '110px' },
  { key: 'mapped', label: 'Mapped', width: '80px' },
  { key: 'notes', label: 'Notes', width: '320px' },
]

// Column visibility for the host-plant tables (the records table has its own
// visibleColumns above; the species table shows all columns).
const HOST_BUTTERFLY_ANCHOR = 'butterfly'
const visibleHostButterflyColumns = ref(Object.fromEntries(hostPlantButterflyColumns.map(c => [c.key, true])))
const visibleHostEvidenceColumns = ref(Object.fromEntries(hostPlantEvidenceColumns.map(c => [c.key, true])))
const activeHostButterflyColumns = computed(() => hostPlantButterflyColumns.filter(c => visibleHostButterflyColumns.value[c.key]))
const activeHostEvidenceColumns = computed(() => hostPlantEvidenceColumns.filter(c => visibleHostEvidenceColumns.value[c.key]))

// Descriptor consumed by the column-settings dropdown for the host-plant views.
const hostColumnToggle = computed(() => {
  if (tableView.value !== 'hostplants') return null
  return hostPlantTableMode.value === 'butterflies'
    ? { columns: hostPlantButterflyColumns, visible: visibleHostButterflyColumns.value, lockedKey: HOST_BUTTERFLY_ANCHOR }
    : { columns: hostPlantEvidenceColumns, visible: visibleHostEvidenceColumns.value, lockedKey: null }
})

const activeTableCount = computed(() => {
  if (tableView.value === 'species') return filteredSpeciesData.value.length
  if (tableView.value === 'hostplants') {
    return hostPlantTableMode.value === 'butterflies'
      ? filteredHostPlantButterflyRows.value.length
      : filteredHostPlantEvidenceRows.value.length
  }
  return sortedData.value.length
})

// Visible columns array for v-for
const activeColumns = computed(() => {
  return columns.filter(col => visibleColumns.value[col.key])
})

// Photo helpers using store's getPhotoForItem
const getPhotoInfo = (row) => {
  return store.getPhotoForItem(row)
}

const openGalleryForRow = (row) => {
  if (!openImageGallery) return
  store.gallerySelection = {
    species: row.scientific_name,
    subspecies: row.subspecies || null,
    individualId: row.id
  }
  openImageGallery()
}

// Image load error handling
const handleImageError = (e, originalUrl) => {
  // Try original URL without proxy if proxy fails
  if (originalUrl && !e.target.src.includes('drive.google.com')) {
    e.target.src = originalUrl
  } else {
    // Hide broken image
    e.target.style.display = 'none'
  }
}

const genusDirectRanges = computed(() => {
  const ranges = {}
  const datasetSpecies = new Set(rawData.value.map(r => r.scientific_name).filter(Boolean))

  for (const name of datasetSpecies) {
    const genus = name.split(' ')[0]
    if (ranges[genus]) continue

    let min = Infinity, max = -Infinity
    const directSpp = []
    for (const sp of datasetSpecies) {
      if (!sp.startsWith(genus + ' ')) continue
      const cn = store.getChromosomeNumber(sp)
      if (cn?.source === 'direct' && cn.value != null) {
        if (cn.value < min) min = cn.value
        if (cn.value > max) max = cn.value
        directSpp.push(sp)
      }
    }

    ranges[genus] = directSpp.length >= 2 && min !== max
      ? { min, max, count: directSpp.length, species: directSpp }
      : null
  }
  return ranges
})

const getGenusDirectRange = (scientificName) => {
  const genus = scientificName.split(' ')[0]
  return genusDirectRanges.value[genus] || null
}

const getChrTooltip = (scientificName) => {
  const chr = store.getChromosomeNumber(scientificName)
  if (!chr) return ''
  if (chr.source === 'direct') {
    return chr.count > 1 ? `Direct measurement (${chr.count} sources)` : 'Direct measurement'
  }
  const genus = scientificName.split(' ')[0]
  const range = getGenusDirectRange(scientificName)
  if (range) {
    return `Estimated (${chr.aggregation_rank || 'genus'}). Genus ${genus}: 2n=${range.min}–${range.max} from ${range.count} species with direct counts`
  }
  return `Estimated from ${chr.aggregation_rank || 'relatives'}`
}

const getSpeciesGoatUrl = (scientificName) => getGoatUrl(scientificName, store.getGoatForSpecies)

const getGenomeSummary = (scientificName) => {
  const goat = store.getGoatForSpecies(scientificName)
  if (!goat) return null
  const hasDirect = store.hasDirectGoatData(scientificName)
  const parts = []
  if (goat.genome_size) {
    let gs = store.formatGenomeSize(goat.genome_size.value)
    if (goat.genome_size.source !== 'direct' && goat.genome_size.aggregation_rank)
      gs += ` (est. from ${goat.genome_size.aggregation_rank})`
    parts.push(gs)
  }
  if (goat.chromosome_number) {
    const cn = goat.chromosome_number
    let chr = `2n=${cn.value}`
    if (cn.source === 'direct') {
      if (cn.count) chr += ` (${cn.count} source${cn.count > 1 ? 's' : ''})`
    } else {
      const range = getGenusDirectRange(scientificName)
      if (range) chr += ` (est., genus: ${range.min}–${range.max})`
      else chr += ` (est. from ${cn.aggregation_rank || 'relatives'})`
    }
    parts.push(chr)
  }
  if (goat.busco_completeness?.source === 'direct')
    parts.push(`BUSCO ${goat.busco_completeness.value}%`)
  if (goat.assembly_level?.source === 'direct')
    parts.push(goat.assembly_level.value)
  return {
    hasDirect,
    label: hasDirect ? 'Direct' : 'Est.',
    detail: parts.join(' · '),
  }
}

const toggleHostButterflyExpanded = (butterfly) => {
  const next = new Set(expandedHostButterflies.value)
  if (next.has(butterfly)) next.delete(butterfly)
  else next.add(butterfly)
  expandedHostButterflies.value = next
}

const hostPlantsByHostIdLevel = (plants) => ({
  species: plants.filter(plant => plant.host_id_level === 'species' || plant.rank === 'species'),
  genus: plants.filter(plant => plant.host_id_level === 'genus' || plant.rank === 'genus'),
  family: plants.filter(plant => plant.host_id_level === 'family' || plant.rank === 'family'),
})

const confidenceClass = (confidence) => {
  const normalized = String(confidence || '').toLowerCase().replace(/\s+/g, '-')
  if (normalized === 'needs-check') return 'low'
  return normalized || 'unknown'
}

const hostLevelClass = (level) => {
  const normalized = String(level || '').toLowerCase().replace(/\s+/g, '-')
  return ['species', 'genus', 'family'].includes(normalized) ? normalized : 'unknown'
}

const conciseList = (items, limit = 3) => {
  if (!items?.length) return '—'
  const visible = items.slice(0, limit).join(', ')
  const extra = items.length > limit ? ` +${items.length - limit} more` : ''
  return `${visible}${extra}`
}

// ---- CSV export (respects active filters, sort, and visible columns) ----
const recordCsvValue = (row, key) => {
  switch (key) {
    case 'goat_chromosome': return store.getChromosomeNumber(row.scientific_name)?.value ?? ''
    case 'goat_genome': return getGenomeSummary(row.scientific_name)?.label ?? ''
    case 'spatial_check': return getSpatialCheck(row)
    case 'curated': return getCorrectionInfo(row)?.type ?? ''
    case 'lat': return row.lat ?? ''
    case 'lng': return row.lng ?? ''
    default: return row[key] ?? ''
  }
}

const speciesCsvValue = (sp, key) => {
  if (key === 'genome_size') return sp.genome_size != null ? store.formatGenomeSize(sp.genome_size) : ''
  return sp[key] ?? ''
}

const hostButterflyCsvValue = (row, key) => {
  switch (key) {
    case 'butterfly': return row.butterfly
    case 'host_count': return row.hostPlants
      .map(p => (p.accepted_name ? `${p.name} -> ${p.accepted_name}` : p.name))
      .join('; ')
    case 'species': return row.counts.species
    case 'genus': return row.counts.genus
    case 'family': return row.counts.family
    case 'families': return row.families.join('; ')
    case 'occurrence_backed_count': return row.occurrence_backed_count
    case 'sources': return row.sources.join('; ')
    default: return row[key] ?? ''
  }
}

const hostEvidenceCsvValue = (row, key) => {
  switch (key) {
    case 'host': return row.accepted_host ? `${row.host} -> ${row.accepted_host}` : row.host
    case 'host_rank': return `${row.host_rank} / ${row.host_id_level}`
    case 'evidence_level': return row.evidence_display
    case 'mapped': return row.mapped ? 'Yes' : 'No'
    default: return row[key] ?? ''
  }
}

const exportTableCsv = () => {
  let cols, rows, valueFn, name
  if (tableView.value === 'species') {
    cols = speciesColumns
    rows = sortedSpeciesData.value
    valueFn = speciesCsvValue
    name = 'species_goat'
  } else if (tableView.value === 'hostplants' && hostPlantTableMode.value === 'butterflies') {
    cols = activeHostButterflyColumns.value
    rows = sortedHostPlantButterflyRows.value
    valueFn = hostButterflyCsvValue
    name = 'host_plants_by_butterfly'
  } else if (tableView.value === 'hostplants') {
    cols = activeHostEvidenceColumns.value
    rows = sortedHostPlantEvidenceRows.value
    valueFn = hostEvidenceCsvValue
    name = 'host_plants_evidence'
  } else {
    cols = activeColumns.value.filter(c => c.key !== 'photo')
    rows = sortedData.value
    valueFn = recordCsvValue
    name = 'records'
  }
  const headers = cols.map(c => ({ label: c.label, value: r => valueFn(r, c.key) }))
  const csv = rowsToCsv(headers, rows)
  const stamp = new Date().toISOString().slice(0, 10)
  downloadCsv(`ithomiini_${name}_${stamp}.csv`, csv)
}
</script>

<template>
  <div class="data-table-container">
    <!-- Header Bar -->
    <div class="table-header">
      <div class="header-left">
        <span class="record-count">
          <strong>{{ activeTableCount.toLocaleString() }}</strong>
          {{
            tableView === 'species'
              ? 'species'
              : tableView === 'hostplants'
                ? (hostPlantTableMode === 'butterflies' ? 'butterflies' : 'host records')
                : 'records'
          }}
          <span v-if="activeFilterCount > 0" class="filter-indicator">(filtered)</span>
        </span>
        <span class="page-info">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
      </div>
      
      <div class="header-right">
        <div class="table-theme-controls">
          <div class="table-theme-dropdown">
            <button
              type="button"
              class="table-theme-trigger"
              @click.stop="showThemeDropdown = !showThemeDropdown"
            >
              <Palette class="layer-icon" />
              <span>{{ currentThemeName }}</span>
              <svg class="chevron" :class="{ open: showThemeDropdown }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            <Transition name="fade">
              <div v-if="showThemeDropdown" class="table-theme-menu">
                <button
                  v-for="option in themeOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: themeStore.currentTheme === option.value }"
                  @click="selectTheme(option.value)"
                >
                  <div
                    class="theme-swatch"
                    :style="{ backgroundColor: themeStore.isDarkMode ? option.previewBgDark : option.previewBgLight }"
                  >
                    <div
                      class="theme-swatch-accent"
                      :style="{ backgroundColor: option.accentColor }"
                    />
                  </div>
                  <span>{{ option.label }}</span>
                </button>
              </div>
            </Transition>
          </div>

          <button
            type="button"
            class="table-mode-toggle"
            :class="{ 'is-light': !themeStore.isDarkMode }"
            @click="toggleThemeMode"
            :title="themeStore.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <Sun v-if="!themeStore.isDarkMode" class="mode-icon" />
            <Moon v-else class="mode-icon" />
          </button>
        </div>

        <div class="view-mode-toggle">
          <button
            :class="{ active: tableView === 'records' }"
            @click="tableView = 'records'; currentPage = 1"
          >Records</button>
          <button
            :class="{ active: tableView === 'species' }"
            @click="tableView = 'species'; currentPage = 1"
          >Species (GoaT)</button>
          <button
            :class="{ active: tableView === 'hostplants' }"
            @click="tableView = 'hostplants'; currentPage = 1"
          >Host Plants</button>
        </div>

        <div v-if="tableView === 'hostplants'" class="view-mode-toggle sub-toggle">
          <button
            :class="{ active: hostPlantTableMode === 'butterflies' }"
            @click="hostPlantTableMode = 'butterflies'"
          >By butterfly</button>
          <button
            :class="{ active: hostPlantTableMode === 'evidence' }"
            @click="hostPlantTableMode = 'evidence'"
          >Evidence rows</button>
        </div>

        <!-- Page Size -->
        <select v-model="pageSize" class="page-size-select" @change="currentPage = 1">
          <option :value="25">25 rows</option>
          <option :value="50">50 rows</option>
          <option :value="100">100 rows</option>
          <option :value="200">200 rows</option>
        </select>

        <button
          class="column-filter-toggle"
          :class="{ active: showColumnFilters }"
          @click="showColumnFilters = !showColumnFilters"
          title="Toggle column filters"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          Filters
          <span v-if="activeFilterCount > 0" class="filter-count">{{ activeFilterCount }}</span>
        </button>

        <!-- Export current table (filters + sort + visible columns applied) -->
        <button
          class="column-filter-toggle"
          @click="exportTableCsv"
          title="Download the current table as CSV (filters applied)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export CSV
        </button>

        <!-- Column Settings -->
        <button
          v-if="tableView === 'records' || tableView === 'hostplants'"
          class="btn-columns"
          @click="showColumnSettings = !showColumnSettings"
          :class="{ active: showColumnSettings }"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          Columns
        </button>

        <!-- Column Settings Dropdown (records) -->
        <Transition name="fade">
          <div v-if="tableView === 'records' && showColumnSettings" class="column-dropdown">
            <label
              v-for="col in columns"
              :key="col.key"
              class="column-toggle"
            >
              <input
                type="checkbox"
                v-model="visibleColumns[col.key]"
              />
              <span>{{ col.label }}</span>
            </label>
          </div>
        </Transition>

        <!-- Column Settings Dropdown (host plants) -->
        <Transition name="fade">
          <div v-if="tableView === 'hostplants' && showColumnSettings && hostColumnToggle" class="column-dropdown">
            <label
              v-for="col in hostColumnToggle.columns"
              :key="col.key"
              class="column-toggle"
              :class="{ locked: col.key === hostColumnToggle.lockedKey }"
            >
              <input
                type="checkbox"
                :checked="hostColumnToggle.visible[col.key]"
                :disabled="col.key === hostColumnToggle.lockedKey"
                @change="hostColumnToggle.visible[col.key] = $event.target.checked"
              />
              <span>{{ col.label }}</span>
            </label>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Table -->
    <div class="table-wrapper">
      <table v-if="tableView === 'records'" class="data-table">
        <thead>
          <tr>
            <th
              v-for="col in activeColumns"
              :key="col.key"
              :style="colStyle('records', col)"
              @click="toggleSort(col.key)"
              class="sortable"
              :class="{ sorted: sortColumn === col.key, 'no-sort': col.key === 'photo' }"
            >
              <div class="th-content">
                <span>{{ col.label }}</span>
                <svg
                  v-if="sortColumn === col.key && col.key !== 'photo'"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="sort-icon"
                  :class="{ desc: sortDirection === 'desc' }"
                >
                  <path d="m18 15-6-6-6 6"/>
                </svg>
              </div>
              <span class="col-resize-handle" @mousedown.stop.prevent="startColResize($event, 'records', col.key)" @click.stop></span>
            </th>
          </tr>
          <tr v-if="showColumnFilters" class="filter-row">
            <th v-for="col in activeColumns" :key="'filter-' + col.key" class="filter-cell">
              <template v-if="col.key === 'photo'">
                <select class="column-filter-select filter-select-narrow" v-model="columnFilters.photo">
                  <option value="">All</option>
                  <option value="has">Has</option>
                  <option value="no">None</option>
                </select>
              </template>

              <template v-else-if="col.key === 'goat_chromosome'">
                <div class="filter-range">
                  <input type="number" class="column-filter-input range-input" placeholder="Min" v-model="columnFilters.goat_chromosome_min" @input="syncChromosomeFilter" />
                  <span class="range-sep">–</span>
                  <input type="number" class="column-filter-input range-input" placeholder="Max" v-model="columnFilters.goat_chromosome_max" @input="syncChromosomeFilter" />
                </div>
              </template>

              <template v-else-if="col.key === 'observation_date'">
                <div class="filter-range">
                  <input type="number" class="column-filter-input range-input" placeholder="From" v-model="columnFilters.date_year_min" min="2000" max="2030" @input="syncDateFilter" />
                  <span class="range-sep">–</span>
                  <input type="number" class="column-filter-input range-input" placeholder="To" v-model="columnFilters.date_year_max" min="2000" max="2030" @input="syncDateFilter" />
                </div>
              </template>

              <select
                v-else-if="col.key === 'sex'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>

              <select
                v-else-if="col.key === 'goat_genome'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option value="direct">Direct</option>
                <option value="estimated">Estimated</option>
                <option value="none">No data</option>
              </select>

              <select
                v-else-if="col.key === 'sequencing_status'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option v-for="val in uniqueValues('sequencing_status')" :key="val" :value="val">{{ val }}</option>
              </select>

              <select
                v-else-if="col.key === 'source'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option v-for="val in uniqueValues('source')" :key="val" :value="val">{{ val }}</option>
              </select>

              <select
                v-else-if="col.key === 'spatial_check'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option v-for="val in uniqueValues('spatial_check')" :key="val" :value="val">{{ val }}</option>
              </select>

              <select
                v-else-if="col.key === 'country'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option v-for="val in uniqueValues('country')" :key="val" :value="val">{{ val }}</option>
              </select>

              <select
                v-else-if="col.key === 'mimicry_ring'"
                class="column-filter-select"
                v-model="columnFilters[col.key]"
              >
                <option value="">All</option>
                <option v-for="val in uniqueValues('mimicry_ring')" :key="val" :value="val">{{ val }}</option>
              </select>

              <input
                v-else
                type="text"
                class="column-filter-input"
                :placeholder="getFilterPlaceholder(col.key)"
                v-model="columnFilters[col.key]"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in paginatedData" :key="row.id || idx">
            <!-- Photo Column -->
            <td v-if="visibleColumns.photo" class="cell-photo">
              <div class="photo-cell">
                <template v-if="getPhotoInfo(row)">
                  <div class="photo-wrapper" :class="{ 'other-individual': !getPhotoInfo(row).sameIndividual }" @click="openGalleryForRow(row)">
                    <img
                      :src="getTableThumbnailUrl(getPhotoInfo(row).url)"
                      @error="(e) => handleImageError(e, getPhotoInfo(row).url)"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      :title="getPhotoInfo(row).sameIndividual ? 'Photo of this individual' : 'Photo from another individual of same species'"
                    />
                    <span 
                      v-if="!getPhotoInfo(row).sameIndividual" 
                      class="other-indicator"
                      title="Photo from another individual"
                    >
                      ≠
                    </span>
                  </div>
                </template>
                <span v-else class="no-photo">—</span>
              </div>
            </td>
            <td v-if="visibleColumns.id" class="cell-id">
              {{ row.id }}
            </td>
            <td
              v-if="visibleColumns.scientific_name"
              class="cell-species"
              :class="{ 'cell-corrected': row.scientific_name_original }"
            >
              <em>{{ row.scientific_name }}</em>
              <span
                v-if="row.scientific_name_original"
                class="original-value"
                :title="`Original: ${row.scientific_name_original}`"
              >
                was: <em>{{ row.scientific_name_original }}</em>
              </span>
            </td>
            <td
              v-if="visibleColumns.subspecies"
              class="cell-subspecies"
              :class="{ 'cell-corrected': row.subspecies_original }"
            >
              {{ row.subspecies || '—' }}
              <span
                v-if="row.subspecies_original"
                class="original-value"
                :title="`Original: ${row.subspecies_original}`"
              >
                was: <em>{{ row.subspecies_original }}</em>
              </span>
            </td>
            <td v-if="visibleColumns.goat_chromosome" class="cell-chr">
              <template v-if="store.getChromosomeNumber(row.scientific_name)">
                <span class="chr-value" :title="getChrTooltip(row.scientific_name)">
                  {{ store.getChromosomeNumber(row.scientific_name).value }}
                  <span v-if="store.getChromosomeNumber(row.scientific_name).source !== 'direct'" class="chr-est">(est.)</span>
                </span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleColumns.goat_genome" class="cell-genome">
              <template v-if="getGenomeSummary(row.scientific_name)">
                <a v-if="getSpeciesGoatUrl(row.scientific_name)" :href="getSpeciesGoatUrl(row.scientific_name)" target="_blank" rel="noopener noreferrer"
                  class="genome-link" :class="{ direct: getGenomeSummary(row.scientific_name).hasDirect }"
                  :title="getGenomeSummary(row.scientific_name).detail">
                  {{ getGenomeSummary(row.scientific_name).label }}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                <span v-else class="genome-text" :class="{ direct: getGenomeSummary(row.scientific_name).hasDirect, estimated: !getGenomeSummary(row.scientific_name).hasDirect }">
                  {{ getGenomeSummary(row.scientific_name).label }}
                </span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleColumns.sex" class="cell-sex">
              <span v-if="row.sex === 'male'" class="sex-badge male" title="Male">♂</span>
              <span v-else-if="row.sex === 'female'" class="sex-badge female" title="Female">♀</span>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleColumns.mimicry_ring" class="cell-mimicry">
              <span 
                v-if="row.mimicry_ring && row.mimicry_ring !== 'Unknown'"
                class="mimicry-badge"
              >
                {{ row.mimicry_ring }}
              </span>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleColumns.sequencing_status" class="cell-status">
              <span 
                class="status-badge"
                :style="{ '--status-color': getStatusColor(row.sequencing_status) }"
              >
                {{ row.sequencing_status }}
              </span>
            </td>
            <td v-if="visibleColumns.source" class="cell-source">
              {{ row.source }}
            </td>
            <td v-if="visibleColumns.spatial_check" class="cell-spatial-check">
              {{ getSpatialCheck(row) }}
            </td>
            <td v-if="visibleColumns.curated" class="cell-curated">
              <template v-if="getCorrectionInfo(row)">
                <span
                  class="curated-badge"
                  :style="{ '--curated-color': getCorrectionInfo(row).color }"
                  :title="[
                    getCorrectionInfo(row).originalName ? `Species was: ${getCorrectionInfo(row).originalName}` : '',
                    getCorrectionInfo(row).originalSubspecies ? `Subspecies was: ${getCorrectionInfo(row).originalSubspecies}` : ''
                  ].filter(Boolean).join('\n')"
                >
                  {{ getCorrectionInfo(row).type }}
                </span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleColumns.observation_date" class="cell-date">
              {{ row.observation_date || '—' }}
            </td>
            <td v-if="visibleColumns.country" class="cell-country">
              {{ row.country || '—' }}
            </td>
            <td v-if="visibleColumns.lat" class="cell-coord">
              {{ row.lat ? parseFloat(row.lat).toFixed(4) : '—' }}
            </td>
            <td v-if="visibleColumns.lng" class="cell-coord">
              {{ row.lng ? parseFloat(row.lng).toFixed(4) : '—' }}
            </td>
          </tr>
          
          <!-- Empty state -->
          <tr v-if="paginatedData.length === 0">
            <td :colspan="activeColumns.length" class="empty-state">
              <div class="empty-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <p>No records match your filters</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table v-if="tableView === 'species'" class="data-table species-table">
        <thead>
          <tr>
            <th
              v-for="col in speciesColumns"
              :key="col.key"
              :style="colStyle('species', col)"
              class="sortable"
              :class="{ sorted: sortColumn === col.key }"
              @click="toggleSort(col.key)"
            >
              <div class="th-content">
                <span>{{ col.label }}</span>
                <svg
                  v-if="sortColumn === col.key"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="sort-icon" :class="{ desc: sortDirection === 'desc' }"
                >
                  <path d="m18 15-6-6-6 6"/>
                </svg>
              </div>
              <span class="col-resize-handle" @mousedown.stop.prevent="startColResize($event, 'species', col.key)" @click.stop></span>
            </th>
          </tr>
          <tr v-if="showColumnFilters" class="filter-row">
            <th class="filter-cell">
              <input type="text" class="column-filter-input" placeholder="Filter species..." v-model="columnFilters.scientific_name" />
            </th>
            <th class="filter-cell"></th>
            <th class="filter-cell">
              <select class="column-filter-select" v-model="columnFilters.goat_status">
                <option value="">All</option>
                <option value="direct">Direct</option>
                <option value="estimated">Estimated</option>
                <option value="none">No data</option>
              </select>
            </th>
            <th class="filter-cell">
              <div class="filter-range">
                <input type="number" class="column-filter-input range-input" placeholder="Min" v-model="columnFilters.goat_chromosome_min" @input="syncChromosomeFilter" />
                <span class="range-sep">–</span>
                <input type="number" class="column-filter-input range-input" placeholder="Max" v-model="columnFilters.goat_chromosome_max" @input="syncChromosomeFilter" />
              </div>
            </th>
            <th class="filter-cell"></th>
            <th class="filter-cell">
              <select class="column-filter-select" v-model="columnFilters.genome_size">
                <option value="">All</option>
                <option value="has">Has data</option>
                <option value="none">No data</option>
              </select>
            </th>
            <th class="filter-cell">
              <select class="column-filter-select" v-model="columnFilters.assembly_level">
                <option value="">All</option>
                <option v-for="val in uniqueAssemblyLevels" :key="val" :value="val">{{ val }}</option>
              </select>
            </th>
            <th class="filter-cell">
              <select class="column-filter-select" v-model="columnFilters.bioproject">
                <option value="">All</option>
                <option value="has">Has BioProject</option>
                <option value="none">None</option>
              </select>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sp in paginatedSpeciesData" :key="sp.scientific_name">
            <td class="cell-species"><em>{{ sp.scientific_name }}</em></td>
            <td class="cell-records">{{ sp.records }}</td>
            <td class="cell-genome">
              <a v-if="sp.taxon_id && sp.goat_status !== 'No data'" :href="`https://goat.genomehubs.org/record?recordId=${sp.taxon_id}&result=taxon&taxonomy=ncbi`" target="_blank" rel="noopener noreferrer"
                class="genome-link" :class="{ direct: sp.goat_status === 'Direct' }"
                :title="sp.goat_status === 'Direct' ? 'Direct genomic data — view on GoaT' : 'Estimated from phylogenetic relatives — view on GoaT'">
                {{ sp.goat_status === 'Direct' ? 'Direct' : 'Est.' }}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="cell-chr">
              <span v-if="sp.chromosome_number != null" class="chr-value">
                {{ sp.chromosome_number }}
                <span v-if="sp.chr_source === 'ancestor'" class="chr-est">(est.)</span>
              </span>
              <span v-else class="text-muted">—</span>
            </td>
            <td>
              <span v-if="sp.haploid_number != null">
                {{ sp.haploid_number }}
              </span>
              <span v-else class="text-muted">—</span>
            </td>
            <td>
              <span v-if="sp.genome_size != null">
                {{ store.formatGenomeSize(sp.genome_size) }}
                <span v-if="sp.genome_size_source === 'ancestor'" class="chr-est">(est.)</span>
              </span>
              <span v-else class="text-muted">—</span>
            </td>
            <td>{{ sp.assembly_level || '—' }}</td>
            <td>
              <a v-if="sp.bioproject" :href="`https://www.ncbi.nlm.nih.gov/bioproject/${sp.bioproject}`" target="_blank" rel="noopener noreferrer" class="bioproject-link">
                {{ sp.bioproject }}
              </a>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
          <tr v-if="paginatedSpeciesData.length === 0">
            <td :colspan="speciesColumns.length" class="empty-state">
              <div class="empty-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <p>No species with GoaT data in current selection</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table v-if="tableView === 'hostplants' && hostPlantTableMode === 'butterflies'" class="data-table host-plant-table">
        <thead>
          <tr>
            <th
              v-for="col in activeHostButterflyColumns"
              :key="col.key"
              :style="colStyle('hostButterfly', col)"
              class="sortable"
              :class="{ sorted: sortColumn === col.key }"
              @click="toggleSort(col.key)"
            >
              <div class="th-content">
                <span>{{ col.label }}</span>
                <svg
                  v-if="sortColumn === col.key"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="sort-icon" :class="{ desc: sortDirection === 'desc' }"
                >
                  <path d="m18 15-6-6-6 6"/>
                </svg>
              </div>
              <span class="col-resize-handle" @mousedown.stop.prevent="startColResize($event, 'hostButterfly', col.key)" @click.stop></span>
            </th>
          </tr>
          <tr v-if="showColumnFilters" class="filter-row">
            <th v-for="col in activeHostButterflyColumns" :key="'f-' + col.key" class="filter-cell">
              <input
                v-if="col.key === 'butterfly'"
                type="text"
                class="column-filter-input"
                placeholder="Filter butterfly, host, family, source..."
                v-model="columnFilters.hostplants"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in paginatedHostPlantButterflyRows" :key="row.butterfly">
            <tr class="host-butterfly-row">
              <td class="cell-species">
                <button
                  type="button"
                  class="row-expand-btn"
                  :class="{ active: expandedHostButterflies.has(row.butterfly) }"
                  @click="toggleHostButterflyExpanded(row.butterfly)"
                  :title="expandedHostButterflies.has(row.butterfly) ? 'Collapse host plants' : 'Show all host plants'"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </button>
                <em>{{ row.butterfly }}</em>
              </td>
              <td v-if="visibleHostButterflyColumns.host_count" class="cell-host-plants">
                <div class="host-chip-list compact">
                  <span
                    v-for="plant in row.hostPlants.slice(0, 8)"
                    :key="plant.name"
                    class="host-chip"
                    :class="hostLevelClass(plant.host_id_level || plant.rank)"
                    :title="hostDisplayTitle(plant)"
                  >
                    <span class="host-chip-names" :class="{ 'has-accepted-name': plant.accepted_name }">
                      <em class="reported-name">{{ plant.name }}</em>
                      <span v-if="plant.accepted_name" class="accepted-name">→ <em>{{ plant.accepted_name }}</em></span>
                    </span>
                    <span v-if="plant.gbif_records > 0" class="chip-count">{{ plant.gbif_records.toLocaleString() }}</span>
                  </span>
                  <button
                    v-if="row.hostPlants.length > 8"
                    type="button"
                    class="host-chip more"
                    @click="toggleHostButterflyExpanded(row.butterfly)"
                  >
                    +{{ row.hostPlants.length - 8 }} more
                  </button>
                </div>
              </td>
              <td v-if="visibleHostButterflyColumns.species" class="cell-records"><span class="confidence-pill species">{{ row.counts.species }}</span></td>
              <td v-if="visibleHostButterflyColumns.genus" class="cell-records"><span class="confidence-pill genus">{{ row.counts.genus }}</span></td>
              <td v-if="visibleHostButterflyColumns.family" class="cell-records"><span class="confidence-pill family">{{ row.counts.family }}</span></td>
              <td v-if="visibleHostButterflyColumns.families">{{ conciseList(row.families, 3) }}</td>
              <td v-if="visibleHostButterflyColumns.occurrence_backed_count" class="cell-records">{{ row.occurrence_backed_count }}</td>
              <td v-if="visibleHostButterflyColumns.sources">
                <span class="source-list compact-source-list">
                  <template v-for="source in row.sourceLinks.slice(0, 2)" :key="source.label">
                    <a
                      v-if="source.url"
                      :href="source.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="source-link"
                    >{{ source.label }}</a>
                    <span v-else>{{ source.label }}</span>
                  </template>
                  <span v-if="row.sourceLinks.length > 2" class="text-muted">+{{ row.sourceLinks.length - 2 }} more</span>
                </span>
              </td>
            </tr>
            <tr v-if="expandedHostButterflies.has(row.butterfly)" class="host-expanded-row">
              <td class="host-expanded-spacer" aria-hidden="true"></td>
              <td :colspan="Math.max(1, activeHostButterflyColumns.length - 1)">
                <div class="host-expanded-panel">
                  <div
                    v-for="level in hostPlantStore.hostIdLevels"
                    :key="level.key"
                    class="host-confidence-block"
                  >
                    <div class="host-confidence-heading">
                      <span class="confidence-pill" :class="level.key">
                        {{ level.label }}
                      </span>
                      <span>{{ hostPlantsByHostIdLevel(row.hostPlants)[level.key].length }} taxa</span>
                    </div>
                    <div class="host-chip-list expanded">
                      <span
                        v-for="plant in hostPlantsByHostIdLevel(row.hostPlants)[level.key]"
                        :key="plant.name"
                        class="host-chip"
                        :class="hostLevelClass(plant.host_id_level || plant.rank)"
                        :title="hostDisplayTitle(plant)"
                      >
                        <span class="host-chip-names" :class="{ 'has-accepted-name': plant.accepted_name }">
                          <em class="reported-name">{{ plant.name }}</em>
                          <span v-if="plant.accepted_name" class="accepted-name">→ <em>{{ plant.accepted_name }}</em></span>
                        </span>
                        <span v-if="plant.gbif_records > 0" class="chip-count">{{ plant.gbif_records.toLocaleString() }}</span>
                      </span>
                      <span v-if="hostPlantsByHostIdLevel(row.hostPlants)[level.key].length === 0" class="text-muted">—</span>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="paginatedHostPlantButterflyRows.length === 0">
            <td :colspan="activeHostButterflyColumns.length" class="empty-state">
              <div class="empty-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <p>No host-plant records match the current selection</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table v-if="tableView === 'hostplants' && hostPlantTableMode === 'evidence'" class="data-table host-plant-table evidence-table">
        <thead>
          <tr>
            <th
              v-for="col in activeHostEvidenceColumns"
              :key="col.key"
              :style="colStyle('hostEvidence', col)"
              class="sortable"
              :class="{ sorted: sortColumn === col.key }"
              @click="toggleSort(col.key)"
            >
              <div class="th-content">
                <span>{{ col.label }}</span>
                <svg
                  v-if="sortColumn === col.key"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="sort-icon" :class="{ desc: sortDirection === 'desc' }"
                >
                  <path d="m18 15-6-6-6 6"/>
                </svg>
              </div>
              <span class="col-resize-handle" @mousedown.stop.prevent="startColResize($event, 'hostEvidence', col.key)" @click.stop></span>
            </th>
          </tr>
          <tr v-if="showColumnFilters" class="filter-row">
            <th v-for="col in activeHostEvidenceColumns" :key="'f-' + col.key" class="filter-cell">
              <input v-if="col.key === 'butterfly'" type="text" class="column-filter-input" placeholder="Butterfly..." v-model="columnFilters.butterfly" />
              <input v-else-if="col.key === 'host'" type="text" class="column-filter-input" placeholder="Host (reported or accepted)..." v-model="columnFilters.host" />
              <input v-else-if="col.key === 'family'" type="text" class="column-filter-input" placeholder="Family..." v-model="columnFilters.family" />
              <select v-else-if="col.key === 'evidence_level'" class="column-filter-select" v-model="columnFilters.confidence">
                <option value="">All</option>
                <option value="direct">Observed</option>
                <option value="literature">Reported</option>
                <option value="needs_check">Needs check</option>
              </select>
              <input v-else-if="col.key === 'source'" type="text" class="column-filter-input" placeholder="Source..." v-model="columnFilters.source" />
              <select v-else-if="col.key === 'mapped'" class="column-filter-select" v-model="columnFilters.mapped">
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in paginatedHostPlantEvidenceRows" :key="row.id">
            <td v-if="visibleHostEvidenceColumns.butterfly" class="cell-species"><em>{{ row.butterfly }}</em></td>
            <td v-if="visibleHostEvidenceColumns.host" class="cell-host" :class="{ 'has-accepted-host': row.accepted_host }">
              <em class="reported-host-name">{{ row.host }}</em>
              <span v-if="row.accepted_host" class="accepted-host-name">→ <em>{{ row.accepted_host }}</em></span>
            </td>
            <td v-if="visibleHostEvidenceColumns.reported_as" class="cell-long-text">
              <em v-if="row.reported_as">{{ row.reported_as }}</em>
              <span v-else class="text-muted">—</span>
            </td>
            <td v-if="visibleHostEvidenceColumns.host_rank">{{ row.host_rank }} / {{ row.host_id_level }}</td>
            <td v-if="visibleHostEvidenceColumns.family">{{ row.family }}</td>
            <td v-if="visibleHostEvidenceColumns.evidence_level">
              <span class="confidence-pill" :class="confidenceClass(row.evidence_level)">
                {{ row.evidence_display }}
              </span>
            </td>
            <td v-if="visibleHostEvidenceColumns.evidence" class="cell-long-text">{{ row.evidence }}</td>
            <td v-if="visibleHostEvidenceColumns.source" class="cell-long-text">
              <a
                v-if="row.source_url"
                :href="row.source_url"
                target="_blank"
                rel="noopener noreferrer"
                class="source-link"
              >
                {{ row.source }}
              </a>
              <span v-else>{{ row.source }}</span>
            </td>
            <td v-if="visibleHostEvidenceColumns.gbif_records" class="cell-records">{{ row.gbif_records.toLocaleString() }}</td>
            <td v-if="visibleHostEvidenceColumns.mapped">
              <span class="mapped-badge" :class="{ mapped: row.mapped }">
                {{ row.mapped ? 'Yes' : 'No' }}
              </span>
            </td>
            <td v-if="visibleHostEvidenceColumns.notes" class="cell-long-text">{{ row.notes || '—' }}</td>
          </tr>
          <tr v-if="paginatedHostPlantEvidenceRows.length === 0">
            <td :colspan="activeHostEvidenceColumns.length" class="empty-state">
              <div class="empty-content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <p>No host-plant evidence rows match your filters</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination" v-if="totalPages > 1">
      <button 
        class="page-btn"
        :disabled="currentPage === 1"
        @click="currentPage = 1"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m11 17-5-5 5-5"/>
          <path d="m18 17-5-5 5-5"/>
        </svg>
      </button>
      
      <button 
        class="page-btn"
        :disabled="currentPage === 1"
        @click="currentPage--"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>
      
      <template v-for="page in visiblePages" :key="page">
        <span v-if="page === '...'" class="page-ellipsis">...</span>
        <button 
          v-else
          class="page-btn page-number"
          :class="{ active: page === currentPage }"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
      </template>
      
      <button 
        class="page-btn"
        :disabled="currentPage === totalPages"
        @click="currentPage++"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
      
      <button 
        class="page-btn"
        :disabled="currentPage === totalPages"
        @click="currentPage = totalPages"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m13 17 5-5-5-5"/>
          <path d="m6 17 5-5-5-5"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.data-table-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-bg-secondary, #252540);
  border-radius: 8px;
  overflow: hidden;
}

/* Header Bar */
.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-bg-primary, #1a1a2e);
  border-bottom: 1px solid var(--color-border, #3d3d5c);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.record-count {
  font-size: 0.9rem;
  color: var(--color-text-secondary, #aaa);
}

.record-count strong {
  color: var(--color-accent, #4ade80);
}

.page-info {
  font-size: 0.8rem;
  color: var(--color-text-muted, #666);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.table-theme-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-theme-trigger,
.table-mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 6px 10px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.8rem;
  font-weight: 500;
}

.table-theme-trigger,
.table-mode-toggle {
  cursor: pointer;
  transition: all 0.2s;
}

.table-theme-trigger:hover,
.table-mode-toggle:hover {
  background: var(--color-bg-secondary, #353558);
  border-color: var(--color-border-light, #4d4d6c);
}

.table-theme-trigger .layer-icon,
.table-mode-toggle .mode-icon {
  width: 16px;
  height: 16px;
  color: var(--color-accent, #4ade80);
}

.table-mode-toggle {
  width: 34px;
  justify-content: center;
  padding: 0;
}

.table-mode-toggle.is-light .mode-icon {
  color: #f59e0b;
}

.table-theme-trigger .chevron {
  width: 13px;
  height: 13px;
  color: var(--color-text-muted, #888);
  transition: transform 0.2s;
}

.table-theme-trigger .chevron.open {
  transform: rotate(180deg);
}

.table-theme-dropdown {
  position: relative;
}

.table-theme-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 160px;
  padding: 4px;
  background: var(--color-bg-overlay, var(--color-bg-primary, #1a1a2e));
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--color-shadow-color, rgba(0, 0, 0, 0.25));
  z-index: 20;
}

.table-theme-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}

.table-theme-menu button:hover,
.table-theme-menu button.active {
  background: var(--color-accent-subtle, rgba(74, 222, 128, 0.15));
  color: var(--color-accent, #4ade80);
}

.theme-swatch {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #3d3d5c);
  position: relative;
  flex-shrink: 0;
}

.theme-swatch-accent {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.page-size-select {
  padding: 6px 10px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.8rem;
  cursor: pointer;
}

/* View Mode Toggle */
.view-mode-toggle {
  display: flex;
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  overflow: hidden;
}

.view-mode-toggle button {
  padding: 6px 12px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: none;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.view-mode-toggle button:not(:last-child) {
  border-right: 1px solid var(--color-border, #3d3d5c);
}

.view-mode-toggle button:hover {
  background: #353558;
  color: var(--color-text-primary, #e0e0e0);
}

.view-mode-toggle button.active {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.view-mode-toggle.sub-toggle button {
  font-size: 0.72rem;
  padding: 6px 10px;
}

.btn-columns {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-columns:hover,
.btn-columns.active {
  background: #353558;
  color: var(--color-text-primary, #e0e0e0);
}

.btn-columns svg {
  width: 14px;
  height: 14px;
}

/* Column Filter Toggle */
.column-filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 6px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.column-filter-toggle:hover {
  background: #353558;
  color: var(--color-text-primary, #e0e0e0);
}

.column-filter-toggle.active {
  background: rgba(59, 130, 246, 0.15);
  border-color: #60a5fa;
  color: #60a5fa;
}

.filter-count {
  background: #60a5fa;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* Column Dropdown */
.column-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  padding: 8px;
  background: var(--color-bg-secondary, #252540);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 100;
  min-width: 150px;
}

.column-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--color-text-secondary, #aaa);
  transition: background 0.2s;
}

.column-toggle:hover {
  background: var(--color-bg-tertiary, #2d2d4a);
}

.column-toggle input {
  accent-color: var(--color-accent, #4ade80);
}

.column-toggle.locked {
  cursor: default;
  opacity: 0.55;
}

/* Table */
.table-wrapper {
  flex: 1;
  overflow: auto;
  min-width: 0;
  max-width: 100%;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

/* Fit the host-plant tables to the available width (like the other tables) so
   they don't force a horizontal scrollbar. Fixed layout distributes the column
   widths proportionally; drag-to-resize then redistributes within the table. */
.host-plant-table {
  width: 100%;
  table-layout: fixed;
}
.host-plant-table th,
.host-plant-table td {
  overflow-wrap: anywhere;
}

.data-table th {
  position: sticky;
  top: 0;
  background: var(--color-bg-primary, #1a1a2e);
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  color: var(--color-text-secondary, #aaa);
  border-bottom: 2px solid var(--color-border, #3d3d5c);
  white-space: nowrap;
  z-index: 10;
}

.data-table th.sortable {
  cursor: pointer;
  user-select: none;
}

.data-table th.sortable:hover {
  color: var(--color-text-primary, #e0e0e0);
}

.data-table th.no-sort {
  cursor: default;
}

.data-table th.sorted {
  color: var(--color-accent, #4ade80);
}

/* Drag-to-resize handle on the trailing edge of each header cell. */
.col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
  z-index: 11;
}
.col-resize-handle:hover {
  background: var(--color-accent, #4ade80);
  opacity: 0.5;
}

.th-content {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sort-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.sort-icon.desc {
  transform: rotate(180deg);
}

.sort-indicator {
  margin-left: 6px;
  color: #60a5fa;
}

/* Filter Row */
.filter-row {
  background: var(--color-bg-secondary, #1e1e3a);
}

.filter-cell {
  padding: 4px 6px !important;
  top: 42px;
  z-index: 9;
}

.column-filter-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.75rem;
  outline: none;
  transition: border-color 0.2s;
}

.column-filter-input:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.column-filter-input::placeholder {
  color: var(--color-text-muted, #666);
  font-size: 0.7rem;
}

.column-filter-select {
  width: 100%;
  padding: 5px 6px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.75rem;
  outline: none;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  padding-right: 22px;
}

.column-filter-select:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.filter-range {
  display: flex;
  align-items: center;
  gap: 2px;
}

.range-input {
  flex: 1;
  min-width: 0;
  padding: 5px 4px !important;
  text-align: center;
  -moz-appearance: textfield;
}

.range-input::-webkit-outer-spin-button,
.range-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.range-sep {
  color: var(--color-text-muted, #666);
  font-size: 0.8rem;
  flex-shrink: 0;
}

.filter-select-narrow {
  padding-right: 18px !important;
  font-size: 0.7rem !important;
}

.filter-indicator {
  font-size: 0.75rem;
  color: #60a5fa;
  font-weight: 400;
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border, #3d3d5c);
  color: var(--color-text-primary, #e0e0e0);
  vertical-align: middle;
}

.data-table tbody tr:hover {
  background: rgba(74, 222, 128, 0.05);
}

/* Cell Types */
.cell-id {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
}

.cell-species em {
  color: var(--color-text-primary, #e0e0e0);
}

.cell-subspecies {
  font-style: italic;
  color: var(--color-text-secondary, #aaa);
}

.cell-sex {
  text-align: center;
}

.sex-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 1rem;
  font-weight: bold;
}

.sex-badge.male {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.sex-badge.female {
  background: rgba(236, 72, 153, 0.15);
  color: #f472b6;
}

.cell-coord {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
}

/* Photo Cell */
.cell-photo {
  padding: 4px 8px;
}

.photo-cell {
  display: flex;
  justify-content: center;
  align-items: center;
}

.photo-wrapper {
  position: relative;
  width: 50px;
  height: 50px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-tertiary, #2d2d4a);
  cursor: pointer;
}

.photo-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-wrapper.other-individual {
  border: 2px dashed var(--color-text-muted, #666);
}

.other-indicator {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #f59e0b;
  font-weight: bold;
}

.no-photo {
  color: var(--color-text-muted, #666);
}

/* Badges */
.mimicry-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  font-size: 0.75rem;
}

.status-badge::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-color);
}

/* Curated Badge */
.curated-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--curated-color);
  border: 1px solid color-mix(in srgb, var(--curated-color) 30%, transparent);
}

.curated-badge::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--curated-color);
}

/* Corrected Cell Highlight */
.cell-corrected {
  background: rgba(245, 158, 11, 0.08);
  border-left: 3px solid rgba(245, 158, 11, 0.4);
}

.original-value {
  display: block;
  font-size: 0.7rem;
  color: var(--color-text-muted, #888);
  font-style: normal;
  margin-top: 2px;
  opacity: 0.75;
}

.original-value em {
  text-decoration: line-through;
  color: rgba(245, 158, 11, 0.7);
}

.text-muted {
  color: var(--color-text-muted, #666);
}

.cell-chr {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.chr-value {
  font-size: 0.85rem;
  color: var(--color-text-primary, #e0e0e0);
}

.chr-est {
  font-size: 0.6rem;
  color: var(--color-text-muted, #888);
  font-style: italic;
  margin-left: 2px;
}

.cell-genome {
  text-align: center;
}

.genome-text, .genome-link {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.genome-text.direct, .genome-link.direct {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
}

.genome-text.estimated, .genome-link:not(.direct) {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.genome-link:hover {
  filter: brightness(1.2);
  text-decoration: underline;
}

.bioproject-link {
  color: #60a5fa;
  text-decoration: none;
  font-size: 0.8rem;
  font-family: monospace;
}

.bioproject-link:hover {
  text-decoration: underline;
  color: #93c5fd;
}

.cell-records {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.host-plant-table .cell-species {
  min-width: 190px;
}

.host-butterfly-row .cell-species {
  white-space: nowrap;
}

.host-butterfly-row .cell-species .row-expand-btn {
  margin-right: 8px;
  vertical-align: middle;
}

.host-butterfly-row .cell-species em {
  vertical-align: middle;
}

.row-expand-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 5px;
  background: var(--color-bg-tertiary, #2d2d4a);
  color: var(--color-text-secondary, #aaa);
  cursor: pointer;
  transition: all 0.2s;
  flex: 0 0 auto;
}

.row-expand-btn:hover,
.row-expand-btn.active {
  border-color: var(--color-accent, #4ade80);
  color: var(--color-accent, #4ade80);
}

.row-expand-btn svg {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.row-expand-btn.active svg {
  transform: rotate(90deg);
}

.cell-host-plants {
  min-width: 360px;
}

.host-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.host-chip-list.compact {
  max-width: 520px;
}

.host-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 3px 7px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary, #e0e0e0);
  font-size: 0.74rem;
  line-height: 1.2;
  max-width: 280px;
  vertical-align: top;
}

.host-chip-names {
  display: grid;
  min-width: 0;
  row-gap: 1px;
}

.host-chip em,
.host-chip .reported-name,
.host-chip .accepted-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-chip .chip-count {
  flex: 0 0 auto;
  align-self: center;
}

.host-chip .reported-name {
  color: inherit;
}

.host-chip-names.has-accepted-name .reported-name {
  color: #b8bec8;
}

.host-chip .accepted-name {
  color: inherit;
  font-size: 0.74rem;
  font-weight: 700;
}

.host-chip .accepted-name em {
  color: inherit;
}

:global([data-mode="light"]) .host-chip-names.has-accepted-name .reported-name {
  color: #52606d;
}

:global([data-mode="light"]) .host-chip.species .accepted-name,
:global([data-mode="light"]) .host-chip.high .accepted-name {
  color: #15803d;
}

:global([data-mode="light"]) .host-chip.genus .accepted-name,
:global([data-mode="light"]) .host-chip.medium .accepted-name {
  color: #a16207;
}

:global([data-mode="light"]) .host-chip.family .accepted-name,
:global([data-mode="light"]) .host-chip.low .accepted-name,
:global([data-mode="light"]) .host-chip.needs-check .accepted-name {
  color: #be123c;
}

.cell-host.has-accepted-host .reported-host-name {
  color: #b8bec8;
}

.accepted-host-name {
  color: var(--color-text-primary, #e0e0e0);
  display: block;
  font-size: 0.84rem;
  font-weight: 600;
  margin-top: 2px;
}

:global([data-mode="light"]) .cell-host.has-accepted-host .reported-host-name {
  color: #52606d;
}

:global([data-mode="light"]) .accepted-host-name {
  color: #111827;
}

.host-chip.species,
.host-chip.high {
  background: rgba(74, 222, 128, 0.14);
  border-color: rgba(74, 222, 128, 0.28);
  color: #86efac;
}

.host-chip.genus,
.host-chip.medium {
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.25);
  color: #fcd34d;
}

.host-chip.family,
.host-chip.low,
.host-chip.needs-check {
  background: rgba(251, 113, 133, 0.12);
  border-color: rgba(251, 113, 133, 0.25);
  color: #fda4af;
}


:global([data-mode="light"]) .host-chip.species,
:global([data-mode="light"]) .host-chip.high {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(22, 163, 74, 0.34);
  color: #15803d;
}

:global([data-mode="light"]) .host-chip.genus,
:global([data-mode="light"]) .host-chip.medium {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(217, 119, 6, 0.38);
  color: #92400e;
}

:global([data-mode="light"]) .host-chip.family,
:global([data-mode="light"]) .host-chip.low,
:global([data-mode="light"]) .host-chip.needs-check {
  background: rgba(244, 63, 94, 0.13);
  border-color: rgba(225, 29, 72, 0.34);
  color: #be123c;
}

.host-chip.more {
  cursor: pointer;
  color: #60a5fa;
}

.chip-count {
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  font-size: 0.64rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

:global([data-mode="light"]) .chip-count {
  background: rgba(15, 23, 42, 0.16);
  color: inherit;
}

.confidence-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  padding: 3px 8px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary, #aaa);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: capitalize;
}

.confidence-pill.species,
.confidence-pill.high,
.confidence-pill.direct {
  background: rgba(74, 222, 128, 0.16);
  color: #4ade80;
}

.confidence-pill.genus,
.confidence-pill.medium,
.confidence-pill.literature {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.confidence-pill.family,
.confidence-pill.low,
.confidence-pill.needs-check {
  background: rgba(251, 113, 133, 0.15);
  color: #fb7185;
}

.host-expanded-row td {
  background: rgba(0, 0, 0, 0.12);
  padding: 8px 14px;
}

.host-expanded-row .host-expanded-spacer {
  background: rgba(0, 0, 0, 0.06);
  padding: 0;
}

.host-expanded-panel {
  display: grid;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}

.host-confidence-block {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.host-confidence-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-muted, #888);
  font-size: 0.72rem;
}

.cell-long-text {
  max-width: 360px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.78rem;
  line-height: 1.35;
}

.source-link {
  color: #60a5fa;
  text-decoration: none;
}

.source-link:hover {
  color: #93c5fd;
  text-decoration: underline;
}

.compact-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
}

.mapped-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted, #888);
  font-size: 0.72rem;
  font-weight: 700;
}

.mapped-badge.mapped {
  background: rgba(74, 222, 128, 0.14);
  color: #4ade80;
}


/* Light-mode host chip contrast: keep fully global so scoped CSS cannot miss the html theme class. */
:global(html.light .host-chip.species),
:global(html.light .host-chip.high) {
  background: rgba(34, 197, 94, 0.18) !important;
  border-color: rgba(22, 163, 74, 0.42) !important;
  color: #166534 !important;
}

:global(html.light .host-chip.genus),
:global(html.light .host-chip.medium) {
  background: rgba(245, 158, 11, 0.18) !important;
  border-color: rgba(217, 119, 6, 0.46) !important;
  color: #92400e !important;
}

:global(html.light .host-chip.family),
:global(html.light .host-chip.low),
:global(html.light .host-chip.needs-check) {
  background: rgba(244, 63, 94, 0.16) !important;
  border-color: rgba(225, 29, 72, 0.42) !important;
  color: #9f1239 !important;
}

:global(html.light .host-chip .reported-name),
:global(html.light .host-chip .accepted-name),
:global(html.light .host-chip .accepted-name em),
:global(html.light .host-chip .chip-count) {
  color: inherit !important;
}

:global(html.light .host-chip-names.has-accepted-name .reported-name) {
  color: #64748b !important;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 60px 20px !important;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--color-text-muted, #666);
}

.empty-content svg {
  width: 48px;
  height: 48px;
  opacity: 0.5;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  background: var(--color-bg-primary, #1a1a2e);
  border-top: 1px solid var(--color-border, #3d3d5c);
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  background: var(--color-bg-tertiary, #2d2d4a);
  border: 1px solid var(--color-border, #3d3d5c);
  border-radius: 4px;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: #353558;
  color: var(--color-text-primary, #e0e0e0);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-btn.active {
  background: var(--color-accent, #4ade80);
  color: var(--color-bg-primary, #1a1a2e);
  border-color: var(--color-accent, #4ade80);
}

.page-btn svg {
  width: 14px;
  height: 14px;
}

.page-ellipsis {
  padding: 0 8px;
  color: var(--color-text-muted, #666);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
