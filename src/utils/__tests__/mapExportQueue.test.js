import { describe, expect, it } from 'vitest'
import { withMapExport } from '../mapExportQueue'

describe('map export queue', () => {
  it('serializes captures and lets a queued export proceed after a failure', async () => {
    const map = {}, calls = []
    let release
    const gate = new Promise(resolve => { release = resolve })
    const first = withMapExport(map, async () => { calls.push('first'); await gate; throw new Error('failed') })
    const second = withMapExport(map, () => { calls.push('second'); return 'done' })
    const rejected = expect(first).rejects.toThrow('failed')
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual(['first'])
    release()
    await rejected
    await expect(second).resolves.toBe('done')
    expect(calls).toEqual(['first', 'second'])
  })
})
