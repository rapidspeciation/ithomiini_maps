<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useMagicKeys, onClickOutside } from '@vueuse/core'
import { useDataStore } from '@/stores/data'
import { useLegendStore } from '@/stores/legend'
import { useThemeStore } from '@/stores/theme'
import { getThemeOptions } from '@/themes/presets'
const THEME_PRESETS = getThemeOptions()
import { isValidValue } from '@/utils/validation'
import config from '@/config'
import { useLocationSearch } from '@/composables/useLocationSearch'

const store = useDataStore()
const legendStore = useLegendStore()
const themeStore = useThemeStore()

const openGalleryFn = inject('openImageGallery', null)
const openMimicryFn = inject('openMimicrySelector', null)
const openExportFn = inject('openExport', null)
const directExportMapFn = inject('directExportMap', null)
const setViewFn = inject('setView', null)
const mobileLayout = inject('mobileLayout', null)
const mapRef = inject('mapRef', null)

// Phones have no location box (the pill bar takes its row), so the sheet offers places too. The geocoder runs on a
// tap, not as you type: species names would otherwise be sent to it on every search.
const isPhone = computed(() => Boolean(mobileLayout?.isMobile?.value))
const places = useLocationSearch(mapRef || ref(null))
const placesQuery = ref('')
const showPlaces = computed(() => isPhone.value && query.value.trim().length >= 2)
const placeResults = computed(() =>
  placesQuery.value && placesQuery.value === query.value.trim() ? places.searchResults.value : [])
const searchPlaces = () => {
  placesQuery.value = query.value.trim()
  places.searchLocation(placesQuery.value)
}
const selectPlace = async (result) => {
  dialogOpen.value = false
  setViewFn?.('map')
  await nextTick()
  mapRef?.value?.resize?.()
  places.selectSearchResult(result)
}

const dialogOpen = ref(false)
const inputRef = ref(null)
const rootRef = ref(null)
const listRef = ref(null)
const query = ref('')
const activeIndex = ref(0)

const MAX_RESULTS = 50
const MAX_SUGGESTIONS = 3
const LEVEL_BONUS = {
  species: 100, subspecies: 95, genus: 80, tribe: 70, family: 60, country: 50, mimicry: 40,
  action: 80, setting: 75, filter: 70,
}
const GROUP_ORDER = ['actions', 'settings', 'filters', 'taxonomy', 'geography', 'mimicry']
const GROUP_HEADINGS = {
  actions: 'Actions',
  settings: 'Settings',
  filters: 'Filters',
  taxonomy: 'Taxonomy',
  geography: 'Geography',
  mimicry: 'Mimicry',
}

const buildOptionMap = (features, field, kind, typeLabel, lineageBuilder = () => ({}), ownTokenBuilder) => {
  const options = new Map()
  for (const feature of features) {
    const value = feature[field]
    if (!isValidValue(value)) continue
    const existing = options.get(value)
    if (existing) { existing.count += 1; continue }
    const lineage = lineageBuilder(feature)
    options.set(value, {
      id: `${kind}:${value}`,
      value,
      kind,
      typeLabel,
      count: 1,
      lineage,
      ownTokens: (ownTokenBuilder ? ownTokenBuilder(feature, lineage) : [value]).map(s => s.toLowerCase()),
    })
  }
  return Array.from(options.values())
}

const subspeciesEpithet = (sub) => {
  const tokens = sub.trim().split(/\s+/).filter(t => !/^[A-Z]\.?$/.test(t))
  return (tokens[tokens.length - 1] || sub).toLowerCase()
}

const buildSubspeciesMap = (features) => {
  const options = new Map()
  for (const feature of features) {
    const sub = feature.subspecies
    const species = feature.scientific_name
    if (!isValidValue(sub) || !isValidValue(species)) continue
    const key = `${species}|${sub}`
    const existing = options.get(key)
    if (existing) { existing.count += 1; continue }
    options.set(key, {
      id: `subspecies:${key}`,
      value: sub,
      displayValue: `${species} ${sub}`,
      speciesName: species,
      kind: 'subspecies',
      typeLabel: 'Subspecies',
      count: 1,
      lineage: { family: feature.family, tribe: feature.tribe, genus: feature.genus, scientificName: species },
      ownTokens: [subspeciesEpithet(sub)],
    })
  }
  return Array.from(options.values())
}

const speciesEpithet = (scientificName, genus) => {
  if (!scientificName) return null
  if (genus && scientificName.toLowerCase().startsWith(genus.toLowerCase() + ' ')) {
    return scientificName.slice(genus.length + 1)
  }
  const parts = scientificName.split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : scientificName
}

