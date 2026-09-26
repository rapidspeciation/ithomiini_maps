// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useLegendPosition } from '../useLegendPosition'

function harness({ width = 1100, height = 700, legendWidth = 250, legendHeight = 150, scale = 1, controlsWidth = 0, controlsHeight = 0 } = {}) {
  const bounds = ref({ width, height })
  const dimensions = { width: legendWidth, height: legendHeight }
  const legendRef = ref({
    get offsetWidth() { return dimensions.width },
    get offsetHeight() { return dimensions.height },
    getBoundingClientRect: () => ({ left: position.posX.value, top: position.posY.value })
  })
  const store = {
    position: { x: 40, y: null },
    corner: 'bottom-left',
    stickyEdges: true,
    snapThreshold: 20,
    updatePosition: vi.fn(function (x, y) { this.position = { x, y } }),
    setCorner: vi.fn(function (corner) { this.corner = corner }),
    updateSize: vi.fn()
  }
  const exportMode = ref(scale !== 1)
  const position = useLegendPosition({
    legendRef,
    getEffectiveWidth: () => dimensions.width,
    containerBounds: computed(() => bounds.value),
    prevContainerBounds: bounds,
    bottomAttributionMargin: computed(() => controlsHeight),
    bottomControlWidth: computed(() => controlsWidth),
    currentWidth: ref(null),
    currentHeight: ref(null),
    legendStore: store,
    props: { containerRef: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    isExportMode: exportMode,
    renderScale: ref(scale)
  })
  return { position, bounds, dimensions, legendRef, store, exportMode }
}

describe('legend position contract', () => {
  it('keeps the right and bottom insets after content width and height change', () => {
    const h = harness()
    h.position.setCorner('bottom-right')
    expect(h.position.posX.value).toBe(840)
    expect(h.position.posY.value).toBe(540)
    h.dimensions.width = 330
    h.dimensions.height = 220
    h.position.repositionAfterSizeChange()
    expect(h.position.posX.value).toBe(760)
    expect(h.position.posY.value).toBe(470)
    h.position.cleanup()
  })

  it('positions scaled legends inside all four corners', () => {
    const h = harness({ scale: 1.5 })
    for (const [corner, x, y] of [
      ['top-left', 10, 10], ['top-right', 715, 10],
      ['bottom-left', 10, 465], ['bottom-right', 715, 465]
    ]) {
      h.position.setCorner(corner)
      expect([h.position.posX.value, h.position.posY.value]).toEqual([x, y])
    }
    h.position.cleanup()
  })

  it('restores normal-map manual placement after a smaller preview', () => {
    const h = harness()
    h.position.posX.value = 350
    h.position.posY.value = 200
    h.position.setFreePosition(350, 200)
    h.position.enterExportPreview()
    h.position.applyPositionForBounds({ width: 1100, height: 700 }, { width: 500, height: 400 })
    expect(h.position.posX.value).toBeLessThan(350)
    h.position.leaveExportPreview({ width: 1100, height: 700 })
    expect([h.position.posX.value, h.position.posY.value]).toEqual([350, 200])
    expect(h.store.position).toEqual({ x: 350, y: 200 })
    h.position.cleanup()
  })

  it('keeps free placement in pixels when the viewport changes', () => {
    const h = harness()
    h.position.setFreePosition(350, 200)
    h.position.applyPositionForBounds({ width: 1100, height: 700 }, { width: 900, height: 600 })
    expect([h.position.posX.value, h.position.posY.value]).toEqual([350, 200])
    h.position.applyPositionForBounds({ width: 900, height: 600 }, { width: 400, height: 300 })
    expect(h.position.posX.value).toBeLessThan(350)
    h.position.applyPositionForBounds({ width: 400, height: 300 }, { width: 900, height: 600 })
    expect([h.position.posX.value, h.position.posY.value]).toEqual([350, 200])
    h.position.cleanup()
  })

  it('retains the normal placement through a rapid preview toggle', () => {
    const h = harness()
    h.position.setFreePosition(350, 200)
    h.exportMode.value = true
    h.position.enterExportPreview()
    h.position.applyPositionForBounds({ width: 1100, height: 700 }, { width: 500, height: 400 })
    h.position.leaveExportPreview({ width: 1100, height: 700 })
    h.position.enterExportPreview()
    h.exportMode.value = false
    h.position.leaveExportPreview({ width: 1100, height: 700 })
    expect([h.position.posX.value, h.position.posY.value]).toEqual([350, 200])
    h.position.cleanup()
  })

  it('clears bottom controls only where the legend overlaps them', () => {
    const desktop = harness({ controlsWidth: 200, controlsHeight: 75 })
    desktop.position.setCorner('bottom-left')
    expect(desktop.position.posY.value).toBe(540)
    desktop.position.cleanup()

    const mobile = harness({ width: 375, controlsWidth: 200, controlsHeight: 75 })
    mobile.position.setCorner('bottom-left')
    expect(mobile.position.posY.value).toBe(465)
    mobile.position.cleanup()
  })

  it('snaps a drag to bottom-right above the control stack', () => {
    const h = harness({ controlsWidth: 200, controlsHeight: 75 })
    h.position.setCorner('top-left')
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: 10, clientY: 10 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 840, clientY: 465, bubbles: true }))
    expect(h.position.corner.value).toBe('bottom-right')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 465])
    expect(h.store.corner).toBe('top-left')
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(h.store.corner).toBe('bottom-right')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 465])
    h.position.cleanup()
  })

  it('detaches from a snap when the raw pointer leaves its corner', () => {
    const h = harness()
    h.position.setCorner('top-left')
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: 10, clientY: 10 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 840, clientY: 540 }))
    expect(h.position.corner.value).toBe('bottom-right')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 250 }))
    expect(h.position.corner.value).toBe('free')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([500, 250])
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(h.store.corner).toBe('free')
    expect(h.store.position).toEqual({ x: 500, y: 250 })
    h.position.cleanup()
  })

  it('attracts one edge during drag and keeps that position on release', () => {
    const h = harness()
    h.position.setCorner('top-left')
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: 10, clientY: 10 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 828, clientY: 100 }))
    expect(h.position.corner.value).toBe('free')
    expect(h.position.stickyEdge.value.right).toBe(true)
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 100])
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(h.store.corner).toBe('free')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 100])
    expect(h.store.position).toEqual({ x: 840, y: 100 })
    h.position.cleanup()
  })

  it('does not snap while sticky edges are disabled', () => {
    const h = harness()
    h.position.setCorner('top-left')
    h.store.stickyEdges = false
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: 10, clientY: 10 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 830, clientY: 530 }))
    expect(h.position.corner.value).toBe('free')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([830, 530])
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(h.store.corner).toBe('free')
    h.position.cleanup()
  })

  it('previews a snap in its resized frame without replacing normal placement', () => {
    const h = harness()
    h.position.setFreePosition(350, 200)
    h.position.enterExportPreview()
    h.exportMode.value = true
    h.bounds.value = { width: 500, height: 400 }
    h.position.applyPositionForBounds({ width: 1100, height: 700 }, h.bounds.value)
    const startX = h.position.posX.value
    const startY = h.position.posY.value
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: startX, clientY: startY })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240, clientY: 240 }))
    expect(h.position.corner.value).toBe('bottom-right')
    expect([h.position.posX.value, h.position.posY.value]).toEqual([240, 240])
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(h.store.corner).toBe('free')
    h.exportMode.value = false
    h.bounds.value = { width: 1100, height: 700 }
    h.position.leaveExportPreview(h.bounds.value)
    expect([h.position.posX.value, h.position.posY.value]).toEqual([350, 200])
    h.position.cleanup()
  })

  it('clamps an offscreen drag and clears a cancelled touch gesture', () => {
    const h = harness()
    h.position.setCorner('top-left')
    h.store.stickyEdges = false
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, clientX: 10, clientY: 10 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2000, clientY: 2000, bubbles: true }))
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 540])
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect([h.position.posX.value, h.position.posY.value]).toEqual([840, 540])
    h.position.startDrag({ target: { closest: () => null }, preventDefault() {}, touches: [{ clientX: 20, clientY: 20 }] })
    document.dispatchEvent(new Event('touchcancel'))
    expect(h.position.isDragging.value).toBe(false)
    h.position.cleanup()
  })
})
