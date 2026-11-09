// GBIF records dated as a range (ISO 8601 interval, e.g. 1997-11-07/1997-11-10): the date filter keeps one when any
// day of its range falls inside the filter; the time slider histogram counts it at the range start.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDatasetStore } from '../datasetStore'
import { useFilterStore } from '../filterStore'

const originalTz = process.env.TZ

// Real records from public/data/map_points_gbif_other.json (9 Nov 2026), one per range shape in the data,
// plus single-date controls.
const records = [
  { id: '4953915499', scientific_name: 'Mechanitis lysimnia', observation_date: '1997-11-07/1997-11-10' }, // day/day (4,076 in this file, 4,078 in all)
  { id: '3026035445', scientific_name: 'Godyris zavaleta', observation_date: '2006-10/2006-11' }, // month/month (248)
  { id: '3897921207', scientific_name: 'Mechanitis polymnia', observation_date: '2009/2010' }, // year/year (10)
  { id: '3427538557', scientific_name: 'Mechanitis menapis', observation_date: '2009-12-30T09:15/2009-12-30T10:00' }, // time/time (11)
  { id: 'DAY-1997-11-08', scientific_name: 'Mechanitis lysimnia', observation_date: '1997-11-08' },
  { id: 'SANGER-1997-11-12', scientific_name: 'Mechanitis lysimnia', observation_date: '12-Nov-97' },
].map(r => ({ source: 'GBIF (Other Institutions)', lat: 12, lng: -85, country: 'Nicaragua', ...r }))

const offsets = { 'America/Guayaquil': 300, 'Europe/Paris': -60 }

describe.each(Object.keys(offsets))('GBIF range dates in %s', tz => {
  beforeEach(() => {
    process.env.TZ = tz
    expect(new Date(2022, 0, 18).getTimezoneOffset()).toBe(offsets[tz])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    setActivePinia(createPinia())
    useDatasetStore().allFeatures = records
    useFilterStore().filters.source = [] // the default shows only Sanger records
  })
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
    vi.unstubAllGlobals()
  })

  const ids = (start, end) => {
    const store = useFilterStore()
    store.filters.dateStart = start
    store.filters.dateEnd = end
    return store.filteredGeoJSON.features.map(f => f.properties.id)
  }

  it('keeps a day range that straddles the filter start', () => {
    expect(ids('1997-11-09', '1997-11-30')).toEqual(['4953915499', 'SANGER-1997-11-12'])
  })

  it('keeps a day range that straddles the filter end', () => {
    expect(ids('1997-11-01', '1997-11-08')).toEqual(['4953915499', 'DAY-1997-11-08'])
  })

  it('keeps a day range on its last day only, and on its first day only', () => {
    expect(ids('1997-11-10', '1997-11-10')).toEqual(['4953915499'])
    expect(ids('1997-11-07', '1997-11-07')).toEqual(['4953915499'])
  })

  it('keeps a day range fully inside the filter, and a filter fully inside the range', () => {
    expect(ids('1997-11-01', '1997-11-30')).toEqual(['4953915499', 'DAY-1997-11-08', 'SANGER-1997-11-12'])
    expect(ids('1997-11-08', '1997-11-09')).toEqual(['4953915499', 'DAY-1997-11-08'])
  })

  it('drops a day range fully outside the filter, on either side', () => {
    expect(ids('1997-11-11', '1997-12-31')).toEqual(['SANGER-1997-11-12'])
    expect(ids('1997-10-01', '1997-11-06')).toEqual([])
  })

  it('reads a month range through the end of its last month, and a year range through the end of its last year', () => {
    expect(ids('2006-11-30', '2006-12-31')).toEqual(['3026035445'])
    expect(ids('2006-12-01', '2006-12-31')).toEqual([])
    expect(ids('2010-12-31', '2011-06-30')).toEqual(['3897921207'])
    expect(ids('2011-01-01', '2011-06-30')).toEqual([])
  })

  it('keeps a time range on its day and not the next', () => {
    expect(ids('2009-12-30', '2009-12-30')).toEqual(['3897921207', '3427538557'])
    expect(ids('2009-12-31', '2009-12-31')).toEqual(['3897921207'])
  })

  it('keeps the 1997 day range under a typical 1990-2000 filter', () => {
    expect(ids('1990-01-01', '2000-12-31')).toEqual(['4953915499', 'DAY-1997-11-08', 'SANGER-1997-11-12'])
  })

  it('counts a range record in the time slider histogram at its start year', () => {
    const dist = useFilterStore().temporalDistribution
    const count = year => dist.find(d => d.year === year)?.count ?? 0
    expect(count(1997)).toBe(3)
    expect(count(2006)).toBe(1)
    expect(count(2009)).toBe(2) // 2009/2010 and the time range
    expect(count(2010)).toBe(0)
  })
})