const allItems = computed(() => {
  const features = store.allFeatures || []
  const items = [
    ...buildOptionMap(features, 'scientific_name', 'species', 'Species',
      f => ({ family: f.family, tribe: f.tribe, genus: f.genus, scientificName: f.scientific_name }),
      f => {
        const epithet = speciesEpithet(f.scientific_name, f.genus)
        return epithet ? [epithet] : [f.scientific_name]
      }),
    ...buildSubspeciesMap(features),
    ...buildOptionMap(features, 'genus', 'genus', 'Genus',
      f => ({ family: f.family, tribe: f.tribe, genus: f.genus })),
    ...buildOptionMap(features, 'tribe', 'tribe', 'Tribe',
      f => ({ family: f.family, tribe: f.tribe })),
    ...buildOptionMap(features, 'family', 'family', 'Family',
      f => ({ family: f.family })),
    ...buildOptionMap(features, 'country', 'country', 'Country'),
    ...(config.features.mimicrySelector
      ? buildOptionMap(features, 'mimicry_ring', 'mimicry', 'Mimicry ring')
      : []),
  ]
  return items
})

const VIZ_MODES = [
  { value: 'points', label: 'Points' },
  { value: 'clusters', label: 'Clusters' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'ranges', label: 'Ranges' },
]

const uniqueStatuses = computed(() => {
  const set = new Set()
  for (const f of store.allFeatures || []) {
    if (isValidValue(f.sequencing_status)) set.add(f.sequencing_status)
  }
  return [...set].sort()
})

const commandItems = computed(() => {
  const cmds = []
  const make = (id, kind, label, { group = 'settings', typeLabel = '', searchText = '', active = false, shortcut = '', run }) => ({
    id, kind, value: label, group, typeLabel, label,
    ownTokens: [label.toLowerCase(), ...(searchText ? [searchText.toLowerCase()] : [])],
    active, shortcut, run,
    count: 1,
  })

  // Actions (navigation, modals)
  cmds.push(make('action:gallery', 'action', 'Open Gallery', {
    group: 'actions', typeLabel: 'Action',
    searchText: 'photos images gallery',
    run: () => openGalleryFn?.(),
  }))
  if (config.features.mimicrySelector) {
    cmds.push(make('action:mimicry', 'action', 'Open Mimicry Selector', {
      group: 'actions', typeLabel: 'Action',
      searchText: 'mimicry rings selector',
      run: () => openMimicryFn?.(),
    }))
  }
  cmds.push(make('action:export-panel', 'action', 'Open Export & Share Panel', {
    group: 'actions', typeLabel: 'Action',
    searchText: 'export share citation download',
    run: () => openExportFn?.(),
  }))
  cmds.push(make('action:download-map', 'action', 'Download Map Image', {
    group: 'actions', typeLabel: 'Action',
    searchText: 'export map png jpg image download',
    run: () => directExportMapFn?.(),
  }))
  cmds.push(make('action:view-map', 'action', 'Switch to Map View', {
    group: 'actions', typeLabel: 'Action',
    searchText: 'map view show map',
    active: store.currentView === 'map',
    run: () => setViewFn?.('map'),
  }))
  cmds.push(make('action:view-table', 'action', 'Switch to Table View', {
    group: 'actions', typeLabel: 'Action',
    searchText: 'table data view',
    active: store.currentView === 'table',
    run: () => setViewFn?.('table'),
  }))
  if (config.features.databaseUpdate) {
    cmds.push(make('action:db-update', 'action', 'Update Database', {
      group: 'actions', typeLabel: 'Action',
      searchText: 'update database refresh sync',
      run: () => {
        store.showDatabaseUpdatePanel = true
        const panel = document.querySelector('.database-update-section')
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
      },
    }))
  }

  // Settings (toggles + setters)
  cmds.push(make('setting:legend', 'setting', legendStore.showLegend ? 'Hide Legend' : 'Show Legend', {
    group: 'settings', typeLabel: 'Toggle',
    searchText: 'legend hide show',
    active: legendStore.showLegend,
    run: () => { legendStore.showLegend = !legendStore.showLegend },
  }))
  cmds.push(make('setting:export-preview', 'setting', store.exportSettings.enabled ? 'Disable Export Preview' : 'Enable Export Preview', {
    group: 'settings', typeLabel: 'Toggle',
    searchText: 'preview export frame aspect ratio',
    active: store.exportSettings.enabled,
    run: () => { store.exportSettings.enabled = !store.exportSettings.enabled },
  }))
  cmds.push(make('setting:mode', 'setting', themeStore.currentMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode', {
    group: 'settings', typeLabel: 'Theme',
    searchText: 'dark light mode theme appearance',
    active: false,
    run: () => themeStore.toggleMode(),
  }))
  if (themeStore.modePref !== 'system') {
    cmds.push(make('setting:mode-system', 'setting', 'Follow System Light/Dark', {
      group: 'settings', typeLabel: 'Theme',
      searchText: 'dark light mode theme appearance system automatic',
      active: false,
      run: () => themeStore.setModePref('system'),
    }))
  }
  for (const mode of VIZ_MODES) {
    cmds.push(make(`setting:viz:${mode.value}`, 'setting', `Visualization: ${mode.label}`, {
      group: 'settings', typeLabel: 'Visualization',
      searchText: `visualization ${mode.value} ${mode.label.toLowerCase()}`,
      active: store.visualizationMode === mode.value,
      run: () => { store.visualizationMode = mode.value },
    }))
  }
  for (const theme of THEME_PRESETS) {
    cmds.push(make(`setting:theme:${theme.value}`, 'setting', `Theme: ${theme.label}`, {
      group: 'settings', typeLabel: 'Theme',
      searchText: `theme ${theme.value} ${theme.label.toLowerCase()}`,
      active: themeStore.currentTheme === theme.value,
      run: () => themeStore.setTheme(theme.value),
    }))
  }

  // Filters (toggles for array membership)
  const availableSources = [...Object.keys(store.sourceConfig || {})]
  for (const src of availableSources) {
    const isActive = store.filters.source.includes(src)
    cmds.push(make(`filter:source:${src}`, 'filter', `${isActive ? 'Disable' : 'Enable'} source: ${src}`, {
      group: 'filters', typeLabel: 'Source',
      searchText: `source ${src.toLowerCase()} data`,
      active: isActive,
      run: () => {
        store.filters.source = isActive
          ? store.filters.source.filter(s => s !== src)
          : [...store.filters.source, src]
      },
    }))
  }
  for (const status of uniqueStatuses.value) {
    const isActive = store.filters.status.includes(status)
    cmds.push(make(`filter:status:${status}`, 'filter', `${isActive ? 'Remove' : 'Add'} status: ${status}`, {
      group: 'filters', typeLabel: 'Status',
      searchText: `status ${status.toLowerCase()} sequencing`,
      active: isActive,
      run: () => {
        store.filters.status = isActive
          ? store.filters.status.filter(s => s !== status)
          : [...store.filters.status, status]
      },
    }))
  }
  const SEX_OPTIONS = [
    { value: 'all', label: 'All sexes' },
    { value: 'male', label: 'Males only' },
    { value: 'female', label: 'Females only' },
  ]
  for (const opt of SEX_OPTIONS) {
    cmds.push(make(`filter:sex:${opt.value}`, 'filter', `Sex: ${opt.label}`, {
      group: 'filters', typeLabel: 'Sex',
      searchText: `sex ${opt.value} ${opt.label.toLowerCase()}`,
      active: store.filters.sex === opt.value,
      run: () => { store.filters.sex = opt.value },
    }))
  }

  return cmds
})

