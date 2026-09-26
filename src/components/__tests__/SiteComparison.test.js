// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive } from 'vue'
import SiteComparison from '../SiteComparison.vue'
import { downloadCsv } from '../../utils/tableExport'

let planning
vi.mock('../../stores/planning', () => ({
  usePlanningStore: () => planning,
  sitesToCsv: sites => JSON.stringify(sites.map(site => site.name)),
}))
vi.mock('../../utils/tableExport', () => ({ downloadCsv: vi.fn() }))
const mounted = []
const site = (name, count) => ({
  id: name, name, country: 'Ecuador', recordCount: count, recordedPoints: [[-77.6, -1]],
  targetCounts: [{ label: 'Mechanitis polymnia', count }],
})
beforeEach(() => {
  vi.clearAllMocks()
  planning = reactive({
    localitySettings: { enabled: true, minRecords: 10 },
    showComparison: true, comparisonMinimized: false, targetTaxa: ['Mechanitis polymnia'],
    sites: [site('Suchipakari', 59), site('Cavernas', 61)], shortlistSet: new Set(),
    get shortlistedSites() { return this.sites.filter(site => this.shortlistSet.has(site.id)) },
    toggleShortlist(site) { this.shortlistSet.has(site.id) ? this.shortlistSet.delete(site.id) : this.shortlistSet.add(site.id) },
    focusSite: vi.fn(),
  })
})
afterEach(() => { for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() } })
function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SiteComparison)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

describe('SiteComparison', () => {
  it('shows a compact single-target list while preserving focus and shortlist actions', async () => {
    const host = mount()
    expect(host.querySelectorAll('.target-breakdown')).toHaveLength(0)
    expect(host.querySelector('.single-target').textContent).toBe('Mechanitis polymnia')
    expect(host.querySelector('.site-name').textContent).toBe('Cavernas')
    expect(host.querySelector('.shortlist-filter')).toBeNull()
    expect(host.textContent).not.toMatch(/dated record|target taxa|0 shortlisted|Counts are/)
    host.querySelector('.site-focus').click()
    expect(planning.focusSite).toHaveBeenCalledWith(planning.sites[1])
    host.querySelector('.shortlist-button').click()
    await nextTick()
    expect(host.querySelector('.shortlist-filter').textContent).toContain('1')
    host.querySelector('.shortlist-filter').click()
    await nextTick()
    expect(host.querySelectorAll('.site-row')).toHaveLength(1)
    host.querySelector('.shortlist-button').click()
    await nextTick()
    expect(host.querySelectorAll('.site-row')).toHaveLength(2)
    expect(host.querySelector('.shortlist-filter')).toBeNull()
  })

  it('retains zero counts for multiple targets and hides coverage sorting when no longer relevant', async () => {
    planning.targetTaxa.push('Ithomia salapia derasa')
    planning.sites.forEach(site => site.targetCounts.push({ label: 'Ithomia salapia derasa', count: 0 }))
    const host = mount()
    expect(host.querySelectorAll('.target-breakdown')).toHaveLength(2)
    expect(host.querySelector('.target-breakdown').textContent).toContain('Ithomia salapia derasa0')
    const select = host.querySelector('.sort-label select')
    select.value = 'coverage'; select.dispatchEvent(new Event('change'))
    await nextTick()
    planning.targetTaxa.pop()
    await nextTick()
    expect(select.value).toBe('records')
    expect(host.querySelectorAll('.target-breakdown')).toHaveLength(0)
  })

  it('keeps search and settings when the edge tab reopens the collapsed panel', async () => {
    const host = mount()
    const input = host.querySelector('input[type=search]')
    input.value = 'Suchipakari'; input.dispatchEvent(new Event('input'))
    host.querySelector('[aria-label="Increase minimum records"]').click()
    await nextTick()
    expect(planning.localitySettings.minRecords).toBe(11)
    host.querySelector('[aria-label="Collapse field sites"]').click()
    await nextTick()
    expect(planning.comparisonMinimized).toBe(true)
    expect(host.querySelector('.site-comparison').hasAttribute('inert')).toBe(true)
    host.querySelector('[aria-label="Open field sites"]').click()
    await nextTick()
    expect(planning.comparisonMinimized).toBe(false)
    expect(input.value).toBe('Suchipakari')
    expect(host.querySelector('#site-min-records').value).toBe('11')
    host.querySelector('[role="switch"]').click()
    await nextTick()
    expect(host.querySelector('#site-min-records').disabled).toBe(true)
  })

  it('exports the search results rather than silently exporting all sites', async () => {
    const host = mount()
    const input = host.querySelector('input[type=search]')
    input.value = 'Suchipakari'; input.dispatchEvent(new Event('input'))
    await nextTick()
    host.querySelector('.comparison-footer button').click()
    expect(downloadCsv).toHaveBeenCalledWith('field-sites.csv', JSON.stringify(['Suchipakari']))
  })
})
