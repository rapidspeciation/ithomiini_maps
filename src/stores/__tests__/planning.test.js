import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useDatasetStore } from '../datasetStore'
import { useFilterStore } from '../filterStore'
import { useViewStore } from '../viewStore'
import { sitesToCsv, usePlanningStore } from '../planning'

const record = (id, scientific_name, extra = {}) => ({
  id, lat: -0.05, lng: -78.77, collection_location: 'Mindo', country: 'Ecuador',
  scientific_name, genus: scientific_name.split(' ')[0], family: 'Nymphalidae',
  tribe: 'Ithomiini', source: 'Sanger Institute', observation_date: '2023-06-14', ...extra,
})

describe('usePlanningStore', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    setActivePinia(createPinia())
  })

  it('uses current filtered records and selected species for site coverage', () => {
    const dataset = useDatasetStore()
    const filters = useFilterStore()
    const planning = usePlanningStore()
    dataset.allFeatures = [
      record('a', 'Ithomia leilae'),
      record('b', 'Mechanitis menophilus'),
      record('c', 'Ithomia leilae', { lat: -1.5 }),
    ]
    planning.localitySettings.minRecords = 1
    filters.filters.species = ['Ithomia leilae', 'Mechanitis menophilus']
    expect(planning.sites).toHaveLength(2)
    expect(planning.sites.find(site => site.recordCount === 2)).toMatchObject({ taxonCount: 2, coverageCount: 2, coverageTotal: 2 })

    filters.filters.species = ['Ithomia leilae']
    expect(planning.sites.find(site => site.name === 'Mindo' && site.recordCount === 1).coverageCount).toBe(1)
    expect(planning.sites.every(site => site.recordCount === 1)).toBe(true)
  })

  it('counts each selected subspecies separately and excludes unknown identities', () => {
    const dataset = useDatasetStore()
    const filters = useFilterStore()
    const planning = usePlanningStore()
    dataset.allFeatures = [
      record('a', 'Mechanitis polymnia'),
      record('b', 'Mechanitis lysimnia'),
      record('c', 'Ithomia salapia', { subspecies: 'travella' }),
      record('d', 'Ithomia salapia', { subspecies: 'derasa' }),
      record('e', 'Ithomia salapia', { subspecies: 'Ithomia salapia' }),
    ]
    filters.filters.species = ['Mechanitis polymnia', 'Mechanitis lysimnia', 'Ithomia salapia']
    filters.filters.subspecies = ['travella', 'derasa']
    const site = planning.sites[0]
    expect(site.recordCount).toBe(4)
    expect(site.coverageCount).toBe(4)
    expect(site.coverageTotal).toBe(4)
    expect(site.targetCounts).toEqual([
      { label: 'Mechanitis polymnia', count: 1 },
      { label: 'Mechanitis lysimnia', count: 1 },
      { label: 'Ithomia salapia derasa', count: 1 },
      { label: 'Ithomia salapia travella', count: 1 },
    ])
  })

  it('persists the shortlist and allows repeated focus requests', async () => {
    const planning = usePlanningStore()
    planning.toggleShortlist('site:ec:mindo:abcde')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('field-planning-shortlist'))).toEqual(['site:ec:mindo:abcde'])
    planning.focusSite({ id: 'site:ec:mindo:abcde' })
    planning.focusSite({ id: 'site:ec:mindo:abcde' })
    expect(planning.selectedSiteId).toBe('site:ec:mindo:abcde')
    expect(planning.focusRequestId).toBe(2)
  })

  it('escapes formula-like locality and taxon values in CSV', () => {
    const csv = sitesToCsv([{
      id: 'site:test', name: '=HYPERLINK("bad")', named: true, country: '@bad',
      latitude: -1, longitude: -78, recordCount: 1, taxonCount: 1,
      datedRecordCount: 0, taxonCounts: [{ taxon: '+CMD', count: 1 }],
    }])
    expect(csv).toContain("'@bad")
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+CMD: 1")
    expect(csv).toContain(',-1,-78,1,1,')
  })

  it('round-trips planning link settings and ignores invalid values', () => {
    const planning = usePlanningStore()
    planning.localitySettings.enabled = false
    planning.localitySettings.minRecords = 12
    planning.showComparison = true
    planning.toggleShortlist('site:ec:mindo:abcde')
    const params = new URLSearchParams()
    planning.appendURLParams(params)
    expect(params.get('site_min')).toBe('12')
    planning.localitySettings.enabled = true
    planning.localitySettings.minRecords = 10
    planning.showComparison = false
    planning.restoreFromURL(params)
    expect(planning.localitySettings).toEqual({ enabled: false, minRecords: 12 })
    expect(planning.showComparison).toBe(true)
    planning.restoreFromURL(new URLSearchParams('site_min=-5&site_shortlist=%5B%22bad%22%5D'))
    expect(planning.localitySettings.minRecords).toBe(12)
    expect(planning.shortlistIds).toEqual(['site:ec:mindo:abcde'])
  })

  it('restores planning links and keeps them when filters rewrite the URL', async () => {
    const view = useViewStore()
    const planning = usePlanningStore()
    const filters = useFilterStore()
    const params = new URLSearchParams({
      view: 'table', sites: '0', site_min: '12', site_compare: '1',
      site_shortlist: JSON.stringify(['site:ec:mindo:abcde']),
    })
    window.history.replaceState({}, '', `/?${params}`)
    view.restoreVisualizationFromURL()
    expect(planning.localitySettings).toEqual({ enabled: false, minRecords: 12 })
    expect(planning.shortlistIds).toEqual(['site:ec:mindo:abcde'])
    filters.filters.country = ['Ecuador']
    await nextTick()
    const updated = new URLSearchParams(window.location.search)
    expect(updated.get('view')).toBe('table')
    expect(updated.get('country')).toBe('Ecuador')
    expect(updated.get('sites')).toBe('0')
    expect(updated.get('site_min')).toBe('12')
    expect(updated.get('site_compare')).toBe('1')
    expect(JSON.parse(updated.get('site_shortlist'))).toEqual(['site:ec:mindo:abcde'])

    planning.localitySettings.minRecords = 8
    await nextTick()
    expect(new URLSearchParams(window.location.search).get('site_min')).toBe('8')
  })
})
