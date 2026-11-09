import { afterEach, describe, expect, it } from 'vitest'
import { parseDate, toLocalISODate } from '../dateHelpers'

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
})