// Commands that stay open after action (toggles); actions that close after run (navigation).
const CLOSE_AFTER_RUN = new Set(['action:gallery', 'action:mimicry', 'action:export-panel', 'action:download-map', 'action:view-map', 'action:view-table', 'action:db-update'])

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = i
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]
      row[j] = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev)
      prev = temp
    }
    row[0] = i
  }
  return row[b.length]
}

const WORD_BREAK = /[\s\-_/]/
const isWordStart = (hay, idx) => idx === 0 || WORD_BREAK.test(hay[idx - 1])

function scoreItem(item, queryLower) {
  const ownTokens = item.ownTokens || [item.value.toLowerCase()]
  const displayHay = (item.displayValue || item.value).toLowerCase()

  let bestScore = -Infinity
  let matchField = null
  let matchIndex = -1

  const COUNT_WEIGHT = 15

  for (const token of ownTokens) {
    const idx = token.indexOf(queryLower)
    if (idx === -1) continue
    const score = (isWordStart(token, idx) ? 1200 : 200)
      + (LEVEL_BONUS[item.kind] || 0)
      + Math.log10(item.count + 1) * COUNT_WEIGHT
    if (score > bestScore) {
      bestScore = score
      matchField = token
      matchIndex = idx
    }
  }

  if (bestScore === -Infinity) {
    const idx = displayHay.indexOf(queryLower)
    if (idx === -1) return null
    const score = (isWordStart(displayHay, idx) ? 900 : 150)
      + (LEVEL_BONUS[item.kind] || 0)
      + Math.log10(item.count + 1) * COUNT_WEIGHT
    bestScore = score
    matchField = displayHay
    matchIndex = idx
  }

  return { item, score: bestScore, matchField, matchIndex, matchLength: queryLower.length }
}

const defaultCommands = computed(() => {
  const preferredOrder = [
    'action:gallery', 'action:mimicry', 'action:view-table', 'action:view-map',
    'action:download-map', 'action:export-panel', 'action:db-update',
    'setting:legend', 'setting:export-preview', 'setting:mode',
  ]
  const byId = new Map(commandItems.value.map(c => [c.id, c]))
  const list = []
  for (const id of preferredOrder) {
    const cmd = byId.get(id)
    if (cmd) list.push({ item: cmd, score: 0, matchField: null, matchIndex: -1, matchLength: 0 })
  }
  return list
})

