// Legend drag, position, and sticky-edge logic
// Extracted from Legend.vue for maintainability (~250 lines)

import { ref, computed } from 'vue'
import { LEGEND_LAYOUT } from './legendLayout'

const STICKY_MARGIN = 10
const FALLBACK_LEGEND_HEIGHT = LEGEND_LAYOUT.FALLBACK_LEGEND_HEIGHT
const FALLBACK_CONTAINER_HEIGHT = LEGEND_LAYOUT.FALLBACK_CONTAINER_HEIGHT

/**
 * Composable for legend positioning and drag behavior
 * @param {Object} params
 * @param {import('vue').Ref} params.legendRef - Template ref to legend container
 * @param {Function} params.getEffectiveWidth - Getter for effective width
 * @param {import('vue').ComputedRef} params.containerBounds - Fallback container bounds
 * @param {import('vue').Ref} params.prevContainerBounds - Reactive container bounds
 * @param {import('vue').ComputedRef} params.bottomAttributionMargin - Attribution margin
 * @param {import('vue').ComputedRef} params.isAttributionOpen - Whether attribution is open
 * @param {import('vue').Ref} params.currentWidth - Current manual width
 * @param {import('vue').Ref} params.currentHeight - Current manual height
 * @param {Object} params.legendStore - Legend Pinia store
 * @param {Object} params.props - Component props (containerRef)
 */
