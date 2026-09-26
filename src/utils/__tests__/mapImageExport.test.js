import { describe, expect, it, vi } from 'vitest'
import { captureMapImage, imageExportDimensions, containImage, includeExportNode, waitForMapIdle } from '../mapImageExport'

describe('image export composition', () => {
  it('fits the complete view without stretching when output aspect differs', () => {
    const rect = containImage(1100, 900, 800, 600)
    expect(rect.width / rect.height).toBeCloseTo(1100 / 900)
    expect(rect.x).toBeCloseTo(100 / 3)
    expect(rect.y).toBe(0)
    expect(rect.height).toBe(600)
  })
  it('rejects invalid or excessive output dimensions before allocating canvas', () => {
    expect(() => imageExportDimensions({ aspectRatio: 'custom', customWidth: 0, customHeight: 600, dpi: 100 })).toThrow(/dimensions/)
    expect(() => imageExportDimensions({ aspectRatio: 'custom', customWidth: 50000, customHeight: 50000, dpi: 300 })).toThrow(/dimensions/)
  })
  it('honors legend, scale and attribution settings using actual DOM classes', () => {
    const node = document.createElement('div')
    for (const name of ['legend-container', 'maplibregl-ctrl-scale', 'maplibregl-ctrl-attrib']) {
      node.className = name
      expect(includeExportNode(node, { includeLegend: false, includeScaleBar: false, includeAttribution: false })).toBe(false)
      expect(includeExportNode(node, { includeLegend: true, includeScaleBar: true, includeAttribution: true })).toBe(true)
    }
    node.className = 'maplibregl-ctrl-top-right'
    expect(includeExportNode(node, {})).toBe(false)
  })
  it('times out and removes idle listeners when the map never finishes loading', async () => {
    vi.useFakeTimers()
    const map = { loaded: () => false, on: vi.fn(), off: vi.fn() }
    const pending = waitForMapIdle(map, 100)
    const assertion = expect(pending).rejects.toThrow(/still loading/)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(map.off).toHaveBeenCalledWith('idle', expect.any(Function))
    vi.useRealTimers()
  })
  it('restores pixel ratio, preview border and collapsed credits when capture fails', async () => {
    const container = document.createElement('div')
    container.className = 'map-export-preview'
    container.innerHTML = '<details class="maplibregl-ctrl-attrib"></details>'
    Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    const map = { loaded: () => true, getContainer: () => container, getPixelRatio: () => 1,
      setPixelRatio: vi.fn(), triggerRepaint: vi.fn(), on: vi.fn(), off: vi.fn() }
    await expect(captureMapImage(map, { aspectRatio: 'custom', customWidth: 800, customHeight: 600, dpi: 100, includeAttribution: true }, {
      capture: async () => { expect(container.querySelector('details').open).toBe(true); throw new Error('capture failed') },
      settle: async () => {},
    })).rejects.toThrow('capture failed')
    expect(map.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(container.classList.contains('map-export-preview')).toBe(true)
    expect(container.querySelector('details').open).toBe(false)
  })
})
