// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useElementResize } from '../useElementResize'

function fixture(scale = 1) {
  const onEnd = vi.fn()
  const resize = useElementResize(ref({ offsetWidth: 220, offsetHeight: 160 }), {
    getPosition: () => ({ x: 30, y: 40 }),
    getLimits: () => ({ minW: 200, maxW: 400, minH: 120, maxH: 300 }),
    getScale: () => scale,
    onEnd
  })
  return { resize, onEnd }
}

describe('useElementResize', () => {
  it('converts rendered pointer distance to layout size at export scale', () => {
    const { resize, onEnd } = fixture(1.5)
    resize.startResize({ clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, 'e')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onEnd).toHaveBeenCalledWith({ x: 30, y: 40, width: 240, height: 160 })
    resize.cleanup()
  })

  it('cancels a touch resize without saving and removes listeners on cleanup', () => {
    const { resize, onEnd } = fixture()
    resize.startResizeTouch({ touches: [{ clientX: 0, clientY: 0 }], preventDefault() {}, stopPropagation() {} }, 'se')
    document.dispatchEvent(new Event('touchcancel'))
    expect(resize.isResizing.value).toBe(false)
    expect(resize.resizeOverride.value).toBe(null)
    expect(onEnd).not.toHaveBeenCalled()
    resize.startResize({ clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, 'e')
    resize.cleanup()
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('Ctrl+corner drag changes uniform scale while an ordinary corner drag changes dimensions', () => {
    const onScaleEnd = vi.fn()
    const onEnd = vi.fn()
    const resize = useElementResize(ref({ offsetWidth: 200, offsetHeight: 100 }), {
      getPosition: () => ({ x: 30, y: 40 }),
      getLimits: () => ({ minW: 150, maxW: 500, minH: 80, maxH: 400 }),
      getScale: () => 1,
      getUniformScale: () => 1,
      onScaleEnd,
      onEnd
    })
    resize.startResize({ clientX: 0, clientY: 0, ctrlKey: true, preventDefault() {}, stopPropagation() {} }, 'nw')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -50, clientY: -25 }))
    expect(resize.scaleOverride.value).toEqual({ scale: 1.25, x: -20, y: 15 })
    expect(resize.resizeOverride.value).toBeNull()
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onScaleEnd).toHaveBeenCalledWith({ scale: 1.25, x: -20, y: 15 })
    expect(onEnd).not.toHaveBeenCalled()

    resize.startResize({ clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, 'se')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 20 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onEnd).toHaveBeenCalledWith({ x: 30, y: 40, width: 230, height: 120 })
    resize.cleanup()
  })
})
