import { ref } from 'vue'

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val))
}

/**
 * Multi-directional resize composable for an element.
 * Supports 8 directions (n, s, e, w, ne, nw, se, sw) with mouse and touch.
 *
 * @param {Ref} elementRef - Vue ref to the DOM element being resized
 * @param {Object} options
 * @param {() => {x: number, y: number}} options.getPosition - Returns current element position
 * @param {() => {minW: number, maxW: number, minH: number, maxH: number}} options.getLimits - Returns size limits
 * @param {(result: {x, y, width, height}) => void} options.onEnd - Called when resize completes with final values
 * @param {() => void} [options.onStart] - Called when resize begins
 * @returns {{ isResizing: Ref<boolean>, resizeOverride: Ref, startResize: Function, startResizeTouch: Function }}
 */
export function useElementResize(elementRef, options) {
  const isResizing = ref(false)
  const isScaling = ref(false)
  const resizeOverride = ref(null)
  const scaleOverride = ref(null)

  // Internal state (not exposed)
  const direction = ref(null)
  const startMouse = ref({ x: 0, y: 0 })
  const startSize = ref({ width: 0, height: 0 })
  const startPos = ref({ x: 0, y: 0 })
  const startUniformScale = ref(1)
  const startRenderScale = ref(1)

  function startResize(e, dir) {
    e.preventDefault()
    e.stopPropagation()

    const scaleGesture = e.ctrlKey && dir.length === 2 && options.getUniformScale
    isScaling.value = Boolean(scaleGesture)
    isResizing.value = !scaleGesture
    direction.value = dir
    startMouse.value = { x: e.clientX, y: e.clientY }

    const el = elementRef.value
    if (el) {
      startSize.value = { width: el.offsetWidth, height: el.offsetHeight }
    }
    startPos.value = options.getPosition()
    startUniformScale.value = options.getUniformScale?.() || 1
    startRenderScale.value = options.getScale?.() || 1
    if (scaleGesture) options.onScaleStart?.(startSize.value)
    else options.onStart?.()

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)
  }

  function onDrag(e) {
    if ((!isResizing.value && !isScaling.value) || !direction.value) return

    if (isScaling.value) {
      const dx = e.clientX - startMouse.value.x
      const dy = e.clientY - startMouse.value.y
      const width = startSize.value.width * startRenderScale.value
      const height = startSize.value.height * startRenderScale.value
      const horizontal = direction.value.includes('e') ? 1 : -1
      const vertical = direction.value.includes('s') ? 1 : -1
      const change = (horizontal * dx * width + vertical * dy * height) / (width * width + height * height)
      const { min = 0.5, max = 2 } = options.getScaleLimits?.() || {}
      const scale = clamp(startUniformScale.value * (1 + change), min, max)
      const factor = scale / startUniformScale.value
      scaleOverride.value = {
        scale,
        x: startPos.value.x + (horizontal < 0 ? width * (1 - factor) : 0),
        y: startPos.value.y + (vertical < 0 ? height * (1 - factor) : 0)
      }
      return
    }

    const scale = options.getScale?.() || 1
    const dx = (e.clientX - startMouse.value.x) / scale
    const dy = (e.clientY - startMouse.value.y) / scale
    const dir = direction.value
    const { minW, maxW, minH, maxH } = options.getLimits()

    let w = startSize.value.width
    let h = startSize.value.height
    let x = startPos.value.x
    let y = startPos.value.y

    // Width: east grows right, west grows left (keeps right edge fixed)
    if (dir.includes('e')) {
      w = clamp(w + dx, minW, maxW)
    } else if (dir.includes('w')) {
      const pw = clamp(w - dx, minW, maxW)
      x += (w - pw) * scale
      w = pw
    }

    // Height: south grows down, north grows up (keeps bottom edge fixed)
    if (dir.includes('s')) {
      h = clamp(h + dy, minH, maxH)
    } else if (dir.includes('n')) {
      const ph = clamp(h - dy, minH, maxH)
      y += (h - ph) * scale
      h = ph
    }

    resizeOverride.value = { x, y, width: w, height: h }
  }

  function endDrag() {
    if (isScaling.value && scaleOverride.value) {
      options.onScaleEnd?.(scaleOverride.value)
    } else if (isScaling.value) {
      options.onScaleCancel?.()
    } else if (isResizing.value && resizeOverride.value) {
      options.onEnd(resizeOverride.value)
    }

    isResizing.value = false
    isScaling.value = false
    direction.value = null
    resizeOverride.value = null
    scaleOverride.value = null

    removeListeners()
  }

  function removeListeners() {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', endDrag)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('touchcancel', cancelResize)
  }

  function cancelResize() {
    if (isScaling.value) options.onScaleCancel?.()
    isResizing.value = false
    isScaling.value = false
    direction.value = null
    resizeOverride.value = null
    scaleOverride.value = null
    removeListeners()
  }

  // Touch support
  function startResizeTouch(e, dir) {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      startResize({
        clientX: t.clientX,
        clientY: t.clientY,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
        ctrlKey: false
      }, dir)

      document.addEventListener('touchmove', onTouchMove, { passive: false })
      document.addEventListener('touchend', onTouchEnd)
      document.addEventListener('touchcancel', cancelResize)
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 1 && (isResizing.value || isScaling.value)) {
      onDrag({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })
      e.preventDefault()
    }
  }

  function onTouchEnd() {
    endDrag()
  }

  return { isResizing, isScaling, resizeOverride, scaleOverride, startResize, startResizeTouch, cleanup: cancelResize }
}