const ranked = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return { groups: [], suggestions: [], isDefault: true, defaultItems: defaultCommands.value }

  const hits = []
  for (const item of allItems.value) {
    const scored = scoreItem(item, q)
    if (scored) hits.push(scored)
  }
  for (const cmd of commandItems.value) {
    const scored = scoreItem(cmd, q)
    if (scored) hits.push(scored)
  }
  hits.sort((a, b) => b.score - a.score)

  const limited = hits.slice(0, MAX_RESULTS)

  const hitIds = new Set(hits.map(h => h.item.id))
  const distances = []
  for (const item of allItems.value) {
    if (hitIds.has(item.id)) continue
    const hay = (item.kind === 'subspecies' ? item.displayValue : item.value).toLowerCase()
    const tokens = hay.split(/[\s\-_/]+/).filter(Boolean)
    let best = Infinity
    for (const tok of tokens) {
      const d = levenshtein(q, tok.slice(0, Math.max(q.length, tok.length)))
      if (d < best) best = d
    }
    if (best > 0 && best <= 2) distances.push({ item, dist: best })
  }
  distances.sort((a, b) => a.dist - b.dist || b.item.count - a.item.count)
  const suggestions = []
  const seen = new Set()
  for (const { item } of distances) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    suggestions.push({ item, score: 0, matchField: null, matchIndex: -1, matchLength: 0 })
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  const byGroup = { actions: [], settings: [], filters: [], taxonomy: [], geography: [], mimicry: [] }
  for (const hit of limited) {
    const g = hit.item.group
    if (g === 'actions' || g === 'settings' || g === 'filters') {
      byGroup[g].push(hit)
    } else if (hit.item.kind === 'country') {
      byGroup.geography.push(hit)
    } else if (hit.item.kind === 'mimicry') {
      byGroup.mimicry.push(hit)
    } else {
      byGroup.taxonomy.push(hit)
    }
  }
  const groups = GROUP_ORDER
    .map(key => ({ key, heading: GROUP_HEADINGS[key], items: byGroup[key] }))
    .filter(g => g.items.length > 0)

  return { groups, suggestions, isDefault: false, defaultItems: [] }
})

const flatResults = computed(() => {
  const list = []
  if (ranked.value.isDefault) {
    for (const hit of ranked.value.defaultItems) list.push(hit)
    return list
  }
  for (const group of ranked.value.groups) {
    for (const hit of group.items) list.push(hit)
  }
  for (const hit of ranked.value.suggestions) list.push(hit)
  return list
})

watch(flatResults, () => { activeIndex.value = 0 })

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => HTML_ESCAPES[c])

function highlight(text, hit) {
  const q = query.value.trim().toLowerCase()
  if (!q) return escapeHtml(text)
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) return escapeHtml(text)
  const len = hit?.matchLength ?? q.length
  return escapeHtml(text.slice(0, idx))
    + '<strong>' + escapeHtml(text.slice(idx, idx + len)) + '</strong>'
    + escapeHtml(text.slice(idx + len))
}

function addToArrayFilter(key, value) {
  if (!store.filters[key].includes(value)) {
    store.filters[key] = [...store.filters[key], value]
  }
}

function selectItem(item) {
  switch (item.kind) {
    case 'family':
      addToArrayFilter('family', item.value)
      break
    case 'tribe':
      addToArrayFilter('tribe', item.value)
      break
    case 'genus':
      addToArrayFilter('genus', item.value)
      break
    case 'species':
      addToArrayFilter('species', item.value)
      break
    case 'subspecies':
      if (item.speciesName) addToArrayFilter('species', item.speciesName)
      addToArrayFilter('subspecies', item.value)
      break
    case 'country':
      addToArrayFilter('country', item.value)
      break
    case 'mimicry':
      addToArrayFilter('mimicry', item.value)
      break
    case 'action':
    case 'setting':
    case 'filter':
      item.run?.()
      if (CLOSE_AFTER_RUN.has(item.id)) {
        dialogOpen.value = false
        return
      }
      break
  }
  query.value = ''
}

const taxonomyLineage = computed(() => {
  const speciesGenus = new Map()
  const speciesTribe = new Map()
  const speciesFamily = new Map()
  const genusTribe = new Map()
  const genusFamily = new Map()
  const tribeFamily = new Map()
  const subspeciesToSpecies = new Map()

  for (const f of store.allFeatures || []) {
    const sp = f.scientific_name, gn = f.genus, tr = f.tribe, fa = f.family, ssp = f.subspecies
    if (sp && gn) speciesGenus.set(sp, gn)
    if (sp && tr) speciesTribe.set(sp, tr)
    if (sp && fa) speciesFamily.set(sp, fa)
    if (gn && tr) genusTribe.set(gn, tr)
    if (gn && fa) genusFamily.set(gn, fa)
    if (tr && fa) tribeFamily.set(tr, fa)
    if (ssp && sp) {
      if (!subspeciesToSpecies.has(ssp)) subspeciesToSpecies.set(ssp, new Set())
      subspeciesToSpecies.get(ssp).add(sp)
    }
  }
  return { speciesGenus, speciesTribe, speciesFamily, genusTribe, genusFamily, tribeFamily, subspeciesToSpecies }
})

const subspeciesParents = computed(() => taxonomyLineage.value.subspeciesToSpecies)

