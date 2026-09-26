<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Download, ChevronLeft, ChevronRight, MapPin, Star } from 'lucide-vue-next'
import { usePlanningStore, sitesToCsv } from '../stores/planning'
import { downloadCsv } from '../utils/tableExport'
import LocalityMapLink from './LocalityMapLink.vue'
import LocalitySettings from './LocalitySettings.vue'

const planning = usePlanningStore()
const expanded = computed(() => planning.showComparison && !planning.comparisonMinimized)
const tab = ref(null)
const collapseButton = ref(null)
async function openPanel() {
  planning.showComparison = true
  planning.comparisonMinimized = false
  await nextTick()
  collapseButton.value?.focus()
}
async function collapsePanel() {
  planning.comparisonMinimized = true
  await nextTick()
  tab.value?.focus()
}
const query = ref('')
const sortBy = ref('records')
const shortlistOnly = ref(false)
const visibleCount = ref(50)

const matchingSites = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  const candidateSites = shortlistOnly.value ? planning.shortlistedSites : planning.sites
  const list = term
    ? candidateSites.filter(site => `${site.name} ${site.country}`.toLocaleLowerCase().includes(term))
    : candidateSites
  return [...list].sort((a, b) => {
    if (sortBy.value === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    if (sortBy.value === 'coverage') return b.coveragePercent - a.coveragePercent || b.coverageCount - a.coverageCount || b.recordCount - a.recordCount
    return b.recordCount - a.recordCount || a.id.localeCompare(b.id)
  })
})
const multipleTargets = computed(() => planning.targetTaxa.length > 1)
const showCountries = computed(() => new Set(matchingSites.value.map(site => site.country).filter(Boolean)).size > 1)
const exportScope = ref('listed')
const exportSites = computed(() => exportScope.value === 'shortlist' ? matchingSites.value.filter(site => planning.shortlistSet.has(site.id)) : matchingSites.value)
watch(multipleTargets, value => { if (!value && sortBy.value === 'coverage') sortBy.value = 'records' })
watch(() => planning.shortlistedSites.length, count => {
  if (!count) { shortlistOnly.value = false; exportScope.value = 'listed' }
})
const visibleSites = computed(() => matchingSites.value.slice(0, visibleCount.value))
watch([query, sortBy, shortlistOnly], () => { visibleCount.value = 50 })

function focus(site) {
  planning.focusSite(site)
}
</script>

