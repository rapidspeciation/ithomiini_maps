// Pins the date-range filter: a record dated on the first or last chosen day is kept, in any time zone.
// Goes in src/stores/__tests__/ once the app fix (fix.patch next to this file) is applied; it fails today.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDatasetStore } from '../datasetStore'
import { useFilterStore } from '../filterStore'

const originalTz = process.env.TZ

// One specimen per date format the shipped data uses (map_points_*.json, 8 Nov 2026).
const records = [
  { id: 'SANGER-17', observation_date: '17-Jan-22' }, // Sanger sheet: DD-Mon-YY
  { id: 'SANGER-18', observation_date: '18-Jan-22' },
  { id: 'SANGER-19', observation_date: '19-Jan-22' },
  { id: 'GBIF-18', observation_date: '2022-01-18' }, // GBIF: YYYY-MM-DD
  { id: 'INAT-18-MORNING', observation_date: '2022-01-18T10:15' }, // iNaturalist: local date and time
  { id: 'INAT-18-NIGHT', observation_date: '2022-01-18T23:40:05' },
  { id: 'INAT-19', observation_date: '2022-01-19T00:05' },
].map(r => ({ scientific_name: 'Mechanitis polymnia', source: 'Sanger Institute', lat: -1, lng: -78, ...r }))

describe.each(['America/Guayaquil', 'Europe/Paris', 'UTC'])('date range filter in %s', tz => {
  beforeEach(() => {
    process.env.TZ = tz
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    setActivePinia(createPinia())
    useDatasetStore().allFeatures = records
  })
  afterAll(() => { process.env.TZ = originalTz; vi.unstubAllGlobals() })

  const ids = () => useFilterStore().filteredGeoJSON.features.map(f => f.properties.id)

  it('a one-day range keeps every record of that day and nothing else', () => {
    const store = useFilterStore()
    store.filters.dateStart = '2022-01-18'
    store.filters.dateEnd = '2022-01-18'
    expect(ids()).toEqual(['SANGER-18', 'GBIF-18', 'INAT-18-MORNING', 'INAT-18-NIGHT'])
  })

  it('keeps records on both the start and the end day', () => {
    const store = useFilterStore()
    store.filters.dateStart = '2022-01-18'
    store.filters.dateEnd = '2022-01-19'
    expect(ids()).toEqual(['SANGER-18', 'SANGER-19', 'GBIF-18', 'INAT-18-MORNING', 'INAT-18-NIGHT', 'INAT-19'])
  })
})