const ancestorsOf = (value, valueLevel, targetLevel) => {
  const L = taxonomyLineage.value
  if (valueLevel === targetLevel) return new Set([value])
  if (valueLevel === 'subspecies') {
    const parents = L.subspeciesToSpecies.get(value) || new Set()
    if (targetLevel === 'species') return parents
    const result = new Set()
    for (const sp of parents) {
      const up = ancestorsOf(sp, 'species', targetLevel)
      up.forEach(x => result.add(x))
    }
    return result
  }
  if (valueLevel === 'species') {
    if (targetLevel === 'genus') return new Set([L.speciesGenus.get(value)].filter(Boolean))
    if (targetLevel === 'tribe') return new Set([L.speciesTribe.get(value)].filter(Boolean))
    if (targetLevel === 'family') return new Set([L.speciesFamily.get(value)].filter(Boolean))
  }
  if (valueLevel === 'genus') {
    if (targetLevel === 'tribe') return new Set([L.genusTribe.get(value)].filter(Boolean))
    if (targetLevel === 'family') return new Set([L.genusFamily.get(value)].filter(Boolean))
  }
  if (valueLevel === 'tribe') {
    if (targetLevel === 'family') return new Set([L.tribeFamily.get(value)].filter(Boolean))
  }
  return new Set()
}

const resolveSubspeciesParent = (sub, activeSpecies) => {
  const parents = subspeciesParents.value.get(sub)
  if (!parents || parents.size === 0) return null
  const matched = activeSpecies.find(sp => parents.has(sp))
  if (matched) return matched
  return parents.values().next().value
}

const removeFromArray = (key, value) => () => {
  store.filters[key] = store.filters[key].filter(v => v !== value)
}

const toggleCombinator = (level) => {
  const combinators = store.filters.taxonomyCombinators || { tribe: 'AND', genus: 'AND', species: 'AND', subspecies: 'AND' }
  store.filters.taxonomyCombinators = {
    ...combinators,
    [level]: combinators[level] === 'AND' ? 'OR' : 'AND',
  }
}

const LEVEL_PARENTS = {
  tribe: ['family'],
  genus: ['family', 'tribe'],
  species: ['family', 'tribe', 'genus'],
  subspecies: ['family', 'tribe', 'genus', 'species'],
}

const recordCount = computed(() => store.filteredGeoJSON?.features?.length ?? 0)

const zeroResultSuggestion = computed(() => {
  if (recordCount.value > 0) return null
  const f = store.filters
  const combos = f.taxonomyCombinators || { tribe: 'AND', genus: 'AND', species: 'AND', subspecies: 'AND' }
  const activeLevels = ['family', 'tribe', 'genus', 'species', 'subspecies'].filter(L => f[L].length > 0)
  if (activeLevels.length < 2) return null

  for (const L of ['subspecies', 'species', 'genus', 'tribe']) {
    if (f[L].length === 0) continue
    if (combos[L] === 'OR') continue

    let allDisjoint = true
    for (const parentL of LEVEL_PARENTS[L]) {
      if (f[parentL].length === 0) continue
      const parentSet = new Set(f[parentL])
      const anyShared = f[L].some(v => {
        const up = ancestorsOf(v, L, parentL)
        for (const a of up) if (parentSet.has(a)) return true
        return false
      })
      if (anyShared) { allDisjoint = false; break }
    }
    if (allDisjoint) {
      return { level: L, humanLabel: { tribe: 'Tribe', genus: 'Genus', species: 'Species', subspecies: 'Subspecies' }[L] }
    }
  }
  return null
})

const applySuggestion = () => {
  if (zeroResultSuggestion.value) toggleCombinator(zeroResultSuggestion.value.level)
}

const activeFilters = computed(() => {
  const taxonomy = []
  const other = []
  const f = store.filters

  const pushLevelGroup = (levelName, type, entries) => {
    if (entries.length === 0) return
    if (taxonomy.length > 0) {
      const combinator = f.taxonomyCombinators?.[levelName] || 'AND'
      taxonomy.push({ type: 'combinator', level: levelName, value: combinator })
    }
    taxonomy.push({ type: 'group', label: type, chips: entries })
  }

  pushLevelGroup('family', 'Family', f.family.map(v => ({
    key: `family:${v}`, label: v, remove: removeFromArray('family', v),
  })))
  pushLevelGroup('tribe', 'Tribe', f.tribe.map(v => ({
    key: `tribe:${v}`, label: v, remove: removeFromArray('tribe', v),
  })))
  pushLevelGroup('genus', 'Genus', f.genus.map(v => ({
    key: `genus:${v}`, label: v, remove: removeFromArray('genus', v),
  })))
  pushLevelGroup('species', 'Species', f.species.map(v => ({
    key: `species:${v}`, label: v, remove: removeFromArray('species', v),
  })))
  pushLevelGroup('subspecies', 'Subspecies', f.subspecies.map(sub => {
    const parent = resolveSubspeciesParent(sub, f.species)
    return {
      key: `subsp:${sub}`,
      label: parent ? `${parent} ${sub}` : sub,
      remove: removeFromArray('subspecies', sub),
    }
  }))

  for (const v of f.mimicry) other.push({ key: `mim:${v}`, label: v, type: 'Mimicry', remove: removeFromArray('mimicry', v) })
  for (const v of f.country) other.push({ key: `country:${v}`, label: v, type: 'Country', remove: removeFromArray('country', v) })
  for (const v of f.status) other.push({ key: `status:${v}`, label: v, type: 'Status', remove: removeFromArray('status', v) })
  if (f.sex !== 'all') other.push({ key: `sex:${f.sex}`, label: f.sex, type: 'Sex', remove: () => { store.filters.sex = 'all' } })
  if (f.camidSearch) other.push({ key: 'camid', label: 'CAMIDs', type: 'Search', remove: () => { store.filters.camidSearch = '' } })
  if (f.dateStart || f.dateEnd) other.push({ key: 'date', label: 'Date range', type: 'Time', remove: () => { store.filters.dateStart = null; store.filters.dateEnd = null } })

  return { taxonomy, other, total: taxonomy.length + other.length }
})