<template>
  <button v-show="!expanded" ref="tab" type="button" class="field-sites-tab" title="Field sites" aria-label="Open field sites" aria-controls="field-sites-panel" :aria-expanded="expanded" @click="openPanel">
    <ChevronLeft :size="14" aria-hidden="true" /><MapPin :size="19" aria-hidden="true" />
  </button>
  <Transition name="field-sites-slide">
  <aside v-show="expanded" id="field-sites-panel" class="site-comparison" aria-label="Field sites" :inert="!expanded" @keydown.esc="collapsePanel">
    <header class="comparison-header">
      <div>
        <h2>Field sites</h2>
        <p>{{ matchingSites.length.toLocaleString() }} {{ matchingSites.length === 1 ? 'site' : 'sites' }}</p>
      </div>
      <div class="comparison-actions">
        <button ref="collapseButton" type="button" class="icon-button" aria-label="Collapse field sites" title="Collapse field sites" @click="collapsePanel"><ChevronRight :size="20" /></button>
      </div>
    </header>

    <LocalitySettings />

    <div class="comparison-controls">
      <label class="search-label">
        <span>Find a site</span>
        <input v-model="query" type="search" placeholder="Locality or country" />
      </label>
      <label class="sort-label">
        <span>Sort</span>
        <select v-model="sortBy">
          <option value="records">Most records</option>
          <option v-if="multipleTargets" value="coverage">Most selected taxa</option>
          <option value="name">Name</option>
        </select>
      </label>
    </div>

    <button v-if="planning.shortlistedSites.length" type="button" class="shortlist-filter" :class="{ active: shortlistOnly }" :aria-pressed="shortlistOnly" @click="shortlistOnly = !shortlistOnly">
      <Star :size="14" :fill="shortlistOnly ? 'currentColor' : 'none'" aria-hidden="true" />
      Shortlist only
      <span>{{ planning.shortlistedSites.length.toLocaleString() }}</span>
    </button>

    <div class="list-heading">
      <span v-if="planning.targetTaxa.length === 1" class="single-target">{{ planning.targetTaxa[0] }}</span>
      <span v-else>Locality</span>
      <span>Records</span>
    </div>

    <div class="site-list" role="list">
      <article v-for="site in visibleSites" :key="site.id" class="site-row" :class="{ selected: planning.selectedSiteId === site.id }" role="listitem">
        <button type="button" class="site-focus" :aria-label="`Show ${site.name} on map`" @click="focus(site)">
          <span class="site-heading"><span class="site-name">{{ site.name }}</span><strong class="record-count">{{ site.recordCount.toLocaleString() }}</strong></span>
          <span v-if="showCountries && site.country" class="site-country">{{ site.country }}</span>
          <span v-if="multipleTargets" class="target-breakdown">
            <span v-for="target in site.targetCounts" :key="target.label"><span>{{ target.label }}</span><strong>{{ target.count.toLocaleString() }}</strong></span>
          </span>
        </button>
        <div class="site-actions">
        <LocalityMapLink :site="site" />
        <button
          type="button"
          class="shortlist-button"
          :class="{ active: planning.shortlistSet.has(site.id) }"
          :aria-label="`${planning.shortlistSet.has(site.id) ? 'Remove' : 'Add'} ${site.name} ${planning.shortlistSet.has(site.id) ? 'from' : 'to'} shortlist`"
          :aria-pressed="planning.shortlistSet.has(site.id)"
          @click="planning.toggleShortlist(site)"
        ><Star :size="18" :fill="planning.shortlistSet.has(site.id) ? 'currentColor' : 'none'" /></button>
        </div>
      </article>
      <p v-if="!matchingSites.length" class="empty-sites">{{ query ? 'No sites match this search.' : shortlistOnly ? 'No shortlisted sites in the current selection. Turn off Shortlist only to add one, or change the filters.' : 'No sites in the current selection. Change the filters to see sites.' }}</p>
      <button v-if="visibleCount < matchingSites.length" type="button" class="show-more" @click="visibleCount += 50">Show 50 more sites</button>
    </div>

    <footer class="comparison-footer">
      <select v-if="planning.shortlistedSites.length && !shortlistOnly" v-model="exportScope" aria-label="Sites to export">
        <option value="listed">Listed sites</option>
        <option value="shortlist">Shortlisted sites</option>
      </select>
      <button type="button" :disabled="!exportSites.length" @click="downloadCsv('field-sites.csv', sitesToCsv(exportSites))"><Download :size="15" aria-hidden="true" /> {{ shortlistOnly || exportScope === 'shortlist' ? 'Export shortlist' : 'Export sites' }}</button>
    </footer>
  </aside>
  </Transition>
</template>

