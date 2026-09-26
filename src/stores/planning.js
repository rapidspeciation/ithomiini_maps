import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDataStore } from './data'
import { useViewStore } from './viewStore'
import { groupCollectionSites } from '../utils/collectionSites'
import { rowsToCsv, downloadCsv } from '../utils/tableExport'

const STORAGE_KEY = 'field-planning-shortlist'

function savedShortlist() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.filter(id => typeof id === 'string' && id.startsWith('site:')) : []
  } catch {
    return []
  }
}

function safeText(value) {
  const text = String(value ?? '')
  return /^\s*[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

/** CSV for visible sites; each row represents a site and counts records, not individuals. */
export function sitesToCsv(sites) {
  const columns = [
    { label: 'Site ID', value: site => safeText(site.id) },
    { label: 'Locality', value: site => safeText(site.name) },
    { label: 'Named locality', value: site => site.named ? 'Yes' : 'No' },
    { label: 'Country', value: site => safeText(site.country) },
    { label: 'Latitude', value: site => site.latitude },
    { label: 'Longitude', value: site => site.longitude },
    { label: 'Records', value: site => site.recordCount },
    { label: 'Taxa', value: site => site.taxonCount },
    { label: 'Target taxa present', value: site => site.coverageCount ?? '' },
    { label: 'Target taxa total', value: site => site.coverageTotal ?? '' },
    { label: 'Dated records', value: site => site.datedRecordCount },
    { label: 'First dated record', value: site => site.earliestDate ?? '' },
    { label: 'Latest dated record', value: site => site.latestDate ?? '' },
    { label: 'Target record counts', value: site => safeText(site.targetCounts?.map(({ label, count }) => `${label}: ${count}`).join('; ') ?? '') },
    { label: 'Taxon record counts', value: site => safeText(site.taxonCounts.map(({ taxon, count }) => `${taxon}: ${count}`).join('; ')) },
  ]
  return rowsToCsv(columns, sites)
}

export const usePlanningStore = defineStore('planning', () => {
  const data = useDataStore()
  // 'auto' names the busiest sites in view; 'records' names every site with minRecords.
  const localitySettings = reactive({ enabled: true, mode: 'auto', minRecords: 10 })
  const showComparison = ref(false)
  const comparisonMinimized = ref(false)
  // Sites whose names are always shown (eye on), and sites whose names are hidden (eye off).
  const shortlistIds = ref(savedShortlist())
  const hiddenLabelIds = ref([])
  // Written by the locality layer: sites named on the map now, and the map bounds [w, s, e, n].
  const labeledSiteIds = ref(new Set())
  const viewBounds = ref(null)
  const selectedSiteId = ref(null)
  const focusRequestId = ref(0)

  const targetDefinitions = computed(() => data.taxonTargets || [])
  const targetTaxa = computed(() => targetDefinitions.value.map(target => target.label))

  const sites = computed(() => {
    return groupCollectionSites(data.filteredGeoJSON).map(site => {
      const speciesCounts = new Map(site.taxonCounts.map(({ taxon, count }) => [taxon, count]))
      const subspeciesCounts = new Map(site.subspeciesCounts.map(({ taxon, subspecies, count }) => [`${taxon}\0${subspecies}`, count]))
      site.targetCounts = targetDefinitions.value.map(({ label, species, subspecies }) => ({
        label,
        count: subspecies === null
          ? speciesCounts.get(species) || 0
          : subspeciesCounts.get(`${species}\0${subspecies}`) || 0,
      }))
      site.coverageCount = site.targetCounts.filter(target => target.count > 0).length
      site.coverageTotal = site.targetCounts.length
      site.coveragePercent = site.coverageTotal ? Math.round(100 * site.coverageCount / site.coverageTotal) : 0
      return site
    })
  })
  const sitesInView = computed(() => {
    const bounds = viewBounds.value
    if (!bounds) return sites.value
    const [west, south, east, north] = bounds
    // Bounds can cross the antimeridian when the map is zoomed far out.
    const inLongitude = west <= east ? lng => lng >= west && lng <= east : lng => lng >= west || lng <= east
    return sites.value.filter(site => site.latitude >= south && site.latitude <= north && inLongitude(site.longitude))
  })

  const shortlistSet = computed(() => new Set(shortlistIds.value))
  const hiddenLabelSet = computed(() => new Set(hiddenLabelIds.value))
  const shortlistedSites = computed(() => sites.value.filter(site => shortlistSet.value.has(site.id)))

  function toggleShortlist(siteOrId) {
    const id = typeof siteOrId === 'string' ? siteOrId : siteOrId?.id
    if (!id) return
    shortlistIds.value = shortlistSet.value.has(id)
      ? shortlistIds.value.filter(value => value !== id)
      : [...shortlistIds.value, id]
  }

  const isLabelShown = id => shortlistSet.value.has(id) || labeledSiteIds.value.has(id)

  /** Eye button: hide a named site, or always name one that is not named. */
  function toggleLabel(siteOrId) {
    const id = typeof siteOrId === 'string' ? siteOrId : siteOrId?.id
    if (!id) return
    if (isLabelShown(id)) {
      shortlistIds.value = shortlistIds.value.filter(value => value !== id)
      if (!hiddenLabelSet.value.has(id)) hiddenLabelIds.value = [...hiddenLabelIds.value, id]
    } else {
      hiddenLabelIds.value = hiddenLabelIds.value.filter(value => value !== id)
      shortlistIds.value = [...shortlistIds.value, id]
    }
  }

  function setLabeledSites(ids) {
    const next = new Set(ids)
    const current = labeledSiteIds.value
    if (next.size !== current.size || [...next].some(id => !current.has(id))) labeledSiteIds.value = next
  }

  function setViewBounds(bounds) {
    const current = viewBounds.value
    if (!current || bounds.some((value, index) => Math.abs(value - current[index]) > 1e-6)) viewBounds.value = bounds
  }

  function focusSite(site) {
    if (!site?.id) return
    selectedSiteId.value = site.id
    focusRequestId.value++
  }

  function exportSiteCsv(scope = 'all') {
    const rows = scope === 'shortlist' ? shortlistedSites.value : sites.value
    if (!rows.length) return false
    downloadCsv(`field-sites-${scope}.csv`, sitesToCsv(rows))
    return true
  }

  function appendURLParams(params) {
    if (!localitySettings.enabled) params.set('sites', '0')
    if (localitySettings.mode === 'records') params.set('site_labels', 'records')
    if (localitySettings.minRecords !== 10) params.set('site_min', String(localitySettings.minRecords))
    if (showComparison.value) params.set('site_compare', '1')
    if (shortlistIds.value.length) params.set('site_shortlist', JSON.stringify(shortlistIds.value))
    if (hiddenLabelIds.value.length) params.set('site_hidden', JSON.stringify(hiddenLabelIds.value))
  }

  const parseSiteIds = value => {
    try {
      const list = JSON.parse(value)
      if (Array.isArray(list) && list.length <= 200 && list.every(id => typeof id === 'string' && id.startsWith('site:') && id.length <= 500)) {
        return [...new Set(list)]
      }
    } catch { /* Ignore invalid shared links. */ }
    return null
  }

  function restoreFromURL(params) {
    if (params.get('sites') === '0') localitySettings.enabled = false
    else if (params.get('sites') === '1') localitySettings.enabled = true
    if (params.get('site_labels') === 'records') localitySettings.mode = 'records'
    else if (params.get('site_labels') === 'auto') localitySettings.mode = 'auto'
    const minimum = Number(params.get('site_min'))
    if (params.has('site_min') && Number.isInteger(minimum) && minimum >= 1 && minimum <= 10000) localitySettings.minRecords = minimum
    if (params.get('site_compare') === '1') showComparison.value = true
    else if (params.get('site_compare') === '0') showComparison.value = false
    const shortlist = params.has('site_shortlist') && parseSiteIds(params.get('site_shortlist'))
    if (shortlist) shortlistIds.value = shortlist
    const hidden = params.has('site_hidden') && parseSiteIds(params.get('site_hidden'))
    if (hidden) hiddenLabelIds.value = hidden
  }

  watch(shortlistIds, value => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Private browsing can block storage. */ }
  })
  watch(showComparison, visible => {
    if (!visible) comparisonMinimized.value = false
  })
  watch([localitySettings, showComparison, shortlistIds, hiddenLabelIds], () => useViewStore().syncURLState(), { deep: true })

  return {
    localitySettings, showComparison, comparisonMinimized, shortlistIds, shortlistSet, selectedSiteId,
    hiddenLabelIds, hiddenLabelSet, labeledSiteIds, viewBounds, sitesInView, isLabelShown, toggleLabel,
    setLabeledSites, setViewBounds,
    focusRequestId, targetTaxa, targetDefinitions, sites, shortlistedSites, toggleShortlist,
    focusSite, exportSiteCsv, appendURLParams, restoreFromURL,
  }
})
