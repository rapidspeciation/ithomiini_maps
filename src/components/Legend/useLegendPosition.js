import { ref } from 'vue'
import { LEGEND_LAYOUT } from './legendLayout'

const MARGIN = 10
const CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])

// Coordinates describe the rendered top-left corner. The legend uses
// transform-origin: top left, so CSS scaling cannot move that corner.
export function useLegendPosition({
  legendRef, getEffectiveWidth, containerBounds, prevContainerBounds,
  bottomAttributionMargin, bottomControlWidth = ref(0), legendStore, props,
  isExportMode = ref(false), renderScale = ref(1)
}) {
  const posX = ref(legendStore.position.x ?? MARGIN)
  const posY = ref(legendStore.position.y)
  const corner = ref(legendStore.corner || (posY.value === null ? 'bottom-left' : 'free'))
  const stickyEdge = ref(edgesFor(corner.value))
  const isDragging = ref(false)
  let dragStart = null
  let previewPlacement = null
  let legendResizeObserver = null
  let lastSize = { width: 0, height: 0 }

  function edgesFor(value) {
    return {
      left: value.endsWith('left'), right: value.endsWith('right'),
      top: value.startsWith('top'), bottom: value.startsWith('bottom')
    }
  }

  function bounds() {
    return prevContainerBounds.value.width > 0 ? prevContainerBounds.value : containerBounds.value
  }

  function renderedSize() {
    const scale = Number(renderScale.value) || 1
    return {
      width: (legendRef.value?.offsetWidth || getEffectiveWidth()) * scale,
      height: (legendRef.value?.offsetHeight || LEGEND_LAYOUT.FALLBACK_LEGEND_HEIGHT) * scale
    }
  }

  function clamp(x, y, frame = bounds()) {
    const size = renderedSize()
    const maxX = Math.max(MARGIN, frame.width - size.width - MARGIN)
    const clampedX = Math.max(MARGIN, Math.min(maxX, x))
    const overlapsControls = bottomControlWidth.value > 0 &&
      clampedX + size.width > frame.width - bottomControlWidth.value
    const bottomReserve = overlapsControls ? bottomAttributionMargin.value : 0
    const maxY = Math.max(MARGIN, frame.height - size.height - MARGIN - bottomReserve)
    return { x: clampedX, y: Math.max(MARGIN, Math.min(maxY, y)) }
  }

  function anchoredPosition(frame = bounds()) {
    const size = renderedSize()
    return clamp(
      stickyEdge.value.right ? frame.width - size.width - MARGIN : MARGIN,
      stickyEdge.value.bottom ? frame.height - size.height - MARGIN - (stickyEdge.value.right ? bottomAttributionMargin.value : 0) : MARGIN,
      frame
    )
  }

  function place(next, persist = false) {
    if (Math.abs(posX.value - next.x) > 0.5 || posY.value === null || Math.abs(posY.value - next.y) > 0.5) {
      posX.value = next.x
      posY.value = next.y
    }
    if (persist && !isExportMode.value) legendStore.updatePosition(posX.value, posY.value)
  }

  function freePosition() {
    // Saved placement remains the user's intent when a small viewport or
    // changed content temporarily forces a visible clamp.
    if (isExportMode.value || previewPlacement) return { x: posX.value, y: posY.value }
    return { x: legendStore.position.x ?? posX.value, y: legendStore.position.y ?? posY.value }
  }

  function repositionAfterSizeChange() {
    if (isDragging.value || !bounds().width || !bounds().height) return
    const free = freePosition()
    place(CORNERS.has(corner.value) ? anchoredPosition() : clamp(free.x, free.y))
  }

  function setCorner(value) {
    if (!CORNERS.has(value)) return
    if (!isExportMode.value) legendStore.setStickyEdges?.(true)
    corner.value = value
    stickyEdge.value = edgesFor(value)
    place(anchoredPosition(), true)
    if (!isExportMode.value) legendStore.setCorner(value)
  }

  function setFreePosition(x, y) {
    corner.value = 'free'
    stickyEdge.value = edgesFor('free')
    place(clamp(x, y), true)
    if (!isExportMode.value) legendStore.setCorner('free')
  }

  function applyPositionForBounds(_oldBounds, newBounds) {
    if (!newBounds.width || !newBounds.height) return
    if (CORNERS.has(corner.value)) {
      place(anchoredPosition(newBounds))
    } else {
      const free = freePosition()
      place(clamp(free.x, free.y, newBounds))
    }
    // Viewport and preview clamps are transient. Only a user gesture changes
    // the saved normal-map position.
  }

  function enterExportPreview() {
    if (!previewPlacement) previewPlacement = { x: posX.value, y: posY.value, corner: corner.value }
  }

  function leaveExportPreview(normalBounds) {
    if (!previewPlacement || isExportMode.value) return
    corner.value = previewPlacement.corner
    stickyEdge.value = edgesFor(corner.value)
    place(CORNERS.has(corner.value)
      ? anchoredPosition(normalBounds)
      : clamp(previewPlacement.x, previewPlacement.y, normalBounds))
    previewPlacement = null
  }

  function detectStickyEdges() {
    // Upgrade positions saved before the explicit corner preference existed.
    if (legendStore.corner) return
    const frame = bounds()
    if (!frame.width || !frame.height) return
    const size = renderedSize()
    const x = posX.value
    const y = posY.value ?? frame.height - size.height - MARGIN
    const horizontal = x <= 40 ? 'left' : x >= frame.width - size.width - 40 ? 'right' : null
    const overlapsControls = bottomControlWidth.value > 0 &&
      x + size.width > frame.width - bottomControlWidth.value
    const reserve = overlapsControls ? bottomAttributionMargin.value : 0
    const vertical = y <= 40 ? 'top' : y >= frame.height - size.height - MARGIN - reserve - 40 ? 'bottom' : null
    if (horizontal && vertical) setCorner(`${vertical}-${horizontal}`)
    else legendStore.setCorner('free')
  }

  function startDrag(e) {
    if (e.target.closest('button, select, input, .color-by-select, .legend-item, .legend-group-header, .color-picker-portal, .abbreviation-dropdown, .resize-zone')) return
    if (!legendRef.value) return
    e.preventDefault()
    const rect = legendRef.value.getBoundingClientRect()
    const containerRect = props.containerRef?.getBoundingClientRect() || { left: 0, top: 0 }
    dragStart = {
      x: e.clientX ?? e.touches?.[0]?.clientX ?? 0,
      y: e.clientY ?? e.touches?.[0]?.clientY ?? 0,
      positionX: rect.left - containerRect.left,
      positionY: rect.top - containerRect.top,
      corner: corner.value,
      rawX: rect.left - containerRect.left,
      rawY: rect.top - containerRect.top,
      moved: false
    }
    isDragging.value = true
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)
    document.addEventListener('touchmove', onDrag, { passive: false })
    document.addEventListener('touchend', endDrag)
    document.addEventListener('touchcancel', cancelDrag)
  }

  function dragPosition(rawX, rawY, frame = bounds()) {
    const clamped = clamp(rawX, rawY, frame)
    if (!legendStore.stickyEdges) {
      return { ...clamped, corner: null, edges: edgesFor('free') }
    }
    const size = renderedSize()
    const threshold = legendStore.snapThreshold
    const rightX = Math.max(MARGIN, frame.width - size.width - MARGIN)
    const nearLeft = clamped.x <= MARGIN + threshold
    const nearRight = clamped.x >= rightX - threshold
    const horizontal = nearLeft && nearRight
      ? (Math.abs(clamped.x - MARGIN) <= Math.abs(clamped.x - rightX) ? 'left' : 'right')
      : nearLeft ? 'left' : nearRight ? 'right' : null
    const x = horizontal === 'left' ? MARGIN : horizontal === 'right' ? rightX : clamped.x
    const bottomY = clamp(x, Infinity, frame).y
    const yWithinFrame = Math.min(clamped.y, bottomY)
    const nearTop = yWithinFrame <= MARGIN + threshold
    const nearBottom = yWithinFrame >= bottomY - threshold
    const vertical = nearTop && nearBottom
      ? (Math.abs(yWithinFrame - MARGIN) <= Math.abs(yWithinFrame - bottomY) ? 'top' : 'bottom')
      : nearTop ? 'top' : nearBottom ? 'bottom' : null
    const y = vertical === 'top' ? MARGIN : vertical === 'bottom' ? bottomY : yWithinFrame
    return {
      x, y,
      corner: horizontal && vertical ? `${vertical}-${horizontal}` : null,
      edges: { left: horizontal === 'left', right: horizontal === 'right',
        top: vertical === 'top', bottom: vertical === 'bottom' }
    }
  }

  function onDrag(e) {
    if (!isDragging.value || !dragStart) return
    e.preventDefault()
    const x = dragStart.positionX + (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - dragStart.x
    const y = dragStart.positionY + (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - dragStart.y
    dragStart.rawX = x
    dragStart.rawY = y
    dragStart.moved = dragStart.moved || Math.abs(x - dragStart.positionX) > 1 || Math.abs(y - dragStart.positionY) > 1
    const next = dragPosition(x, y)
    corner.value = next.corner || 'free'
    stickyEdge.value = next.edges
    place(next)
  }

  function removeDragListeners() {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', endDrag)
    document.removeEventListener('touchmove', onDrag)
    document.removeEventListener('touchend', endDrag)
    document.removeEventListener('touchcancel', cancelDrag)
  }

  function endDrag() {
    if (isDragging.value) {
      isDragging.value = false
      if (dragStart?.moved) {
        if (legendStore.stickyEdges && CORNERS.has(corner.value)) setCorner(corner.value)
        else setFreePosition(posX.value, posY.value)
      }
    }
    dragStart = null
    removeDragListeners()
  }

  function cancelDrag() {
    if (dragStart) {
      corner.value = dragStart.corner
      stickyEdge.value = edgesFor(corner.value)
      posX.value = dragStart.positionX
      posY.value = dragStart.positionY
    }
    isDragging.value = false
    dragStart = null
    repositionAfterSizeChange()
    removeDragListeners()
  }

  function setupLegendResizeObserver() {
    if (!legendRef.value || legendResizeObserver) return
    lastSize = { width: legendRef.value.offsetWidth, height: legendRef.value.offsetHeight }
    legendResizeObserver = new ResizeObserver(() => {
      const size = { width: legendRef.value?.offsetWidth || 0, height: legendRef.value?.offsetHeight || 0 }
      if (!size.width || !size.height) return
      if (Math.abs(size.width - lastSize.width) < 1 && Math.abs(size.height - lastSize.height) < 1) return
      lastSize = size
      repositionAfterSizeChange()
    })
    legendResizeObserver.observe(legendRef.value)
  }

  function cleanup() {
    removeDragListeners()
    legendResizeObserver?.disconnect()
    legendResizeObserver = null
  }

  return {
    STICKY_MARGIN: MARGIN, posX, posY, corner, isDragging, stickyEdge,
    startDrag, endDrag, detectStickyEdges, applyPositionForBounds,
    repositionAfterSizeChange, setCorner, setFreePosition,
    enterExportPreview, leaveExportPreview, setupLegendResizeObserver, cleanup
  }
}