<style scoped>
.site-comparison { position: absolute; top: 0; right: 0; z-index: 25; display: flex; flex-direction: column; box-sizing: border-box; width: 380px; height: 100%; color: var(--color-text-primary, #e0e0e0); background: var(--color-bg-primary, #1a1a2e); border-left: 1px solid var(--color-border, #3d3d5c); box-shadow: -4px 0 20px rgba(0,0,0,.3); overflow: hidden; font-size: .82rem; }
.field-sites-tab { position: absolute; right: 0; top: 210px; z-index: 24; display: flex; align-items: center; justify-content: center; gap: 2px; width: 48px; height: 48px; padding: 0 6px 0 2px; border: 1px solid var(--color-border); border-right: 0; border-radius: 10px 0 0 10px; color: var(--color-text-primary); background: var(--color-bg-primary); box-shadow: -3px 3px 10px rgba(0,0,0,.15); }
.field-sites-tab:hover { color: var(--color-accent); background: var(--color-bg-secondary); }
.field-sites-slide-enter-active, .field-sites-slide-leave-active { transition: transform 200ms cubic-bezier(.22, 1, .36, 1); }
.field-sites-slide-enter-from, .field-sites-slide-leave-to { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) { .field-sites-slide-enter-active, .field-sites-slide-leave-active { transition: none; } }
.comparison-actions { display: flex; gap: 2px; flex: none; }
.comparison-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 15px 16px 11px; }
.comparison-header h2 { margin: 0 0 3px; font-size: 1rem; font-weight: 700; letter-spacing: -.015em; }
.comparison-header p { margin: 0; color: var(--color-text-secondary, #aaa); font-size: .74rem; font-variant-numeric: tabular-nums; }
button { font: inherit; cursor: pointer; }
.icon-button { display: grid; place-items: center; min-width: 30px; min-height: 30px; padding: 0; color: var(--color-text-secondary, #aaa); border: 0; border-radius: 6px; background: transparent; }
.icon-button:hover { color: var(--color-text-primary, #e0e0e0); background: var(--color-bg-tertiary, #2d2d4a); }
.comparison-controls { display: grid; grid-template-columns: minmax(0, 1fr) 145px; gap: 9px; padding: 0 16px 10px; }
.comparison-controls label { display: grid; gap: 4px; min-width: 0; color: var(--color-text-secondary, #aaa); font-size: .72rem; }
.comparison-controls input, .comparison-controls select { width: 100%; min-width: 0; padding: 7px 8px; color: var(--color-text-primary, #e0e0e0); background: var(--color-bg-primary, #1a1a2e); border: 1px solid var(--color-border, #3d3d5c); border-radius: 6px; font: inherit; font-size: .77rem; }
.comparison-controls input::placeholder { color: var(--color-text-secondary, #aaa); }
.shortlist-filter { display: flex; align-items: center; gap: 7px; align-self: flex-start; margin: 0 16px 10px; padding: 6px 9px; color: var(--color-text-secondary, #aaa); border: 1px solid var(--color-border, #3d3d5c); border-radius: 6px; background: var(--color-bg-primary, #1a1a2e); font-size: .74rem; }
.shortlist-filter:hover, .shortlist-filter.active { color: var(--color-accent, #4ade80); border-color: var(--color-accent, #4ade80); }
.shortlist-filter span { font-variant-numeric: tabular-nums; }
.site-list { flex: 1; min-height: 0; overflow-y: auto; border-top: 1px solid var(--color-border, #3d3d5c); scrollbar-color: var(--color-border, #3d3d5c) transparent; }
.site-row { display: flex; align-items: flex-start; border-bottom: 1px solid var(--color-border, #3d3d5c); }
.site-row.selected { background: var(--color-bg-tertiary, #2d2d4a); }
.site-focus { flex: 1; min-width: 0; display: grid; gap: 4px; padding: 12px 0 12px 16px; text-align: left; color: inherit; border: 0; background: transparent; }
.site-focus:hover .site-name { color: var(--color-accent, #4ade80); }
.site-name { display: flex; align-items: center; gap: 6px; font-weight: 650; overflow-wrap: anywhere; }
.site-country { color: var(--color-text-secondary, #aaa); font-size: .72rem; }
.target-breakdown { display: grid; gap: 3px; margin: 3px 0; font-size: .72rem; }
.target-breakdown > span { display: flex; justify-content: space-between; gap: 12px; color: var(--color-text-secondary, #aaa); }
.target-breakdown > span > span { overflow-wrap: anywhere; }
.target-breakdown strong { color: var(--color-text-primary, #e0e0e0); font-variant-numeric: tabular-nums; }
.shortlist-button { display: grid; place-items: center; flex: none; width: 32px; height: 32px; margin: 0; color: var(--color-text-secondary, #aaa); border: 0; border-radius: 6px; background: transparent; }
.shortlist-button:hover, .shortlist-button.active { color: var(--color-accent, #4ade80); }
.empty-sites { margin: 0; padding: 24px 16px; color: var(--color-text-secondary, #aaa); line-height: 1.5; }
.show-more { width: 100%; padding: 12px; color: var(--color-accent, #4ade80); border: 0; background: transparent; font-weight: 650; }
.show-more:hover { background: var(--color-bg-tertiary, #2d2d4a); }
.comparison-footer { display: flex; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--color-border, #3d3d5c); }
.comparison-footer button { display: flex; justify-content: center; align-items: center; gap: 5px; flex: 1; min-width: 0; padding: 8px 6px; color: var(--color-text-primary, #e0e0e0); border: 1px solid var(--color-border, #3d3d5c); border-radius: 6px; background: var(--color-bg-tertiary, #2d2d4a); font-size: .75rem; }
.comparison-footer button:hover:not(:disabled) { border-color: var(--color-accent, #4ade80); }
.comparison-footer button:disabled { opacity: .45; cursor: default; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-accent, #4ade80); outline-offset: 2px; }
.list-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 2px 80px 9px 16px; color: var(--color-text-secondary); font-size: .72rem; }
.single-target { font-style: italic; }
.site-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.record-count { font-variant-numeric: tabular-nums; }
.site-actions { display: flex; align-items: flex-start; flex: none; gap: 0; padding: 6px 8px; }
.comparison-footer select { min-width: 0; color: var(--color-text-primary); background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: 6px; padding: 6px; font: inherit; }
@media (max-width: 600px) {
  .site-comparison { top: 54px; right: 0; width: 100%; height: calc(100% - 108px); border-top: 1px solid var(--color-border, #3d3d5c); }
}
</style>