export function useLegendPosition({
  legendRef, getEffectiveWidth, containerBounds, prevContainerBounds,
  bottomAttributionMargin, isAttributionOpen,
  currentWidth, currentHeight, legendStore, props
}) {
  // Position state
  const posX = ref(legendStore.position.x || 40)
  const posY = ref(legendStore.position.y)

  // On mobile, reserve extra space below the legend's resting position so it
  // clears the bottom scale bar and attribution.
  const MOBILE_BOTTOM_RESERVE = 44
  const mobileBottomReserve = () =>
    (containerBounds.value.width > 0 && containerBounds.value.width <= LEGEND_LAYOUT.MOBILE_CONTAINER_WIDTH)
      ? MOBILE_BOTTOM_RESERVE
      : 0

  // Drag state
  const isDragging = ref(false)
  const dragStart = ref({ x: 0, y: 0 })
  const dragStartPos = ref({ x: 0, y: 0 })

  // Sticky edge state
  const stickyEdge = ref({
    left: true,
    right: false,
    top: false,
    bottom: true
  })

  // ── Drag handling ─────────────────────────────────────────────────────

  function startDrag(e) {
    if (e.target.closest('button') ||
        e.target.closest('select') ||
        e.target.closest('input') ||
        e.target.closest('.color-by-select') ||
        e.target.closest('.legend-item') ||
        e.target.closest('.legend-group-header') ||
        e.target.closest('.color-picker-portal') ||
        e.target.closest('.abbreviation-dropdown')) return

    e.preventDefault()
    isDragging.value = true

    dragStart.value = {
      x: e.clientX || e.touches?.[0]?.clientX || 0,
      y: e.clientY || e.touches?.[0]?.clientY || 0
    }

    const rect = legendRef.value.getBoundingClientRect()
    const containerRect = props.containerRef?.getBoundingClientRect() || { left: 0, top: 0 }

    dragStartPos.value = {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top
    }

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)
    document.addEventListener('touchmove', onDrag, { passive: false })
    document.addEventListener('touchend', endDrag)
  }

  function onDrag(e) {
    if (!isDragging.value) return

    e.preventDefault()

    const clientX = e.clientX || e.touches?.[0]?.clientX || 0
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0

    const deltaX = clientX - dragStart.value.x
    const deltaY = clientY - dragStart.value.y

    let newX = dragStartPos.value.x + deltaX
    let newY = dragStartPos.value.y + deltaY

    stickyEdge.value = { left: false, right: false, top: false, bottom: false }

    if (legendStore.stickyEdges) {
      const threshold = legendStore.snapThreshold
      const bounds = prevContainerBounds.value.width > 0 ? prevContainerBounds.value : containerBounds.value
      const legendWidth = legendRef.value?.offsetWidth || getEffectiveWidth()
      const legendHeight = legendRef.value?.offsetHeight || FALLBACK_LEGEND_HEIGHT
      const margin = STICKY_MARGIN

      if (newX >= 0 && newX < threshold) {
        newX = margin
        stickyEdge.value.left = true
      }
      if (newX > bounds.width - legendWidth - threshold && newX <= bounds.width - legendWidth) {
        newX = bounds.width - legendWidth - margin
        stickyEdge.value.right = true
      }
      if (newY >= 0 && newY < threshold) {
        newY = margin
        stickyEdge.value.top = true
      }
      const bottomSnapY = bounds.height - legendHeight - margin - bottomAttributionMargin.value - mobileBottomReserve()
      if (newY > bottomSnapY - threshold && newY <= bounds.height - legendHeight) {
        newY = bottomSnapY
        stickyEdge.value.bottom = true
      }
    }

    posX.value = newX
    posY.value = newY
  }

  function endDrag() {
    if (isDragging.value) {
      isDragging.value = false
      legendStore.updatePosition(posX.value, posY.value)
    }

    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', endDrag)
    document.removeEventListener('touchmove', onDrag)
    document.removeEventListener('touchend', endDrag)
  }

  // ── Sticky edge detection ─────────────────────────────────────────────

  function detectStickyEdges(wasExportMode = null, useBounds = null) {
    const bounds = useBounds || (prevContainerBounds.value.width ? prevContainerBounds.value : containerBounds.value)
    if (!bounds.width || !bounds.height) return

    const legendWidth = legendRef.value?.offsetWidth || getEffectiveWidth()
    const legendHeight = legendRef.value?.offsetHeight || FALLBACK_LEGEND_HEIGHT
    const threshold = 20
    const margin = STICKY_MARGIN

    const effectiveY = posY.value !== null ? posY.value : bounds.height - legendHeight - 30

    const attrMargin = isAttributionOpen.value ? bottomAttributionMargin.value : 0
    const bottomEdgeY = bounds.height - legendHeight - margin - attrMargin - mobileBottomReserve()

    const isAtBottom = effectiveY >= bottomEdgeY - threshold

    stickyEdge.value = {
      left: posX.value <= threshold,
      right: posX.value >= bounds.width - legendWidth - threshold,
      top: effectiveY <= threshold,
      bottom: posY.value === null || isAtBottom
    }
  }

  // ── Bounds change repositioning ───────────────────────────────────────

  function applyPositionForBounds(oldBounds, newBounds) {
    const legendWidth = legendRef.value?.offsetWidth || getEffectiveWidth()
    let legendHeight = legendRef.value?.offsetHeight || FALLBACK_LEGEND_HEIGHT
    const margin = STICKY_MARGIN
    const minHeight = 100

    const bottomMargin = margin + bottomAttributionMargin.value + mobileBottomReserve()
    const maxAllowedHeight = newBounds.height - margin - bottomMargin

    if (legendHeight > maxAllowedHeight && maxAllowedHeight >= minHeight) {
      // Auto-sized legends are already constrained by CSS max-height. Do not
      // persist a temporary viewport clamp as a manual legend-size preference;
      // otherwise a Table/Map transition can leave future map views stuck with
      // a short, scrollable legend. Only user/manual sizes should be stored.
      if (currentHeight.value !== null) {
        currentHeight.value = maxAllowedHeight
        legendStore.updateSize(currentWidth.value ?? 'auto', maxAllowedHeight)
      }
      legendHeight = maxAllowedHeight
    }

    let newX = posX.value
    let newY = posY.value

    if (stickyEdge.value.left) {
      newX = margin
    } else if (stickyEdge.value.right) {
      newX = newBounds.width - legendWidth - margin
    } else {
      if (oldBounds.width > 0) {
        const relativeX = posX.value / oldBounds.width
        newX = relativeX * newBounds.width
      }
      newX = Math.max(margin, Math.min(newBounds.width - legendWidth - margin, newX))
    }

    if (stickyEdge.value.top) {
      newY = margin
    } else if (stickyEdge.value.bottom) {
      newY = newBounds.height - legendHeight - bottomMargin
    } else {
      if (oldBounds.height > 0) {
        const relativeY = posY.value / oldBounds.height
        newY = relativeY * newBounds.height
      }
      newY = Math.max(margin, Math.min(newBounds.height - legendHeight - bottomMargin, newY))
    }

    newX = Math.max(margin, Math.min(newBounds.width - legendWidth - margin, newX))
    newY = Math.max(margin, Math.min(newBounds.height - legendHeight - bottomMargin, newY))

    posX.value = newX
    posY.value = newY
    legendStore.updatePosition(newX, newY)
  }

  // ── Attribution repositioning ─────────────────────────────────────────

  function repositionForAttributionChange() {
    if (!props.containerRef) return

    const bounds = {
      width: props.containerRef.clientWidth || 800,
      height: props.containerRef.clientHeight || FALLBACK_CONTAINER_HEIGHT
    }

    const legendHeight = legendRef.value?.offsetHeight || FALLBACK_LEGEND_HEIGHT
    const margin = STICKY_MARGIN
    const bottomMargin = margin + bottomAttributionMargin.value + mobileBottomReserve()

    if (stickyEdge.value.bottom) {
      posY.value = bounds.height - legendHeight - bottomMargin
      legendStore.updatePosition(posX.value, posY.value)
    }
  }

  // ── Bottom-sticky repositioning ───────────────────────────────────────

  let legendResizeObserver = null
  let lastLegendHeight = 0

  function repositionIfBottomSticky() {
    if (!stickyEdge.value.bottom || !legendRef.value || posY.value === null) return
    if (isDragging.value) return

    const bounds = prevContainerBounds.value.width > 0 ? prevContainerBounds.value : containerBounds.value
    const legendHeight = legendRef.value.offsetHeight
    if (legendHeight <= 0 || !bounds.width || !bounds.height) return
    const margin = STICKY_MARGIN
    const bottomMargin = margin + bottomAttributionMargin.value + mobileBottomReserve()
    const targetY = bounds.height - legendHeight - bottomMargin

    if (Math.abs(posY.value - targetY) > 2) {
      posY.value = targetY
      legendStore.updatePosition(posX.value, posY.value)
    }
  }

  function setupLegendResizeObserver() {
    if (!legendRef.value || legendResizeObserver) return

    lastLegendHeight = legendRef.value.offsetHeight

    legendResizeObserver = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect?.height || 0
      if (newHeight === 0 || Math.abs(newHeight - lastLegendHeight) < 2) return
      lastLegendHeight = newHeight
      repositionIfBottomSticky()
    })

    legendResizeObserver.observe(legendRef.value)
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  function cleanup() {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', endDrag)
    document.removeEventListener('touchmove', onDrag)
    document.removeEventListener('touchend', endDrag)
    if (legendResizeObserver) {
      legendResizeObserver.disconnect()
      legendResizeObserver = null
    }
  }

  return {
    STICKY_MARGIN,
    posX,
    posY,
    isDragging,
    stickyEdge,
    startDrag,
    endDrag,
    detectStickyEdges,
    applyPositionForBounds,
    repositionForAttributionChange,
    repositionIfBottomSticky,
    setupLegendResizeObserver,
    cleanup
  }
}
