import { describe, expect, it } from 'vitest'
import { EXPORT_CHANGED_MESSAGE, runConsistentExport } from '../scriptedExport'

// A fake app: a filter and a hidden legend row; the capture is deferred so the test
// can change the state while it runs, as a visitor or a late data update would.
function fakeApp() {
  const state = { filter: 'female', hidden: [], changes: 0 }
  const set = (key, value) => { state[key] = value; state.changes++ }
  const reads = []
  return {
    state, set, reads,
    version: () => String(state.changes),
    snapshot: async () => {
      reads.push('snapshot')
      await Promise.resolve()
      return { filter: state.filter, hidden: [...state.hidden] }
    },
    capture: (during = []) => {
      let call = 0
      return async ({ onSettled, onCaptured }) => {
        const change = during[call++]
        await onSettled()
        // The picture is drawn from the state at this moment.
        await new Promise(resolve => setTimeout(resolve, 1))
        if (change) change()
        const picture = { filter: state.filter, hidden: [...state.hidden] }
        await onCaptured()
        reads.push('captured')
        return picture
      }
    },
  }
}

describe('scripted export reads its metadata with the picture', () => {
  it('returns the snapshot taken in onSettled, with nothing read after the capture', async () => {
    const app = fakeApp()
    const result = await runConsistentExport({ prepare: async () => {}, capture: app.capture(), snapshot: app.snapshot, version: app.version })
    expect(result.attempts).toBe(1)
    expect(result.snapshot).toEqual(result.output)
    expect(app.reads).toEqual(['snapshot', 'captured'])
  })

  it('a filter change during the capture drops the attempt and the retry is consistent', async () => {
    const app = fakeApp()
    const prepared = []
    const result = await runConsistentExport({
      prepare: async attempt => { prepared.push(attempt) },
      capture: app.capture([() => app.set('filter', 'male')]),
      snapshot: app.snapshot, version: app.version,
    })
    expect(prepared).toEqual([1, 2])
    expect(result.attempts).toBe(2)
    expect(result.snapshot).toEqual({ filter: 'male', hidden: [] })
    expect(result.output).toEqual(result.snapshot)
  })

  it('a legend row hidden and shown again during the capture still counts as a change', async () => {
    const app = fakeApp()
    const result = await runConsistentExport({
      prepare: async () => {},
      capture: app.capture([() => { app.set('hidden', ['hermias']); app.set('hidden', []) }]),
      snapshot: app.snapshot, version: app.version,
    })
    expect(result.attempts).toBe(2)
  })

  it('rejects explicitly when the state changes during both attempts', async () => {
    const app = fakeApp()
    await expect(runConsistentExport({
      prepare: async () => {},
      capture: app.capture([() => app.set('filter', 'male'), () => app.set('hidden', ['hermias'])]),
      snapshot: app.snapshot, version: app.version,
    })).rejects.toThrow(EXPORT_CHANGED_MESSAGE)
  })

  it('a change during the snapshot itself is caught too', async () => {
    const app = fakeApp()
    let first = true
    const snapshot = async () => {
      const taken = await app.snapshot()
      if (first) { first = false; app.set('filter', 'male') }
      return taken
    }
    const result = await runConsistentExport({ prepare: async () => {}, capture: app.capture(), snapshot, version: app.version })
    expect(result.attempts).toBe(2)
    expect(result.snapshot.filter).toBe('male')
  })
})
