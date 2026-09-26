import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useStyleSwitcher } from '../useStyleSwitcher'

afterEach(() => vi.useRealTimers())

describe('useStyleSwitcher', () => {
  it('runs idle restoration only for the latest style and keeps its changing flag', async () => {
    vi.useFakeTimers()
    const handlers = new Map()
    const map = {
      getCenter: () => ({ lng: -60, lat: -5 }),
      getZoom: () => 4,
      getBearing: () => 0,
      getPitch: () => 0,
      isStyleLoaded: () => true,
      setStyle: vi.fn(), jumpTo: vi.fn(),
      once: vi.fn((event, handler) => handlers.set(event, handler)),
    }
    const changing = vi.fn()
    const idle = vi.fn()
    const start = vi.fn()
    const { switchStyle } = useStyleSwitcher(ref(map), vi.fn(), {
      setStyleChanging: changing,
      onStyleStart: start,
      onStyleIdle: idle,
    })

    await switchStyle('light')
    handlers.get('style.load')()
    handlers.get('idle')()
    await switchStyle('dark')
    await vi.advanceTimersByTimeAsync(100)
    expect(changing).toHaveBeenCalledTimes(2)
    expect(changing).toHaveBeenLastCalledWith(true)
    expect(start).toHaveBeenCalledTimes(2)
    expect(idle).toHaveBeenCalledTimes(1)

    handlers.get('style.load')()
    handlers.get('idle')()
    await vi.advanceTimersByTimeAsync(100)
    expect(changing).toHaveBeenLastCalledWith(false)
    expect(idle).toHaveBeenCalledTimes(2)
  })
})
