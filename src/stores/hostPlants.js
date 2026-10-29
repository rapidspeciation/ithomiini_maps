import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { getHostPlantImage, hostPlantRecordToFeature } from '../utils/hostPlantGallery'
import { makeRegionTest } from '../utils/countryLookup'
import { useViewStore } from './viewStore'

const HOST_ID_KEYS = ['species', 'genus', 'family']
const EVIDENCE_KEYS = ['direct', 'literature', 'needs_check']
const DEFAULT_HOST_ID_LEVELS = ['species']
const DEFAULT_EVIDENCE_LEVELS = ['direct', 'literature']
// Shared links can name a confidence instead of evidence levels (`hp_conf`).
const EVIDENCE_FOR_CONFIDENCE = {
  high: ['direct'],
  medium: ['direct', 'literature'],
  low: ['direct', 'literature', 'needs_check'],
}
const URL_LIST_MAX = 60
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index])
const parseURLList = value => (value ? value.split(',').map(item => item.trim()).filter(Boolean).slice(0, URL_LIST_MAX) : [])

export const useHostPlantStore = defineStore('hostPlants', () => {
  const manifest = ref(null)
  const taxa = ref([])
  const associations = ref([])
  const loading = ref(false)
  const enabled = ref(false)
  const selectedTaxonSlugs = ref([])
  const opacity = ref(0.85)
  const occurrenceDataset = shallowRef(null)
  const occurrenceLoading = ref(false)
  const occurrenceError = ref(null)
  const loadedOccurrenceShards = ref([])
  const occurrenceShardCache = shallowRef({})
  const occurrenceRefCache = shallowRef({})
  const occurrenceChunkCache = shallowRef({})
  const galleryDataset = shallowRef(null)
  const galleryIndexCache = shallowRef({})
  const galleryPageCache = shallowRef({})
  const galleryLoading = ref(false)
  const galleryError = ref(null)
  const galleryVisibleLimitBySlug = ref({})
  const galleryPhotoContextOrder = ref(['field', 'ambiguous', 'preserved'])
  const galleryDateOrder = ref('desc')
  // The Host Plant Filters' choices: the butterflies whose host plants are shown,
  // and the host ID levels and evidence those plants are chosen at.
  const filterButterflies = ref([])
  const filterHostIdLevels = ref([...DEFAULT_HOST_ID_LEVELS])
  const filterEvidenceLevels = ref([...DEFAULT_EVIDENCE_LEVELS])
  // Plants chosen through each butterfly (the rest of the selection was picked by hand).
  const autoSlugsByButterfly = ref(new Map())
  // Plants named by a shared link, kept until the metadata can resolve them.
  const pendingURLTaxa = ref(null)
  let urlRead = false
  const countryBoundaries = shallowRef(null)

  const hostIdLevels = [
    { key: 'species', label: 'Species', description: 'Exact host plant species reported.' },
    { key: 'genus', label: 'Genus', description: 'Host reported only to genus; useful clue, not exact plant.' },
    { key: 'family', label: 'Family', description: 'Broad host family only; mainly context/table use.' },
  ]

  const evidenceLevels = [
    { key: 'direct', label: 'Observed', description: 'Observed host use: eggs, larvae, feeding, oviposition, or rearing.' },
    { key: 'literature', label: 'Reported', description: 'Host use reported by a catalogue, paper, expert source, or captive/lab record without checked direct-use details.' },
    { key: 'needs_check', label: 'Needs check', description: 'Unresolved or audit-level records.' },
  ]

  const confidenceLevels = [
    { key: 'high', label: 'Confirmed', description: 'Direct or checked host-use evidence.' },
    { key: 'medium', label: 'Provisional', description: 'Credible catalogue, literature, or expert record; source trail not fully checked.' },
    { key: 'low', label: 'Tentative', description: 'Weak, broad, uncertain, captive-only, or audit-level records.' },
  ]

  const galleryPhotoContextOptions = [
    { key: 'field', label: 'Field observation' },
    { key: 'ambiguous', label: 'Ambiguous' },
    { key: 'preserved', label: 'Preserved specimen' },
  ]

  const taxaBySlug = computed(() => {
    const map = new Map()
    for (const taxon of taxa.value) map.set(taxon.slug, taxon)
    return map
  })

  const activeTaxa = computed(() =>
    selectedTaxonSlugs.value
      .map(slug => taxaBySlug.value.get(slug))
      .filter(Boolean)
  )

  const caveat = computed(() =>
    manifest.value?.metadata?.scientific_caveat
    || 'GBIF plant occurrences are context records and do not prove local host use.'
  )

  async function fetchJson(path) {
    const basePath = import.meta.env.BASE_URL || '/'
    const response = await fetch(`${basePath}data/host_plants/${path}`)
    if (!response.ok) throw new Error(`Unable to load host plant data: ${path}`)
    return response.json()
  }

  async function loadMetadata() {
    if (manifest.value && associations.value.length > 0) return
    loading.value = true
    try {
      const [manifestJson, associationsJson] = await Promise.all([
        fetchJson('host_plant_layers_manifest.json'),
        fetchJson('host_plant_associations.json'),
      ])
      manifest.value = manifestJson
      taxa.value = manifestJson.taxa || []
      associations.value = associationsJson.associations || []
    } catch (error) {
      manifest.value = null
      taxa.value = []
      associations.value = []
      throw error
    } finally {
      loading.value = false
    }
  }

  function confidenceBucket(confidence) {
    if (confidence === 'high' || confidence === 'medium') return confidence
    if (confidence === 'low' || confidence === 'needs_check') return 'low'
    return 'unknown'
  }

  function confidencePasses(confidence, minimum = 'low') {
    const order = { high: 3, medium: 2, low: 1, unknown: 0 }
    return order[confidenceBucket(confidence)] >= order[minimum]
  }

  function normalizeConfidenceSelection(selection = 'low') {
    if (Array.isArray(selection)) {
      const selected = selection.map(confidenceBucket).filter(bucket => bucket !== 'unknown')
      return new Set(selected.length > 0 ? selected : ['high'])
    }
    if (selection === 'high') return new Set(['high'])
    if (selection === 'medium') return new Set(['high', 'medium'])
    return new Set(['high', 'medium', 'low'])
  }

  function confidenceIncluded(confidence, selection = 'low') {
    return normalizeConfidenceSelection(selection).has(confidenceBucket(confidence))
  }

  function confidenceLabel(confidence) {
    if (confidence === 'needs_check') return 'needs check'
    return confidence || 'unknown'
  }

  function confidenceDisplayLabel(confidence) {
    const bucket = confidenceBucket(confidence)
    return confidenceLevels.find(level => level.key === bucket)?.label || confidenceLabel(confidence)
  }

  function confidenceCountsForAssociations(sourceAssociations) {
    const countsBySlug = new Map()
    for (const association of sourceAssociations) {
      const taxon = taxaBySlug.value.get(association.host_taxon_slug)
      if (!taxon || taxon.occurrence_count <= 0 || !['species', 'genus'].includes(taxon.rank)) continue
      const existing = countsBySlug.get(taxon.slug) || 'low'
      const bucket = confidenceBucket(association.confidence)
      const rank = { high: 3, medium: 2, low: 1, unknown: 0 }
      countsBySlug.set(taxon.slug, rank[bucket] > rank[existing] ? bucket : existing)
    }
    const counts = { high: 0, medium: 0, low: 0 }
    for (const bucket of countsBySlug.values()) {
      if (bucket === 'high') counts.high += 1
      else if (bucket === 'medium') counts.medium += 1
      else counts.low += 1
    }
    return counts
  }


  function hostIdLevelForAssociation(association) {
    return ['species', 'genus', 'family'].includes(association?.host_id_level)
      ? association.host_id_level
      : (['species', 'genus', 'family'].includes(association?.host_taxon_rank) ? association.host_taxon_rank : 'family')
  }

  function evidenceLevelForAssociation(association) {
    if (['direct', 'literature', 'needs_check'].includes(association?.evidence_level)) return association.evidence_level
    const bucket = confidenceBucket(association?.confidence)
    if (bucket === 'high') return 'direct'
    if (bucket === 'medium') return 'literature'
    return 'needs_check'
  }

  function normalizeHostIdLevelSelection(selection = ['species']) {
    const raw = selection instanceof Set ? Array.from(selection) : (Array.isArray(selection) ? selection : [selection])
    const values = raw.filter(level => ['species', 'genus', 'family'].includes(level))
    return new Set(values.length ? values : ['species'])
  }

  function normalizeEvidenceSelection(selection = ['direct', 'literature']) {
    const raw = selection instanceof Set ? Array.from(selection) : (Array.isArray(selection) ? selection : [selection])
    const values = raw.filter(level => ['direct', 'literature', 'needs_check'].includes(level))
    return new Set(values.length ? values : ['direct', 'literature'])
  }

  function normalizeHostFilterOptions(optionsOrConfidence = {}) {
    if (Array.isArray(optionsOrConfidence) || typeof optionsOrConfidence === 'string') {
      const confidenceSelection = normalizeConfidenceSelection(optionsOrConfidence)
      const evidence = []
      if (confidenceSelection.has('high')) evidence.push('direct')
      if (confidenceSelection.has('medium')) evidence.push('literature')
      if (confidenceSelection.has('low')) evidence.push('needs_check')
      return {
        hostIdLevels: normalizeHostIdLevelSelection(['species', 'genus']),
        evidenceLevels: normalizeEvidenceSelection(evidence),
        includeNonOccurrenceBacked: false,
      }
    }
    return {
      hostIdLevels: normalizeHostIdLevelSelection(optionsOrConfidence.hostIdLevels),
      evidenceLevels: normalizeEvidenceSelection(optionsOrConfidence.evidenceLevels),
      includeNonOccurrenceBacked: Boolean(optionsOrConfidence.includeNonOccurrenceBacked),
    }
  }

  function associationMatchesHostFilters(association, hostIdSelection, evidenceSelection) {
    return normalizeHostIdLevelSelection(hostIdSelection).has(hostIdLevelForAssociation(association))
      && normalizeEvidenceSelection(evidenceSelection).has(evidenceLevelForAssociation(association))
  }

  function hostFilterCountsForAssociations(sourceAssociations) {
    const hostIdCounts = { species: 0, genus: 0, family: 0 }
    const evidenceCounts = { direct: 0, literature: 0, needs_check: 0 }
    for (const association of sourceAssociations) {
      hostIdCounts[hostIdLevelForAssociation(association)] += 1
      evidenceCounts[evidenceLevelForAssociation(association)] += 1
    }
    return { hostIdCounts, evidenceCounts }
  }

  function getButterflyOptionsForHostPlants(search = '') {
    const query = (search || '').trim().toLowerCase()
    const byButterfly = new Map()
    for (const association of associations.value) {
      const name = association.butterfly_taxon
      if (!name) continue
      if (query && !name.toLowerCase().includes(query)) continue
      const list = byButterfly.get(name) || []
      list.push(association)
      byButterfly.set(name, list)
    }
    return Array.from(byButterfly.entries())
      .map(([name, butterflyAssociations]) => {
        const { hostIdCounts, evidenceCounts } = hostFilterCountsForAssociations(butterflyAssociations)
        const total = butterflyAssociations.length
        return {
          label: name,
          value: name,
          meta: `${hostIdCounts.species} species · ${hostIdCounts.genus} genus · ${hostIdCounts.family} family · ${evidenceCounts.direct} observed · ${evidenceCounts.literature} reported · ${evidenceCounts.needs_check} needs check`,
          badges: [
            { key: 'species', label: `${hostIdCounts.species} species` },
            { key: 'genus', label: `${hostIdCounts.genus} genus` },
            { key: 'family', label: `${hostIdCounts.family} family` },
          ],
          counts: { ...hostIdCounts, ...evidenceCounts },
          hostIdCounts,
          evidenceCounts,
          total,
          searchText: name.toLowerCase(),
        }
      })
      .filter(option => option.total > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  function getTaxaForButterflies(butterflyTaxa, optionsOrConfidence = {}) {
    const selected = new Set((butterflyTaxa || []).filter(Boolean))
    if (selected.size === 0) return []
    const options = normalizeHostFilterOptions(optionsOrConfidence)
    const bySlug = new Map()
    for (const association of associations.value) {
      if (!selected.has(association.butterfly_taxon)) continue
      if (!associationMatchesHostFilters(association, options.hostIdLevels, options.evidenceLevels)) continue
      const taxon = taxaBySlug.value.get(association.host_taxon_slug)
      if (!taxon) continue
      if (!options.includeNonOccurrenceBacked && taxon.occurrence_count <= 0) continue
      if (!options.hostIdLevels.has(hostIdLevelForAssociation(association))) continue
      const entry = bySlug.get(taxon.slug) || { ...taxon, associations: [] }
      entry.associations.push(association)
      bySlug.set(taxon.slug, entry)
    }
    return Array.from(bySlug.values()).sort((a, b) =>
      a.canonical_name.localeCompare(b.canonical_name)
    )
  }

  function getSpeciesLevelTaxaForButterflies(butterflyTaxa) {
    const selected = new Set((butterflyTaxa || []).filter(Boolean))
    if (selected.size === 0) return []
    const bySlug = new Map()
    for (const association of associations.value) {
      if (!selected.has(association.butterfly_taxon)) continue
      const taxon = taxaBySlug.value.get(association.host_taxon_slug)
      if (!taxon) continue
      if (taxon.occurrence_count <= 0 || taxon.rank !== 'species') continue
      const entry = bySlug.get(taxon.slug) || { ...taxon, associations: [] }
      entry.associations.push(association)
      bySlug.set(taxon.slug, entry)
    }
    return Array.from(bySlug.values()).sort((a, b) =>
      a.canonical_name.localeCompare(b.canonical_name)
    )
  }

  function getOccurrenceTaxonOptionsForButterflies(butterflyTaxa, optionsOrConfidence = {}) {
    const selected = (butterflyTaxa || []).filter(Boolean)
    const options = normalizeHostFilterOptions(optionsOrConfidence)
    const sourceTaxa = selected.length > 0
      ? getTaxaForButterflies(selected, options)
      : taxa.value.map(taxon => ({
        ...taxon,
        associations: associations.value.filter(a =>
          a.host_taxon_slug === taxon.slug && associationMatchesHostFilters(a, options.hostIdLevels, options.evidenceLevels)
        ),
      })).filter(taxon => taxon.associations.length > 0)

    return sourceTaxa
      .filter(taxon => taxon.occurrence_count > 0 && ['species', 'genus'].includes(taxon.rank))
      .map(taxon => {
        const taxonAssociations = (taxon.associations || associations.value.filter(a => a.host_taxon_slug === taxon.slug))
          .filter(a => selected.length === 0 || associationMatchesHostFilters(a, options.hostIdLevels, options.evidenceLevels))
        const evidence = selected.length > 0
          ? [...new Set(taxonAssociations.map(a => evidenceLevels.find(level => level.key === evidenceLevelForAssociation(a))?.label).filter(Boolean))].join(', ')
          : null
        const butterflyTaxa = [...new Set(taxonAssociations.map(a => a.butterfly_taxon).filter(Boolean))]
        const parts = [
          taxon.rank,
          taxon.family,
          evidence,
          `${taxon.occurrence_count} records`,
        ].filter(Boolean)
        return {
          label: taxon.canonical_name,
          value: taxon.slug,
          meta: parts.join(' · '),
          associatedButterflies: butterflyTaxa,
          searchText: [
            taxon.canonical_name,
            taxon.rank,
            taxon.family,
            taxon.genus,
            taxon.species,
            ...butterflyTaxa,
          ].filter(Boolean).join(' ').toLowerCase(),
        }
      })
  }

  function filterOccurrenceTaxonOptions(options, search) {
    const query = (search || '').trim().toLowerCase()
    if (!query) return options
    return options
      .filter(option => {
        const haystack = option.searchText || [option.label, option.meta].filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(query)
      })
      .map(option => {
        const matchedButterflies = (option.associatedButterflies || [])
          .filter(name => name.toLowerCase().includes(query))
        if (matchedButterflies.length === 0) return option
        return {
          ...option,
          matchMeta: `Butterfly: ${matchedButterflies.slice(0, 3).join(', ')}${matchedButterflies.length > 3 ? ` +${matchedButterflies.length - 3} more` : ''}`,
        }
      })
  }

  function autoSlugsForButterflies() {
    const byButterfly = new Map()
    for (const butterfly of filterButterflies.value) {
      const taxaForButterfly = getTaxaForButterflies([butterfly], {
        hostIdLevels: filterHostIdLevels.value,
        evidenceLevels: filterEvidenceLevels.value,
      })
      byButterfly.set(butterfly, new Set(
        taxaForButterfly
          .filter(taxon => taxon.occurrence_count > 0 && ['species', 'genus'].includes(taxon.rank))
          .map(taxon => taxon.slug)
      ))
    }
    return byButterfly
  }

  /** Swap the plants chosen through butterflies for the current choice; plants picked by hand stay. */
  function refreshButterflySelection() {
    const previousAuto = new Set([...autoSlugsByButterfly.value.values()].flatMap(slugs => [...slugs]))
    const nextByButterfly = autoSlugsForButterflies()
    const nextAuto = new Set([...nextByButterfly.values()].flatMap(slugs => [...slugs]))
    const manual = selectedTaxonSlugs.value.filter(slug => !previousAuto.has(slug))
    setSelectedTaxa([...manual, ...nextAuto])
    autoSlugsByButterfly.value = nextByButterfly
  }

  function setFilterButterflies(names) {
    filterButterflies.value = [...new Set((names || []).filter(Boolean))]
    refreshButterflySelection()
  }

  function setFilterHostIdLevels(levels) {
    const selected = new Set(levels || [])
    const next = HOST_ID_KEYS.filter(key => selected.has(key))
    filterHostIdLevels.value = next.length ? next : [...DEFAULT_HOST_ID_LEVELS]
    refreshButterflySelection()
  }

  function setFilterEvidenceLevels(levels) {
    const selected = new Set(levels || [])
    const next = EVIDENCE_KEYS.filter(key => selected.has(key))
    filterEvidenceLevels.value = next.length ? next : [...DEFAULT_EVIDENCE_LEVELS]
    refreshButterflySelection()
  }

  /** A plant named in a link, by slug or by name ("Mesechites trifida"), as its slug. */
  function slugForURLTaxon(value) {
    if (taxaBySlug.value.has(value)) return value
    const wanted = String(value).trim().toLowerCase()
    return taxa.value.find(taxon => taxon.canonical_name?.toLowerCase() === wanted)?.slug || null
  }

  /** The shared link's plants and butterflies, once the metadata is loaded. */
  function applyURLSelection() {
    const byButterfly = autoSlugsForButterflies()
    const auto = [...new Set([...byButterfly.values()].flatMap(slugs => [...slugs]))]
    const named = pendingURLTaxa.value
    const slugs = named ? named.map(slugForURLTaxon).filter(Boolean) : auto
    autoSlugsByButterfly.value = byButterfly
    pendingURLTaxa.value = null
    setSelectedTaxa(slugs)
  }

  function appendURLParams(params) {
    // A layer switched off (its plants kept) is left out of the link.
    if (!enabled.value && !pendingURLTaxa.value && selectedTaxonSlugs.value.length) return
    if (filterButterflies.value.length) params.set('hp_bf', filterButterflies.value.join(','))
    if (!sameList(filterHostIdLevels.value, DEFAULT_HOST_ID_LEVELS)) params.set('hp_level', filterHostIdLevels.value.join(','))
    if (!sameList(filterEvidenceLevels.value, DEFAULT_EVIDENCE_LEVELS)) params.set('hp_evidence', filterEvidenceLevels.value.join(','))
    if (pendingURLTaxa.value) {
      if (pendingURLTaxa.value.length) params.set('hp_taxa', pendingURLTaxa.value.join(','))
    } else {
      // The plants are written only when they are not just the chosen butterflies' plants.
      const auto = new Set([...autoSlugsByButterfly.value.values()].flatMap(slugs => [...slugs]))
      const selected = selectedTaxonSlugs.value
      const onlyAuto = filterButterflies.value.length > 0 && selected.length === auto.size && selected.every(slug => auto.has(slug))
      if (selected.length && !onlyAuto) params.set('hp_taxa', selected.join(','))
      // Every plant of the butterflies unticked: an empty list keeps that.
      else if (!selected.length && filterButterflies.value.length) params.set('hp_taxa', '')
    }
    if (Math.abs(opacity.value - 0.85) > 0.001 && (selectedTaxonSlugs.value.length || pendingURLTaxa.value)) {
      params.set('hp_opacity', String(Math.round(opacity.value * 100)))
    }
  }

  /**
   * A shared link's host-plant layer: `hp_bf` butterflies, `hp_taxa` plant slugs or names,
   * `hp_level` host ID levels, `hp_evidence` evidence levels (or `hp_conf` high, medium or low),
   * `hp_opacity` in percent. The layer is on when the link names plants or butterflies.
   */
  function restoreFromURL(params) {
    urlRead = true
    const butterflies = parseURLList(params.get('hp_bf'))
    const named = params.has('hp_taxa') ? parseURLList(params.get('hp_taxa')) : null
    const levels = parseURLList(params.get('hp_level')).filter(level => HOST_ID_KEYS.includes(level))
    let evidence = parseURLList(params.get('hp_evidence')).filter(level => EVIDENCE_KEYS.includes(level))
    if (!evidence.length && Object.hasOwn(EVIDENCE_FOR_CONFIDENCE, params.get('hp_conf') ?? '')) evidence = EVIDENCE_FOR_CONFIDENCE[params.get('hp_conf')]
    const shownOpacity = Number(params.get('hp_opacity'))
    if (params.has('hp_opacity') && shownOpacity >= 15 && shownOpacity <= 100) opacity.value = shownOpacity / 100
    if (levels.length) filterHostIdLevels.value = HOST_ID_KEYS.filter(key => levels.includes(key))
    if (evidence.length) filterEvidenceLevels.value = EVIDENCE_KEYS.filter(key => evidence.includes(key))
    if (!butterflies.length && !named) return false
    filterButterflies.value = [...new Set(butterflies)]
    pendingURLTaxa.value = named
    enabled.value = true
    return loadMetadata()
      .then(() => { applyURLSelection(); return true })
      .catch(() => false)
  }

  /** The country outlines the country filter places plant records with (loaded once, when needed). */
  async function loadCountryBoundaries() {
    if (countryBoundaries.value) return countryBoundaries.value
    const basePath = import.meta.env.BASE_URL || '/'
    const response = await fetch(`${basePath}data/country_boundaries.json`)
    if (!response.ok) throw new Error('Unable to load country outlines')
    countryBoundaries.value = await response.json()
    return countryBoundaries.value
  }

  function toggleEnabled() {
    enabled.value = !enabled.value
    if (enabled.value) loadMetadata().catch(() => {})
  }

  function setSelectedTaxa(slugs) {
    const selected = Array.from(new Set(slugs || []))
    selectedTaxonSlugs.value = selected
    enabled.value = selected.length > 0
  }

  function toggleTaxon(slug) {
    if (selectedTaxonSlugs.value.includes(slug)) {
      selectedTaxonSlugs.value = selectedTaxonSlugs.value.filter(item => item !== slug)
    } else {
      selectedTaxonSlugs.value = [...selectedTaxonSlugs.value, slug]
    }
    enabled.value = selectedTaxonSlugs.value.length > 0
  }

  function occurrenceShardNameForFamily(family) {
    const shards = manifest.value?.metadata?.occurrence_core_shards || {}
    return shards[family] || null
  }

  function occurrenceShardNamesForSlugs(slugs = selectedTaxonSlugs.value) {
    const selected = new Set((slugs || []).filter(Boolean))
    const byTaxon = manifest.value?.metadata?.occurrence_core_shards_by_taxon || {}
    const names = new Set()
    if (Object.keys(byTaxon).length > 0) {
      const sourceSlugs = selected.size > 0 ? [...selected] : Object.keys(byTaxon)
      for (const slug of sourceSlugs) {
        const shard = byTaxon[slug]
        if (Array.isArray(shard)) shard.forEach(name => names.add(name))
        else if (shard) names.add(shard)
      }
      return [...names]
    }

    const shards = manifest.value?.metadata?.occurrence_core_shards || {}
    if (Object.keys(shards).length === 0) {
      const datasetPath = manifest.value?.metadata?.occurrence_core_dataset
        || 'host_plant_occurrence_core.json'
      names.add(datasetPath)
      return [...names]
    }
    const sourceTaxa = selected.size > 0
      ? [...selected].map(slug => taxaBySlug.value.get(slug)).filter(Boolean)
      : taxa.value
    for (const taxon of sourceTaxa) {
      const file = occurrenceShardNameForFamily(taxon.family)
      if (file) names.add(file)
    }
    return [...names]
  }

  function enrichOccurrenceForSlug(record, slug) {
    const taxon = taxaBySlug.value.get(slug) || {}
    return {
      ...record,
      id: record.id || record.gbifID || `${slug}-${record.lat},${record.lng}`,
      host_taxon_slug: slug,
      host_taxon_rank: taxon.rank || record.host_taxon_rank,
      host_taxon_name: taxon.canonical_name || record.host_taxon_name || record.scientific_name,
      host_family: taxon.family || record.family,
      gallery_kind: 'host-plants',
    }
  }

  function rebuildOccurrenceDatasetFromV2(slugs = selectedTaxonSlugs.value) {
    const selected = new Set((slugs || []).filter(Boolean))
    const records = []
    const statsBySlug = {}
    const seen = new Set()
    for (const slug of selected) {
      const ref = occurrenceRefCache.value[slug]
      if (!ref) continue
      statsBySlug[slug] = ref.stats_by_slug?.[slug] || { total_records: ref.metadata?.total_records || 0 }
      for (const [chunkName, indexes] of Object.entries(ref.chunks || {})) {
        const chunk = occurrenceChunkCache.value[chunkName]
        if (!chunk) continue
        for (const index of indexes || []) {
          const record = chunk.records?.[index]
          if (!record) continue
          const key = `${slug}|${record.gbifID || record.id || index}`
          if (seen.has(key)) continue
          seen.add(key)
          records.push(enrichOccurrenceForSlug(record, slug))
        }
      }
    }
    occurrenceDataset.value = {
      metadata: {
        ...(manifest.value?.metadata || {}),
        loaded_slugs: [...selected],
        total_records: records.length,
        occurrence_store_version: 2,
      },
      stats_by_slug: statsBySlug,
      records,
    }
  }

  function rebuildOccurrenceDataset() {
    const cache = occurrenceShardCache.value || {}
    const records = []
    const statsBySlug = {}
    const shardMetadata = []
    const aliasLookup = manifest.value?.metadata?.occurrence_core_aliases_by_taxon || {}
    for (const [file, dataset] of Object.entries(cache)) {
      records.push(...(dataset.records || []))
      Object.assign(statsBySlug, dataset.stats_by_slug || {})
      for (const [alias, target] of Object.entries(aliasLookup)) {
        if (dataset.stats_by_slug?.[target] && !statsBySlug[alias]) {
          statsBySlug[alias] = dataset.stats_by_slug[target]
        }
      }
      shardMetadata.push({ file, ...(dataset.metadata || {}) })
    }
    occurrenceDataset.value = {
      metadata: {
        ...(manifest.value?.metadata || {}),
        loaded_shards: Object.keys(cache),
        shard_metadata: shardMetadata,
        total_records: records.length,
      },
      stats_by_slug: statsBySlug,
      records,
    }
  }

  async function loadOccurrences(slugs = selectedTaxonSlugs.value) {
    await loadMetadata()
    const selected = [...new Set((slugs || []).filter(Boolean))]
    const refsByTaxon = manifest.value?.metadata?.occurrence_refs_by_taxon || {}

    if (manifest.value?.metadata?.occurrence_store_version === 2 && Object.keys(refsByTaxon).length > 0) {
      occurrenceLoading.value = true
      occurrenceError.value = null
      try {
        const missingRefs = selected.filter(slug => refsByTaxon[slug] && !occurrenceRefCache.value[slug])
        const loadedRefs = await Promise.all(missingRefs.map(async slug => [slug, await fetchJson(refsByTaxon[slug])]))
        if (loadedRefs.length > 0) {
          occurrenceRefCache.value = { ...occurrenceRefCache.value, ...Object.fromEntries(loadedRefs) }
        }
        const neededChunks = new Set()
        for (const slug of selected) {
          const ref = occurrenceRefCache.value[slug]
          for (const chunkName of Object.keys(ref?.chunks || {})) neededChunks.add(chunkName)
        }
        const missingChunks = [...neededChunks].filter(name => !occurrenceChunkCache.value[name])
        const loadedChunks = await Promise.all(missingChunks.map(async name => [name, await fetchJson(name)]))
        if (loadedChunks.length > 0) {
          occurrenceChunkCache.value = { ...occurrenceChunkCache.value, ...Object.fromEntries(loadedChunks) }
        }
        loadedOccurrenceShards.value = [...neededChunks]
        rebuildOccurrenceDatasetFromV2(selected)
        await preloadGalleryForSlugs(selected)
        return occurrenceDataset.value
      } catch (error) {
        occurrenceError.value = error instanceof Error ? error.message : String(error)
        return null
      } finally {
        occurrenceLoading.value = false
      }
    }

    const shardNames = occurrenceShardNamesForSlugs(slugs)
    const missing = shardNames.filter(name => !occurrenceShardCache.value[name])
    if (missing.length === 0) {
      if (!occurrenceDataset.value) rebuildOccurrenceDataset()
      return occurrenceDataset.value
    }
    occurrenceLoading.value = true
    occurrenceError.value = null
    try {
      const loaded = await Promise.all(missing.map(async name => {
        const dataset = await fetchJson(name)
        return [name, dataset.records
          ? dataset
          : {
              metadata: dataset.metadata || {},
              stats_by_slug: dataset.stats_by_slug || {},
              records: (dataset.features || []).map(feature => {
                const coords = feature.geometry?.coordinates || []
                return {
                  ...(feature.properties || {}),
                  id: feature.properties?.gbifID || `${feature.properties?.host_taxon_slug}-${coords.join(',')}`,
                  lat: Number(coords[1]),
                  lng: Number(coords[0]),
                }
              }),
            }]
      }))
      occurrenceShardCache.value = {
        ...occurrenceShardCache.value,
        ...Object.fromEntries(loaded),
      }
      loadedOccurrenceShards.value = Object.keys(occurrenceShardCache.value)
      rebuildOccurrenceDataset()
      await preloadGalleryForSlugs(slugs)
      return occurrenceDataset.value
    } catch (error) {
      occurrenceError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      occurrenceLoading.value = false
    }
  }

  async function preloadGalleryForSlugs(slugs = selectedTaxonSlugs.value) {
    const selected = [...new Set((slugs || []).filter(Boolean))]
    if (selected.length === 0) return null
    const galleryIndexes = manifest.value?.metadata?.gallery_indexes_by_taxon || {}
    const galleryShards = manifest.value?.metadata?.gallery_shards_by_taxon || {}
    const hasLazyGallery = selected.some(slug => galleryIndexes[slug] || galleryShards[slug])
    if (!hasLazyGallery) return null
    return loadGallery(selected)
  }

  function getGalleryPhotoForSlug(slug) {
    if (!slug) return null
    const item = (galleryDataset.value?.items || []).find(galleryItem =>
      galleryItem?.host_taxon_slug === slug && galleryItem?.image_url
    )
    if (!item) return null
    return {
      url: item.image_url,
      sameOccurrence: false,
      fromId: item.gbifID || item.id || null,
    }
  }

  function getPhotoForOccurrence(occurrence = {}) {
    if (!occurrence) return null
    if (occurrence.image_url) {
      return {
        url: occurrence.image_url,
        sameOccurrence: !occurrence.image_is_fallback,
        fromId: occurrence.gbifID || occurrence.id || null,
      }
    }
    const image = getHostPlantImage(occurrence)
    if (image?.url) {
      return {
        url: image.url,
        sameOccurrence: !image.fallback,
        fromId: occurrence.gbifID || occurrence.id || null,
      }
    }
    return getGalleryPhotoForSlug(occurrence.host_taxon_slug)
  }

  function rebuildGalleryDatasetFromPages(slugs = selectedTaxonSlugs.value, options = {}) {
    const selected = [...new Set((slugs || []).filter(Boolean))]
    const statsBySlug = {}
    const selectedSet = new Set(selected)
    const preserveExisting = Boolean(options.preserveExisting)
    const items = preserveExisting
      ? (galleryDataset.value?.items || []).filter(item => !selectedSet.has(item?.host_taxon_slug))
      : []
    const indexesBySlug = manifest.value?.metadata?.gallery_indexes_by_taxon || {}
    if (preserveExisting) Object.assign(statsBySlug, galleryDataset.value?.stats_by_slug || {})
    for (const slug of selected) {
      const index = galleryIndexCache.value[slug]
      if (!index) continue
      statsBySlug[slug] = index.stats_by_slug?.[slug] || {
        total_records: index.total_images || 0,
        records_with_images: index.total_images || 0,
        records_without_images: 0,
      }
      const pages = index.pages || []
      const visibleLimit = galleryVisibleLimitBySlug.value[slug] || (manifest.value?.metadata?.gallery_page_size || 100)
      let added = 0
      for (const pagePath of pages) {
        const page = galleryPageCache.value[pagePath]
        if (!page) continue
        for (const item of page.items || []) {
          if (added >= visibleLimit) break
          items.push(item)
          added += 1
        }
        if (added >= visibleLimit) break
      }
    }
    galleryDataset.value = {
      metadata: {
        ...(manifest.value?.metadata || {}),
        loaded_slugs: preserveExisting
          ? [...new Set([...(galleryDataset.value?.metadata?.loaded_slugs || []), ...selected])]
          : selected,
        item_count: items.length,
        gallery_store_version: 2,
        preview: Boolean(preserveExisting && galleryDataset.value?.metadata?.preview),
      },
      stats_by_slug: statsBySlug,
      items,
      indexes_by_slug: Object.fromEntries(selected.map(slug => [slug, galleryIndexCache.value[slug]]).filter(([, index]) => Boolean(index))),
      loaded_limits_by_slug: { ...galleryVisibleLimitBySlug.value },
    }
  }

  async function ensureGalleryPagesForLimit(slug, limit) {
    const index = galleryIndexCache.value[slug]
    if (!index) return
    const pageSize = index.page_size || manifest.value?.metadata?.gallery_page_size || 100
    const pageCount = Math.min(index.pages?.length || 0, Math.ceil(limit / pageSize))
    const pagePaths = (index.pages || []).slice(0, pageCount)
    const missingPages = pagePaths.filter(path => !galleryPageCache.value[path])
    if (missingPages.length === 0) return
    const loadedPages = await Promise.all(missingPages.map(async path => [path, await fetchJson(path)]))
    galleryPageCache.value = { ...galleryPageCache.value, ...Object.fromEntries(loadedPages) }
  }

  async function loadGallery(slugs = selectedTaxonSlugs.value) {
    await loadMetadata()
    const selected = [...new Set((slugs || []).filter(Boolean))]
    const galleryIndexes = manifest.value?.metadata?.gallery_indexes_by_taxon || {}

    if (Object.keys(galleryIndexes).length > 0) {
      const previewDataset = manifest.value?.metadata?.gallery_preview_dataset
      if (selected.length === 0 && previewDataset) {
        if (galleryDataset.value?.metadata?.preview) return galleryDataset.value
        galleryLoading.value = true
        galleryError.value = null
        try {
          const preview = await fetchJson(previewDataset)
          galleryDataset.value = {
            metadata: {
              ...(manifest.value?.metadata || {}),
              ...(preview.metadata || {}),
              preview: true,
              gallery_store_version: 2,
              loaded_slugs: [],
            },
            stats_by_slug: preview.stats_by_slug || {},
            items: preview.items || [],
          }
          return galleryDataset.value
        } catch (error) {
          galleryError.value = error instanceof Error ? error.message : String(error)
          return null
        } finally {
          galleryLoading.value = false
        }
      }
      const sourceSlugs = selected.length > 0 ? selected : Object.keys(galleryIndexes)
      galleryLoading.value = true
      galleryError.value = null
      try {
        const missingIndexes = sourceSlugs.filter(slug => galleryIndexes[slug] && !galleryIndexCache.value[slug])
        const loadedIndexes = await Promise.all(missingIndexes.map(async slug => [slug, await fetchJson(galleryIndexes[slug])]))
        if (loadedIndexes.length > 0) {
          galleryIndexCache.value = { ...galleryIndexCache.value, ...Object.fromEntries(loadedIndexes) }
        }
        const defaultLimit = manifest.value?.metadata?.gallery_initial_limit || 10
        for (const slug of sourceSlugs) {
          if (!galleryVisibleLimitBySlug.value[slug]) {
            galleryVisibleLimitBySlug.value = { ...galleryVisibleLimitBySlug.value, [slug]: defaultLimit }
          }
          await ensureGalleryPagesForLimit(slug, galleryVisibleLimitBySlug.value[slug])
        }
        rebuildGalleryDatasetFromPages(sourceSlugs)
        return galleryDataset.value
      } catch (error) {
        galleryError.value = error instanceof Error ? error.message : String(error)
        return null
      } finally {
        galleryLoading.value = false
      }
    }

    const byTaxon = manifest.value?.metadata?.gallery_shards_by_taxon || {}
    const selectedSet = new Set(selected)

    if (Object.keys(byTaxon).length > 0) {
      const sourceSlugs = selectedSet.size > 0 ? [...selectedSet] : Object.keys(byTaxon)
      const shardNames = [...new Set(sourceSlugs.flatMap(slug => {
        const shard = byTaxon[slug]
        return Array.isArray(shard) ? shard : (shard ? [shard] : [])
      }))]
      galleryLoading.value = true
      galleryError.value = null
      try {
        const datasets = await Promise.all(shardNames.map(name => fetchJson(name)))
        const statsBySlug = {}
        const items = []
        const aliasLookup = manifest.value?.metadata?.gallery_aliases_by_taxon || {}
        for (const dataset of datasets) {
          Object.assign(statsBySlug, dataset.stats_by_slug || {})
          for (const [alias, target] of Object.entries(aliasLookup)) {
            if (dataset.stats_by_slug?.[target] && !statsBySlug[alias]) {
              statsBySlug[alias] = dataset.stats_by_slug[target]
            }
          }
          items.push(...(dataset.items || dataset.records || []))
        }
        galleryDataset.value = {
          metadata: {
            ...(manifest.value?.metadata || {}),
            loaded_shards: shardNames,
            item_count: items.length,
          },
          stats_by_slug: statsBySlug,
          items,
        }
        return galleryDataset.value
      } catch (error) {
        galleryError.value = error instanceof Error ? error.message : String(error)
        return null
      } finally {
        galleryLoading.value = false
      }
    }

    if (galleryDataset.value) return galleryDataset.value
    const datasetPath = manifest.value?.metadata?.gallery_dataset || 'host_plant_gallery.json'
    galleryLoading.value = true
    galleryError.value = null
    try {
      galleryDataset.value = await fetchJson(datasetPath)
      return galleryDataset.value
    } catch (error) {
      galleryError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      galleryLoading.value = false
    }
  }

  async function loadMoreGalleryForSlug(slug, increment = 10) {
    await loadMetadata()
    const galleryIndexes = manifest.value?.metadata?.gallery_indexes_by_taxon || {}
    if (galleryIndexes[slug] && !galleryIndexCache.value[slug]) {
      galleryIndexCache.value = {
        ...galleryIndexCache.value,
        [slug]: await fetchJson(galleryIndexes[slug]),
      }
    }
    const currentLoadedForSlug = (galleryDataset.value?.items || [])
      .filter(item => item?.host_taxon_slug === slug)
      .length
    const current = galleryVisibleLimitBySlug.value[slug] || currentLoadedForSlug || 0
    const next = current + increment
    galleryVisibleLimitBySlug.value = { ...galleryVisibleLimitBySlug.value, [slug]: next }
    galleryLoading.value = true
    galleryError.value = null
    try {
      await ensureGalleryPagesForLimit(slug, next)
      rebuildGalleryDatasetFromPages([slug], { preserveExisting: Boolean(galleryDataset.value?.metadata?.preview) })
      return galleryDataset.value
    } catch (error) {
      galleryError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      galleryLoading.value = false
    }
  }

  function moveGalleryPhotoContext(key, direction) {
    const order = [...galleryPhotoContextOrder.value]
    const index = order.indexOf(key)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return
    const [item] = order.splice(index, 1)
    order.splice(nextIndex, 0, item)
    galleryPhotoContextOrder.value = order
  }

  function setGalleryDateOrder(order) {
    galleryDateOrder.value = order === 'asc' ? 'asc' : 'desc'
  }

  /**
   * The selected taxa's records as GeoJSON. `region` ({ countries, bbox }) keeps the records
   * inside those countries (placed with the country outlines) and that box.
   */
  function getOccurrenceCollectionForTaxa(slugs = selectedTaxonSlugs.value, region = null) {
    const selected = new Set((slugs || []).filter(Boolean))
    const inRegion = region ? makeRegionTest(region, countryBoundaries.value) : null
    const features = (occurrenceDataset.value?.records || [])
      .filter(record => selected.has(record?.host_taxon_slug))
      .filter(record => !inRegion || inRegion(Number(record.lng), Number(record.lat)))
      .map(record => hostPlantRecordToFeature(record))
    return {
      type: 'FeatureCollection',
      metadata: occurrenceDataset.value?.metadata || {},
      features,
    }
  }

  function occurrenceCountForSlug(slug) {
    return (occurrenceDataset.value?.records || [])
      .filter(record => record?.host_taxon_slug === slug)
      .length
  }

  watch(
    [selectedTaxonSlugs, filterButterflies, filterHostIdLevels, filterEvidenceLevels, pendingURLTaxa, opacity],
    () => useViewStore().syncURLState(),
    { deep: true },
  )
  // The sidebar switches the layer on when it mounts, before the link is read: syncing then would
  // write the URL without the link's filters. Switching it later updates the link.
  watch(enabled, () => { if (urlRead) useViewStore().syncURLState() })

  return {
    manifest,
    taxa,
    associations,
    loading,
    enabled,
    selectedTaxonSlugs,
    opacity,
    occurrenceDataset,
    occurrenceLoading,
    occurrenceError,
    loadedOccurrenceShards,
    occurrenceShardCache,
    occurrenceRefCache,
    occurrenceChunkCache,
    galleryDataset,
    galleryLoading,
    galleryError,
    galleryIndexCache,
    galleryPageCache,
    galleryVisibleLimitBySlug,
    galleryPhotoContextOrder,
    galleryDateOrder,
    confidenceLevels,
    hostIdLevels,
    evidenceLevels,
    galleryPhotoContextOptions,
    taxaBySlug,
    activeTaxa,
    caveat,
    loadMetadata,
    confidenceBucket,
    confidenceLabel,
    confidenceDisplayLabel,
    confidencePasses,
    confidenceCountsForAssociations,
    normalizeHostIdLevelSelection,
    normalizeEvidenceSelection,
    associationMatchesHostFilters,
    getButterflyOptionsForHostPlants,
    getTaxaForButterflies,
    getSpeciesLevelTaxaForButterflies,
    getOccurrenceTaxonOptionsForButterflies,
    filterOccurrenceTaxonOptions,
    toggleEnabled,
    setSelectedTaxa,
    toggleTaxon,
    loadOccurrences,
    occurrenceShardNamesForSlugs,
    loadGallery,
    loadMoreGalleryForSlug,
    preloadGalleryForSlugs,
    getPhotoForOccurrence,
    moveGalleryPhotoContext,
    setGalleryDateOrder,
    getOccurrenceCollectionForTaxa,
    occurrenceCountForSlug,
    filterButterflies,
    filterHostIdLevels,
    filterEvidenceLevels,
    autoSlugsByButterfly,
    pendingURLTaxa,
    countryBoundaries,
    setFilterButterflies,
    setFilterHostIdLevels,
    setFilterEvidenceLevels,
    refreshButterflySelection,
    appendURLParams,
    restoreFromURL,
    loadCountryBoundaries,
  }
})
