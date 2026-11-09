import { afterEach, describe, expect, it } from 'vitest'
import { dateDisplayParts, dateOverlaps, dateSortValue, parseDate, toLocalISODate } from '../dateHelpers'

const originalTz = process.env.TZ

describe('dateHelpers', () => {
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('returns null for impossible calendar dates instead of rolling them into another day', () => {
    expect(parseDate('2022-13-45')).toBeNull()
    expect(parseDate('2022-02-30')).toBeNull()
    expect(parseDate('2022-00')).toBeNull()
    expect(parseDate('2024-02-29')).toEqual(new Date(2024, 1, 29))
  })

  it('writes a GBIF date back as the same day east and west of UTC', () => {
    for (const tz of ['Europe/Paris', 'America/Guayaquil']) {
      process.env.TZ = tz
      expect(toLocalISODate(parseDate('2022-01-18'))).toBe('2022-01-18')
      expect(toLocalISODate(parseDate('18-Jan-22'))).toBe('2022-01-18')
    }
  })

  it('reads a GBIF range (ISO 8601 interval) as its start day, for sorting, plots and the panel dates', () => {
    for (const tz of ['Europe/Paris', 'America/Guayaquil']) {
      process.env.TZ = tz
      expect(parseDate('1997-11-07/1997-11-10')).toEqual(new Date(1997, 10, 7))
      expect(parseDate('2006-10/2006-11')).toEqual(new Date(2006, 9, 1))
      expect(parseDate('2009/2010')).toEqual(new Date(2009, 0, 1))
      expect(parseDate('2009-12-30T09:15/2009-12-30T10:00')).toEqual(new Date(2009, 11, 30, 9, 15))
      expect(toLocalISODate(parseDate('1997-11-07/1997-11-10'))).toBe('1997-11-07')
    }
  })

  it('returns null for a range that ends before it starts or has an unreadable side', () => {
    expect(parseDate('1997-11-10/1997-11-07')).toBeNull()
    expect(parseDate('1997-11-07/1997-13-01')).toBeNull()
    expect(parseDate('1997-11-07/')).toBeNull()
    expect(parseDate('/1997-11-07')).toBeNull()
  })

  it('matches a range against a window when any of its days falls inside (end exclusive)', () => {
    const y = year => new Date(year, 0, 1)
    // The data table's year filter 1990-2000 is the window [1 Jan 1990, 1 Jan 2001).
    expect(dateOverlaps('1997-11-07/1997-11-10', y(1990), y(2001))).toBe(true)
    expect(dateOverlaps('2009/2010', y(2010), y(2011))).toBe(true)
    expect(dateOverlaps('2009/2010', y(2011), null)).toBe(false)
    expect(dateOverlaps('2009/2010', null, y(2009))).toBe(false)
    expect(dateOverlaps('2000/2001', null, y(2001))).toBe(true)
    // Full single dates keep their old rule: the day itself must be inside (month and year dates: partialDates.test.js).
    expect(dateOverlaps('2011-12-23', y(2011), y(2012))).toBe(true)
    expect(dateOverlaps('2011-12-23', y(2023), y(2024))).toBe(false)
    expect(dateOverlaps('18-Jan-22', y(2022), y(2023))).toBe(true)
    expect(dateOverlaps('', y(2022), y(2023))).toBe(false)
  })

  it('splits a range at its slash for display and leaves any other date whole', () => {
    expect(dateDisplayParts('1997-11-07/1997-11-10')).toEqual(['1997-11-07', '1997-11-10'])
    expect(dateDisplayParts('2009-12-30T09:15/2009-12-30T10:00')).toEqual(['2009-12-30T09:15', '2009-12-30T10:00'])
    expect(dateDisplayParts('1954-02')).toEqual(['1954-02'])
    expect(dateDisplayParts('12/03/15')).toEqual(['12/03/15'])
    expect(dateDisplayParts('18-Jan-22')).toEqual(['18-Jan-22'])
  })

  it('sorts a range by its start in the host plant gallery', () => {
    const values = ['2010-01-01', '2009/2010', '2009-12-31', '2009-06-01/2009-06-03', '2009-06-02']
    expect([...values].sort((a, b) => dateSortValue(a) - dateSortValue(b)))
      .toEqual(['2009/2010', '2009-06-01/2009-06-03', '2009-06-02', '2009-12-31', '2010-01-01'])
  })
})
