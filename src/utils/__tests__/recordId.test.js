import { describe, expect, it } from 'vitest'
import { displayRecordId, isSyntheticId, recordIdTitle } from '../recordId'

describe('record ids', () => {
  it('shows synthetic ids as No ID and keeps real ids', () => {
    expect(displayRecordId('NOID-SANGER-13B9401E71')).toBe('No ID')
    expect(displayRecordId('CAM071479')).toBe('CAM071479')
    expect(displayRecordId('ME22_100')).toBe('ME22_100')
    expect(displayRecordId('')).toBe('N/A')
    expect(displayRecordId(null, '—')).toBe('—')
  })

  it('recognises only the NOID- prefix', () => {
    expect(isSyntheticId('NOID-SANGER-ABC')).toBe(true)
    expect(isSyntheticId('CAM000001')).toBe(false)
    expect(isSyntheticId(undefined)).toBe(false)
    expect(recordIdTitle('CAM000001')).toBeUndefined()
    expect(recordIdTitle('NOID-SANGER-ABC')).toContain('NOID-SANGER-ABC')
  })
})