function handleKeydown(e) {
  const total = flatResults.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (total === 0) return
    activeIndex.value = (activeIndex.value + 1) % total
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (total === 0) return
    activeIndex.value = (activeIndex.value - 1 + total) % total
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = flatResults.value[activeIndex.value]
    if (hit) selectItem(hit.item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    dialogOpen.value = false
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector('[data-active="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

const keys = useMagicKeys({
  passive: false,
  onEventFired(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') event.preventDefault()
  },
})

watch(() => keys['Ctrl+K']?.value || keys['Meta+K']?.value, (pressed) => {
  if (!pressed) return
  dialogOpen.value = !dialogOpen.value
})

function handleGlobalKeydown(e) {
  if (!dialogOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    dialogOpen.value = false
  }
}

watch(dialogOpen, async (open) => {
  if (!open) {
    query.value = ''
    activeIndex.value = 0
    window.removeEventListener('keydown', handleGlobalKeydown, true)
    return
  }
  window.addEventListener('keydown', handleGlobalKeydown, true)
  await nextTick()
  inputRef.value?.focus()
})

onClickOutside(rootRef, () => {
  if (dialogOpen.value) dialogOpen.value = false
})

defineExpose({ open: () => { dialogOpen.value = true } })
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div v-if="dialogOpen" class="cmd-overlay" @keydown="handleKeydown">
        <div ref="rootRef" class="cmd-dialog">
          <div class="cmd-main">
            <div class="cmd-input-wrap">
              <svg class="cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                class="cmd-input"
                aria-label="Smart Search"
                placeholder="Search species, genera, subspecies, countries, mimicry rings..."
                autocomplete="off"
                spellcheck="false"
              >
              <button type="button" class="cmd-close" @click="dialogOpen = false" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div ref="listRef" class="cmd-list">
              <div v-if="!query.trim()" class="cmd-hint">
                Start typing to search taxonomy, geography, and mimicry filters.<span class="cmd-key-hint"> Use ↑↓ to navigate, Enter to apply.</span>
              </div>
              <template v-else-if="ranked.groups.length === 0 && ranked.suggestions.length === 0">
                <div class="cmd-hint cmd-hint--empty">No matches found.</div>
              </template>
              <template v-else>
                <template v-for="group in ranked.groups" :key="group.key">
                  <div class="cmd-group-heading">{{ group.heading }}</div>
                  <button
                    v-for="hit in group.items"
                    :key="hit.item.id"
                    :data-active="flatResults.indexOf(hit) === activeIndex"
                    class="cmd-item"
                    :class="{ 'cmd-item--active': flatResults.indexOf(hit) === activeIndex }"
                    @mouseenter="activeIndex = flatResults.indexOf(hit)"
                    @click="selectItem(hit.item)"
                  >
                    <span class="cmd-item-label">
                      <template v-if="hit.item.kind === 'subspecies'">
                        <em class="cmd-species">{{ hit.item.speciesName }}</em>
                        <span class="cmd-binomial" v-html="highlight(hit.item.value, hit)" />
                      </template>
                      <template v-else>
                        <span :class="{ 'cmd-binomial': hit.item.kind === 'species' }" v-html="highlight(hit.item.value, hit)" />
                      </template>
                    </span>
                    <span class="cmd-item-type">{{ hit.item.typeLabel }}</span>
                    <span class="cmd-item-count">{{ hit.item.count.toLocaleString() }}</span>
                  </button>
                </template>

                <template v-if="ranked.suggestions.length > 0">
                  <div class="cmd-group-heading cmd-group-heading--suggest">Did you mean?</div>
                  <button
                    v-for="hit in ranked.suggestions"
                    :key="`sug-${hit.item.id}`"
                    :data-active="flatResults.indexOf(hit) === activeIndex"
                    class="cmd-item cmd-item--suggest"
                    :class="{ 'cmd-item--active': flatResults.indexOf(hit) === activeIndex }"
                    @mouseenter="activeIndex = flatResults.indexOf(hit)"
                    @click="selectItem(hit.item)"
                  >
                    <span class="cmd-item-label">
                      <template v-if="hit.item.kind === 'subspecies'">
                        <em class="cmd-species">{{ hit.item.speciesName }}</em>
                        <em class="cmd-binomial">{{ hit.item.value }}</em>
                      </template>
                      <em v-else-if="hit.item.kind === 'species'" class="cmd-binomial">{{ hit.item.value }}</em>
                      <template v-else>{{ hit.item.value }}</template>
                    </span>
                    <span class="cmd-item-type">{{ hit.item.typeLabel }}</span>
                    <span class="cmd-item-count">{{ hit.item.count.toLocaleString() }}</span>
                  </button>
                </template>
              </template>

              <template v-if="showPlaces">
                <div class="cmd-group-heading">Places</div>
                <button
                  v-if="!placeResults.length"
                  type="button"
                  class="cmd-item cmd-item--place-search"
                  :disabled="places.isSearching.value"
                  @click="searchPlaces"
                >
                  <svg class="cmd-place-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span class="cmd-item-label">{{ places.isSearching.value ? 'Searching places…' : `Search places for “${query.trim()}”` }}</span>
                </button>
                <button
                  v-for="place in placeResults"
                  :key="place.name"
                  type="button"
                  class="cmd-item"
                  @click="selectPlace(place)"
                >
                  <svg class="cmd-place-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span class="cmd-item-label cmd-place-name">{{ place.name }}</span>
                </button>
              </template>
            </div>
          </div>

          <aside class="cmd-sidebar" v-if="activeFilters.total > 0">
            <div class="cmd-sidebar-title">Active filters ({{ activeFilters.total }})</div>

            <div v-if="zeroResultSuggestion" class="cmd-zero-banner">
              <div class="cmd-zero-title">No records match</div>
              <div class="cmd-zero-detail">
                Your <strong>{{ zeroResultSuggestion.humanLabel }}</strong> filter doesn't overlap with the filters above it.
              </div>
              <button class="cmd-zero-fix" @click="applySuggestion">
                Flip {{ zeroResultSuggestion.humanLabel }} to OR
              </button>
            </div>

            <div v-if="activeFilters.taxonomy.length > 0" class="cmd-tree">
              <div class="cmd-group-heading cmd-group-heading--any">Taxonomy <span class="cmd-combinator">· click AND/OR to toggle</span><span class="cmd-combinator cmd-combinator--touch">· tap AND/OR to toggle</span></div>
              <template v-for="(node, idx) in activeFilters.taxonomy" :key="idx">
                <button
                  v-if="node.type === 'combinator'"
                  class="cmd-combinator-btn"
                  :class="`cmd-combinator-btn--${node.value.toLowerCase()}`"
                  :title="`Toggle ${node.value} (click to change)`"
                  @click="toggleCombinator(node.level)"
                >
                  {{ node.value }}
                </button>
                <div v-else-if="node.type === 'group'" class="cmd-level-group">
                  <div class="cmd-level-label">{{ node.label }}</div>
                  <button
                    v-for="chip in node.chips"
                    :key="chip.key"
                    class="cmd-chip cmd-chip--tree"
                    :title="`Remove ${node.label}: ${chip.label}`"
                    @click="chip.remove()"
                  >
                    <span class="cmd-chip-label">{{ chip.label }}</span>
                    <svg class="cmd-chip-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </template>
            </div>

            <div v-if="activeFilters.other.length > 0" class="cmd-chips">
              <button
                v-for="chip in activeFilters.other"
                :key="chip.key"
                class="cmd-chip"
                :title="`Remove ${chip.type}: ${chip.label}`"
                @click="chip.remove()"
              >
                <span class="cmd-chip-type">{{ chip.type }}</span>
                <span class="cmd-chip-label">{{ chip.label }}</span>
                <svg class="cmd-chip-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <!-- Phones: the map or table sits under this sheet; one tap goes back to it with the filters applied. -->
            <button type="button" class="cmd-done" @click="dialogOpen = false">Done</button>
          </aside>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.cmd-dialog {
  display: flex;
  gap: 16px;
  width: min(920px, 94vw);
  max-height: 70vh;
  padding: 0;
}

.cmd-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.cmd-input-wrap {
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.cmd-search-icon {
  width: 18px;
  height: 18px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.cmd-input {
  flex: 1;
  min-height: 32px;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.cmd-input:focus-visible { outline: 0 !important; }
.cmd-input-wrap:has(.cmd-input:focus-visible) {
  outline: 2px solid var(--color-focus);
  outline-offset: -3px;
}
.cmd-input::placeholder { color: var(--color-text-muted); }

.cmd-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.cmd-close:hover {
  background: rgb(var(--color-text-primary-rgb) / 0.06);
  color: var(--color-text-primary);
}

.cmd-close svg { width: 16px; height: 16px; }

.cmd-list {
  overflow-y: auto;
  padding: 6px 0 10px;
  flex: 1;
}

.cmd-hint {
  padding: 20px 16px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.cmd-hint--empty { color: var(--color-text-secondary); }

.cmd-group-heading {
  padding: 10px 16px 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.cmd-group-heading--suggest {
  color: var(--color-accent-text);
}

.cmd-group-heading--any {
  padding: 0 0 6px;
}

.cmd-combinator {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.cmd-item--active,
.cmd-item:focus-visible {
  background: rgb(var(--color-accent-rgb) / 0.12);
  outline: 0;
}

.cmd-item :deep(strong) {
  font-weight: 700;
  color: var(--color-accent-text);
}

.cmd-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.cmd-species {
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.85rem;
}

.cmd-item-type {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.cmd-item-count {
  margin-left: auto;
  padding: 2px 8px;
  min-width: 32px;
  text-align: center;
  border-radius: 999px;
  background: rgb(var(--color-accent-rgb) / 0.1);
  color: var(--color-accent-text);
  font-size: 0.72rem;
  font-weight: 700;
  flex-shrink: 0;
}

.cmd-item--suggest { opacity: 0.85; }

.cmd-sidebar {
  width: 300px;
  flex-shrink: 0;
  max-height: 70vh;
  padding: 14px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}

.cmd-sidebar-title {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin-bottom: 10px;
}

.cmd-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgb(var(--color-text-primary-rgb) / 0.06);
}

.cmd-chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cmd-chip {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px 8px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: rgb(var(--color-text-primary-rgb) / 0.03);
  color: var(--color-text-primary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
}

.cmd-chip--tree {
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
}

.cmd-zero-banner {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-warning-text);
  border-radius: 8px;
  background: rgb(var(--color-warning-rgb) / 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cmd-zero-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-warning-text);
}

.cmd-zero-detail {
  font-size: 0.74rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.cmd-zero-detail strong {
  color: var(--color-text-primary);
}

.cmd-zero-fix {
  margin-top: 2px;
  padding: 6px 10px;
  border: 1px solid rgb(var(--color-accent-rgb) / 0.4);
  border-radius: 6px;
  background: rgb(var(--color-accent-rgb) / 0.15);
  color: var(--color-accent-text);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.cmd-zero-fix:hover {
  background: rgb(var(--color-accent-rgb) / 0.25);
}

.cmd-level-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cmd-level-label {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  padding: 0 4px;
}

.cmd-combinator-btn {
  align-self: center;
  margin: 2px 0;
  padding: 2px 10px;
  border: 1px solid rgb(var(--color-text-primary-rgb) / 0.12);
  border-radius: 999px;
  background: rgb(var(--color-text-primary-rgb) / 0.04);
  color: var(--color-text-secondary);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.15s;
}

.cmd-combinator-btn--or {
  border-color: rgb(var(--color-accent-rgb) / 0.4);
  background: rgb(var(--color-accent-rgb) / 0.12);
  color: var(--color-accent-text);
}

.cmd-combinator-btn:hover {
  transform: scale(1.08);
}

.cmd-chip:hover {
  border-color: var(--color-danger-text);
  background: rgb(var(--color-danger-rgb) / 0.08);
}

.cmd-chip-type {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  font-weight: 600;
}

.cmd-chip-label {
  min-width: 0;
  word-break: break-word;
  line-height: 1.3;
}

.cmd-chip-x {
  width: 12px;
  height: 12px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.cmd-chip:hover .cmd-chip-x { color: var(--color-danger-text); }

.cmd-fade-enter-active,
.cmd-fade-leave-active { transition: opacity 0.18s; }

.cmd-fade-enter-from,
.cmd-fade-leave-to { opacity: 0; }

/* Touch screens: no arrow-key hint, and the close button gets a 44 px tap area. */
.cmd-combinator--touch { display: none; }
.cmd-binomial { font-style: italic; }
.cmd-place-icon { width: 16px; height: 16px; flex-shrink: 0; color: var(--color-accent-text); }
.cmd-place-name { white-space: normal; line-height: 1.3; }
.cmd-item--place-search { color: var(--color-accent-text); }
.cmd-item--place-search:disabled { cursor: progress; opacity: 0.8; }

@media (pointer: coarse) {
  .cmd-key-hint { display: none; }
  .cmd-combinator { display: none; }
  .cmd-combinator--touch { display: inline; }
  .cmd-close { position: relative; }
  .cmd-close::before { content: ''; position: absolute; inset: -8px; }
}

.cmd-done { display: none; }

@media (max-width: 768px) {
  .cmd-done {
    display: block;
    width: 100%;
    min-height: 44px;
    margin-top: 12px;
    border: 1px solid var(--color-accent);
    border-radius: 8px;
    background: var(--color-accent);
    color: var(--color-on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .cmd-done:active { transform: translateY(1px); }
  /* Stays in reach when the filter list scrolls. */
  .cmd-done { position: sticky; bottom: 0; }

  .cmd-dialog { flex-direction: column; max-height: 85vh; }
  .cmd-sidebar { width: auto; max-height: 200px; }
}
</style>
