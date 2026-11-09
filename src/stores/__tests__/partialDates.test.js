// GBIF records dated only to a month (1954-02) or a year (1965): the date filter keeps one when any day of that
// month or year falls inside the filter, not only its first day. Full dates still match on their own day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDatasetStore } from '../datasetStore'
import { useFilterStore } from '../filterStore'
import { dateOverlaps } from '../../utils/dateHelpers'

const originalTz = process.env.TZ

// Real records from public/data/map_points_gbif_other.json (9 Nov 2026), plus made-up controls.
const records = [
  { id: '1039032070', scientific_name: 'Placidina euryanassa', observation_date: '1954-02' }, // month (985 in this file)
  { id: '1039036763', scientific_name: 'Mechanitis lysimnia', observation_date: '1965' }, // year (1,260)
  { id: 'MONTH-2024-02', scientific_name: 'Mechanitis lysimnia', observation_date: '2024-02' }, // leap February
  { id: 'MONTH-2023-02', scientific_name: 'Mechanitis lysimnia', observation_date: '2023-02' },
  { id: 'DAY-1954-02-15', scientific_name: 'Mechanitis lysimnia', observation_date: '1954-02-15' },
  { id: 'SANGER-1954-02-27', scientific_name: 'Mechanitis lysimnia', observation_date: '27-Feb-54' },
].map(r => ({ source: 'GBIF (Other Institutions)', lat: -27, lng: -49, country: 'Brazil', ...r }))

const offsets = { 'America/Guayaquil': 300, 'Europe/Paris': -60 }

describe.each(Object.keys(offsets))('partial dates in %s', tz => {
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

  it('keeps a month record under a mid-month filter and on the last day of its month', () => {
    expect(ids('1954-02-10', '1954-02-20')).toEqual(['1039032070', 'DAY-1954-02-15'])
    expect(ids('1954-02-28', '1954-02-28')).toEqual(['1039032070'])
    expect(ids('1954-02-01', '1954-02-01')).toEqual(['1039032070'])
  })

  it('drops a month record outside its month, on either side', () => {
    expect(ids('1954-03-01', '1954-12-31')).toEqual([])
    expect(ids('1954-01-01', '1954-01-31')).toEqual([])
  })

  it('keeps a month record under a range that only overlaps the end of its month', () => {
    expect(ids('1954-02-27', '1954-03-15')).toEqual(['1039032070', 'SANGER-1954-02-27'])
  })

  it('reads February to its 29th in a leap year and to its 28th otherwise', () => {
    expect(ids('2024-02-29', '2024-02-29')).toEqual(['MONTH-2024-02'])
    expect(ids('2024-02-29', '2024-03-31')).toEqual(['MONTH-2024-02'])
    expect(ids('2023-02-28', '2023-02-28')).toEqual(['MONTH-2023-02'])
    expect(ids('2023-03-01', '2023-03-31')).toEqual([])
  })

  it('keeps a year record under any day of its year and drops it outside', () => {
    expect(ids('1965-06-15', '1965-06-15')).toEqual(['1039036763'])
    expect(ids('1965-12-31', '1966-03-01')).toEqual(['1039036763'])
    expect(ids('1964-01-01', '1964-12-31')).toEqual([])
    expect(ids('1966-01-01', '1966-12-31')).toEqual([])
  })

  it('leaves full dates on their own day', () => {
    expect(ids('1954-02-15', '1954-02-15')).toEqual(['1039032070', 'DAY-1954-02-15'])
    expect(ids('1954-02-16', '1954-02-26')).toEqual(['1039032070'])
    expect(ids('1954-02-27', '1954-02-27')).toEqual(['1039032070', 'SANGER-1954-02-27'])
  })

  it('applies the same rule to the data table window (dateOverlaps with an exclusive end)', () => {
    const day = (y, m, d) => new Date(y, m - 1, d)
    expect(dateOverlaps('1954-02', day(1954, 2, 14), day(1954, 2, 15))).toBe(true)
    expect(dateOverlaps('1954-02', day(1954, 3, 1), null)).toBe(false)
    expect(dateOverlaps('1954-02', null, day(1954, 2, 1))).toBe(false)
    expect(dateOverlaps('1965', day(1965, 12, 31), day(1966, 1, 1))).toBe(true)
    expect(dateOverlaps('1954-02-15', day(1954, 2, 16), null)).toBe(false)
  })
})
