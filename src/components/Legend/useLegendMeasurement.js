// Legend auto-sizing and DOM measurement logic
// Extracted from Legend.vue for maintainability
//
// Implements the "render-then-measure" pattern:
// 1. Render a generous upper-bound of items with overflow:hidden
// 2. Measure actual DOM item positions once
// 3. Apply the exact fitting count, with at most one follow-up pass

import { ref, computed, nextTick } from 'vue'
import { log } from '../../utils/logger'
import { LEGEND_LAYOUT } from './legendLayout'

/**
 * Composable for legend measurement and auto-sizing
 * @param {Object} params
 * @param {import('vue').Ref} params.legendRef - Template ref to legend container
 * @param {import('vue').Ref} params.contentRef - Template ref to legend content area
 * @param {import('vue').ComputedRef} params.containerBounds - Container dimensions
 * @param {import('vue').ComputedRef} params.isAutoWidth - Whether width is auto
 * @param {import('vue').ComputedRef} params.isAutoHeight - Whether height is auto
 * @param {import('vue').Ref} params.currentWidth - Current manual width
 * @param {import('vue').Ref} params.currentHeight - Current manual height
 * @param {import('vue').ComputedRef} params.isResizing - Whether resize is active
 * @param {import('vue').ComputedRef} params.resizeOverride - Resize override dimensions
 * @param {import('vue').ComputedRef} params.sortedAllItems - All sorted legend items
 * @param {import('vue').ComputedRef} params.legendCounts - Item count map
 * @param {Object} params.legendStore - Legend Pinia store
 * @param {Object} params.dataStore - Data Pinia store
 */
export function useLegendMeasurement({
  legendRef, contentRef, containerBounds,
  isAutoWidth, isAutoHeight, currentWidth, currentHeight,
  isResizing, resizeOverride, sortedAllItems, legendCounts,
  legendStore, dataStore
}) {
  // ── Text measurement ──────────────────────────────────────────────────
  let _measureSpan = null

  function measureTextWidth(text, fontSizePx) {
    if (!_measureSpan) {
      _measureSpan = document.createElement('span')
      _measureSpan.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-style:italic;pointer-events:none;top:-9999px;left:-9999px;'
      document.body.appendChild(_measureSpan)
    }
    _measureSpan.style.fontSize = fontSizePx + 'px'
    _measureSpan.textContent = text
    return _measureSpan.getBoundingClientRect().width
  }

  function cleanupMeasureSpan() {
    if (_measureSpan) {
      _measureSpan.remove()
      _measureSpan = null
    }
  }

  // ── Auto-width ────────────────────────────────────────────────────────
  // Sizes to the widest displayed label + count, not all items. Previously
  // used all sorted items (including those hidden behind "+N more"), which
  // produced unnecessary slack when the visible items were shorter.
  const autoWidth = computed(() => {
    const allItems = sortedAllItems.value
    if (!allItems.length) return LEGEND_LAYOUT.MIN_WIDTH

    const maxContainerWidth = containerBounds.value.width * LEGEND_LAYOUT.AUTO_WIDTH_MAX_CONTAINER_RATIO
    const fontSizePx = Math.round(14 * legendStore.textScale)
    const isGrouped = legendStore.isGrouped
    const visibleCount = measuredItemCount.value ?? allItems.length
    const items = allItems.slice(0, Math.max(1, visibleCount))

    let maxTextWidth = 0
    for (const item of items) {
      const label = item.displayLabel || item.label
      const width = measureTextWidth(label, fontSizePx)
      if (width > maxTextWidth) maxTextWidth = width
    }

    const dotSz = Math.max(6, Math.min(16, dataStore.mapStyle.pointSize))
    const padding = 16 * 2
    const gap = 8
    const safetyMargin = 4
    const indentation = isGrouped ? 20 : 0

    let countWidth = 0
    if (legendStore.showCounts) {
      const counts = legendCounts.value
      let maxCount = 0
      for (const item of items) {
        const c = counts[item.label] || 0
        if (c > maxCount) maxCount = c
      }
      const countFontSize = fontSizePx - 2
      countWidth = measureTextWidth(maxCount.toLocaleString(), countFontSize) + 8
    }

    const idealWidth = maxTextWidth + dotSz + gap + padding + indentation + countWidth + safetyMargin
    return Math.min(Math.max(Math.ceil(idealWidth), LEGEND_LAYOUT.MIN_WIDTH), maxContainerWidth, LEGEND_LAYOUT.MAX_WIDTH)
  })

  // ── Height computations ───────────────────────────────────────────────

  // On a narrow (mobile) map container, cap the legend to an absolute pixel
  // height so it does not cover most of the viewport.
  const isMobileContainer = computed(() => {
    const w = containerBounds.value.width
    return w > 0 && w <= LEGEND_LAYOUT.MOBILE_CONTAINER_WIDTH
  })

  const isExportMode = computed(() => dataStore.exportSettings.enabled)

  const maxLegendHeight = computed(() => {
    if (isExportMode.value) {
      return Math.floor(containerBounds.value.height * LEGEND_LAYOUT.EXPORT_MAX_HEIGHT_RATIO)
    }
    const h = Math.floor(containerBounds.value.height * LEGEND_LAYOUT.MAX_HEIGHT_RATIO)
    return isMobileContainer.value ? Math.min(h, LEGEND_LAYOUT.MOBILE_MAX_HEIGHT_PX) : h
  })

  const targetLegendHeight = computed(() => {
    if (isExportMode.value) {
      return Math.floor(containerBounds.value.height * LEGEND_LAYOUT.EXPORT_TARGET_HEIGHT_RATIO)
    }
    const h = Math.floor(containerBounds.value.height * LEGEND_LAYOUT.TARGET_HEIGHT_RATIO)
    return isMobileContainer.value ? Math.min(h, LEGEND_LAYOUT.MOBILE_TARGET_HEIGHT_PX) : h
  })

  // Generous over-estimate of how many items COULD fit. Actual count is
  // determined by post-render DOM measurement.
  const renderUpperBound = computed(() => {
    const minItemHeight = LEGEND_LAYOUT.MIN_ITEM_HEIGHT_PX
    const gap = 2
    const titleHeight = 32
    const padding = 24
    const moreReserve = 40

    let availableHeight
    if (isResizing.value && resizeOverride.value) {
      availableHeight = resizeOverride.value.height
    } else if (!isAutoHeight.value) {
      availableHeight = currentHeight.value || targetLegendHeight.value
    } else {
      availableHeight = targetLegendHeight.value
    }

    const available = availableHeight - titleHeight - padding - moreReserve
    const estimate = Math.max(1, Math.ceil(available / (minItemHeight + gap)))

    const total = sortedAllItems.value.length
    if (total <= 20) return Math.max(estimate, total)
    return estimate
  })

  // ── Measurement state ─────────────────────────────────────────────────

  const measuredItemCount = ref(null)
  const measuredSnugHeight = ref(null)
  const prevMeasuredCount = ref(null)
  const correctionSettled = ref(false)
  let containerResizeRemeasureTimeout = null
  let pendingMeasurementRAF = null
  let pendingFollowUpRAF = null
  let measurementGeneration = 0
  let correctionSteps = 0
  let lastMeasuredCount = -1
  let followUpScheduledForGeneration = -1

  // ── effectiveMaxItems ─────────────────────────────────────────────────
  // The actual item limit: measured value when available, upper bound otherwise

  const effectiveMaxItems = computed(() => {
    if (legendStore.isManualMode) return legendStore.maxItemsManual

    if (isResizing.value) {
      return renderUpperBound.value
    } else if (measuredItemCount.value !== null) {
      return measuredItemCount.value
    } else if (prevMeasuredCount.value !== null) {
      return prevMeasuredCount.value
    } else {
      return renderUpperBound.value
    }
  })

  // ── Scheduling ────────────────────────────────────────────────────────

  /**
   * Schedule a full measurement cycle. Uses double-rAF for accurate layout.
   * @param {boolean} resetState - true → reset measuredItemCount
   * @param {string} source - label for debug logging
   * @param {boolean} fullReset - also clear prevMeasuredCount
   */
  function scheduleMeasurement(resetState = true, source = '', fullReset = false) {
    if (pendingMeasurementRAF !== null) {
      cancelAnimationFrame(pendingMeasurementRAF)
      pendingMeasurementRAF = null
    }
    if (pendingFollowUpRAF !== null) {
      cancelAnimationFrame(pendingFollowUpRAF)
      pendingFollowUpRAF = null
    }
    if (containerResizeRemeasureTimeout) {
      clearTimeout(containerResizeRemeasureTimeout)
      containerResizeRemeasureTimeout = null
    }
    if (legendStore.isManualMode) return

    correctionSteps = 0
    correctionSettled.value = false
    measurementGeneration++
    lastMeasuredCount = -1
    followUpScheduledForGeneration = -1

    if (resetState) {
      prevMeasuredCount.value = fullReset ? null : measuredItemCount.value
      measuredItemCount.value = null
      measuredSnugHeight.value = null
    }
    log.legend.debug(`[Legend] scheduleMeasurement(reset=${resetState}${fullReset ? ',full' : ''}) from: ${source || 'unknown'}`)
    pendingMeasurementRAF = requestAnimationFrame(() => {
      pendingMeasurementRAF = requestAnimationFrame(() => {
        pendingMeasurementRAF = null
        measureAndTrimItems()
      })
    })
  }

  function scheduleContainerResizeMeasurement() {
    if (containerResizeRemeasureTimeout) clearTimeout(containerResizeRemeasureTimeout)
    containerResizeRemeasureTimeout = setTimeout(() => {
      scheduleMeasurement(true, 'containerResize', true)
    }, 150)
  }

  // ── Deterministic measurement ──────────────────────────────────────────

  function measureVisualGap(contentEl) {
    const moreEl = contentEl.querySelector('.legend-more')
    const itemsEl = contentEl.querySelector('.legend-items')
    if (!itemsEl) return 0

    const lastItem = itemsEl.lastElementChild
    if (!lastItem) return 0
    const itemsBottom = lastItem.getBoundingClientRect().bottom

    if (moreEl) {
      const moreTop = moreEl.getBoundingClientRect().top
      return moreTop - itemsBottom
    } else {
      const contentBottom = contentEl.getBoundingClientRect().top + contentEl.clientHeight
      return contentBottom - itemsBottom
    }
  }

  function scheduleFollowUpMeasurement(generation, source = 'followUp') {
    if (followUpScheduledForGeneration === generation) return
    followUpScheduledForGeneration = generation

    nextTick(() => {
      pendingFollowUpRAF = requestAnimationFrame(() => {
        pendingFollowUpRAF = null
        if (generation !== measurementGeneration) return
        measureAndTrimItems({ generation, allowFollowUp: false, source })
      })
    })
  }

  function logSettled(el, unusedSpace) {
    const totalItems = sortedAllItems.value.length
    const sizeMode = `${isAutoWidth.value ? 'auto' : 'manual'}/${isAutoHeight.value ? 'auto' : 'manual'}`
    log.legend.info(`[Legend] SETTLED ${measuredItemCount.value}/${totalItems} items | ${sizeMode} ${Math.round(effectiveWidth.value)}×${el.clientHeight} gap=${Math.round(unusedSpace)}px steps=${correctionSteps} | ${logContext()}`)
    log.legend.info(`[Perf] legendMeasurement: settled in ${correctionSteps} steps`)
    correctionSettled.value = true
    prevMeasuredCount.value = measuredItemCount.value
  }

  // ── Log context ───────────────────────────────────────────────────────

  function logContext() {
    const parts = []
    parts.push(`colorBy=${dataStore.colorBy}`)
    if (legendStore.isGrouped) {
      parts.push(`groupBy=${legendStore.effectiveGroupBy}`)
    }
    const f = dataStore.filters
    const activeFilters = []
    if (f.species?.length) activeFilters.push(`species=${f.species.length}`)
    if (f.subspecies?.length) activeFilters.push(`subsp=${f.subspecies.length}`)
    if (f.mimicry?.length) activeFilters.push(`mimicry=${f.mimicry.length}`)
    if (f.status?.length) activeFilters.push(`status=${f.status.length}`)
    if (f.source?.length > 1 || (f.source?.length === 1 && f.source[0] !== 'Sanger Institute')) {
      activeFilters.push(`source=${f.source.join(',')}`)
    }
    if (f.genus !== 'All') activeFilters.push(`genus=${f.genus}`)
    if (f.country !== 'All') activeFilters.push(`country=${f.country}`)
    if (activeFilters.length) parts.push(`filters=[${activeFilters.join(' ')}]`)
    return parts.join(' ')
  }

  // ── Main measurement ──────────────────────────────────────────────────

  function measureAndTrimItems({ generation = measurementGeneration, allowFollowUp = true, source = 'measure' } = {}) {
    const contentEl = contentRef.value
    if (!contentEl || isResizing.value) return

    // MapEngine is hidden with v-show while the table is open. ResizeObserver
    // callbacks can still leave a queued measurement behind; measuring while
    // the map/legend has zero layout height makes every item look like it
    // overflows, so the legend gets trimmed to a single item when returning
    // from Table → Map. Keep the last valid measurement until the map is
    // visible again instead of recording a collapsed hidden-state result.
    const bounds = containerBounds.value
    const isHiddenLayout =
      contentEl.clientHeight <= 0 ||
      contentEl.getClientRects().length === 0 ||
      !bounds.width ||
      !bounds.height
    if (isHiddenLayout) return

    const itemsEl = contentEl.querySelector('.legend-items')
    if (!itemsEl || !itemsEl.children.length) return

    correctionSteps++

    const contentRect = contentEl.getBoundingClientRect()
    const contentBottom = contentRect.top + contentEl.clientHeight
    const contentPaddingBottom = 12
    const moreIndicatorReserve = 40

    const isGroupedView = itemsEl.classList.contains('grouped')
    const allMeasurableItems = isGroupedView
      ? itemsEl.querySelectorAll('.legend-group-items > .legend-item')
      : itemsEl.children

    const measurableItems = [...allMeasurableItems].filter(el => !el.classList.contains('is-hidden'))

    const totalSorted = sortedAllItems.value.length
    const sizeMode = `${isAutoWidth.value ? 'auto' : 'manual'}/${isAutoHeight.value ? 'auto' : 'manual'}`

    if (!measurableItems.length) return

    // Debug: detect cross-group DOM mismatch (items in multiple groups)
    const groupEls = isGroupedView ? itemsEl.querySelectorAll('.legend-group') : []
    if (groupEls.length > 0 && measurableItems.length !== totalSorted) {
      log.legend.debug(`[Legend] DOM: ${measurableItems.length} items in ${groupEls.length} groups (${totalSorted} unique) grouped=${isGroupedView}`)
    }

    function computeSnugHeight(lastItemEl, includeMoreIndicator) {
      const legendEl = legendRef.value
      if (!legendEl || !lastItemEl) return null
      const legendTop = legendEl.getBoundingClientRect().top
      const lastBottom = lastItemEl.getBoundingClientRect().bottom
      // Safety buffer for rounding + border widths; avoids 1-pixel overflow
      // that shows the fallback scrollbar even when items should fit.
      const borderSafety = 4
      const extra = includeMoreIndicator
        ? moreIndicatorReserve + contentPaddingBottom + borderSafety
        : contentPaddingBottom + borderSafety
      return Math.max(LEGEND_LAYOUT.MIN_SNUG_HEIGHT, Math.ceil(lastBottom - legendTop + extra))
    }

    function applyMeasuredResult(count, snugHeight, reason) {
      const nextCount = Math.max(1, Math.min(totalSorted, count))
      const countChanged = measuredItemCount.value !== nextCount
      const sameAsLastMeasurement = lastMeasuredCount === nextCount

      lastMeasuredCount = nextCount

      if (countChanged) {
        measuredItemCount.value = nextCount
      }
      if (snugHeight !== null && snugHeight !== measuredSnugHeight.value) {
        measuredSnugHeight.value = snugHeight
      }

      const unusedSpace = measureVisualGap(contentEl)
      const domInfo = measurableItems.length > totalSorted ? ` dom=${Math.min(measurableItems.length, nextCount)}/${measurableItems.length}` : ''
      log.legend.debug(`[Legend] ${reason} ${nextCount}/${totalSorted} | ${sizeMode} ${Math.round(effectiveWidth.value)}×${contentEl.clientHeight}→snug${measuredSnugHeight.value || '?'}${domInfo} pass=${correctionSteps} source=${source} | ${logContext()}`)

      if (countChanged && allowFollowUp && !sameAsLastMeasurement) {
        correctionSettled.value = false
        scheduleFollowUpMeasurement(generation)
        return
      }

      logSettled(contentEl, unusedSpace)
    }

    // Source of truth for overflow: browser's own scroll vs visible height.
    // Using coordinate math with hardcoded padding can disagree by a pixel.
    const overflowsContainer = contentEl.scrollHeight > contentEl.clientHeight
    const lastItem = measurableItems[measurableItems.length - 1]

    if (measurableItems.length >= totalSorted && !overflowsContainer) {
      applyMeasuredResult(totalSorted, computeSnugHeight(lastItem, false), 'ALL_FIT')
      return
    }

    // Not all fit — find cutoff. First try without "+N more" reserve to see
    // if N+1 items fit (saves space vs showing "+1 more" which wastes ~40px).
    const maxBottomWithMore = contentBottom - contentPaddingBottom - moreIndicatorReserve
    const maxBottomWithoutMore = contentBottom - contentPaddingBottom
    let domFitCount = 0
    let domFitCountNoMore = 0  // items that fit if we skip "+N more"
    for (let i = 0; i < measurableItems.length; i++) {
      const itemBottom = measurableItems[i].getBoundingClientRect().bottom
      if (itemBottom <= maxBottomWithMore) domFitCount = i + 1
      if (itemBottom <= maxBottomWithoutMore) domFitCountNoMore = i + 1
    }
    domFitCount = Math.max(1, domFitCount)

    // DOM→unique: count distinct labels in fitting DOM items (not ratio)
    let count = domFitCount
    let countNoMore = domFitCountNoMore
    if (isGroupedView && measurableItems.length > totalSorted) {
      const uniqueFit = new Set()
      const uniqueFitNoMore = new Set()
      for (let i = 0; i < measurableItems.length; i++) {
        const label = measurableItems[i].querySelector('.legend-label')?.textContent?.trim()
        if (!label) continue
        if (i < domFitCount) uniqueFit.add(label)
        if (i < domFitCountNoMore) uniqueFitNoMore.add(label)
      }
      count = Math.max(1, uniqueFit.size)
      countNoMore = Math.max(1, uniqueFitNoMore.size)
    }

    // If skipping "+N more" would only leave 1-2 items hidden, AND those items
    // physically fit without the more indicator, use the higher count.
    // The "+N more" indicator itself takes ~40px which often fits 1-2 items.
    // Use translated counts (not raw DOM counts) so cross-group mode is handled.
    const hiddenWithoutMore = totalSorted - countNoMore
    if (hiddenWithoutMore <= 2 && countNoMore >= totalSorted) {
      applyMeasuredResult(totalSorted, computeSnugHeight(measurableItems[measurableItems.length - 1], false), 'TIGHT_FIT')
      return
    }

    applyMeasuredResult(count, computeSnugHeight(measurableItems[domFitCount - 1], true), 'OVERFLOW')
  }

  // ── Derived computeds ─────────────────────────────────────────────────

  const autoHeight = computed(() => {
    if (measuredItemCount.value === null) {
      return targetLegendHeight.value
    }
    if (!correctionSettled.value) return targetLegendHeight.value
    return measuredSnugHeight.value || targetLegendHeight.value
  })

  const effectiveWidth = computed(() => {
    return isAutoWidth.value ? autoWidth.value : (currentWidth.value || LEGEND_LAYOUT.MIN_WIDTH)
  })

  const effectiveHeight = computed(() => {
    return isAutoHeight.value ? autoHeight.value : currentHeight.value
  })

  const maxResizeWidth = computed(() => {
    return Math.min(Math.round(containerBounds.value.width * LEGEND_LAYOUT.MAX_RESIZE_WIDTH_RATIO), LEGEND_LAYOUT.MAX_WIDTH)
  })

  // ── Cleanup ───────────────────────────────────────────────────────────

  function cleanup() {
    if (pendingMeasurementRAF !== null) cancelAnimationFrame(pendingMeasurementRAF)
    if (pendingFollowUpRAF !== null) cancelAnimationFrame(pendingFollowUpRAF)
    if (containerResizeRemeasureTimeout) clearTimeout(containerResizeRemeasureTimeout)
    cleanupMeasureSpan()
  }

  function resetToAutoSize() {
    if (!isAutoWidth.value || !isAutoHeight.value) {
      log.legend.debug(`[Legend] resetToAutoSize (was ${currentWidth.value}x${currentHeight.value})`)
      currentWidth.value = null
      currentHeight.value = null
      legendStore.updateSize('auto', 'auto')
    }
  }

  return {
    // Refs
    measuredItemCount,
    measuredSnugHeight,
    prevMeasuredCount,

    // Computeds
    autoWidth,
    maxLegendHeight,
    targetLegendHeight,
    renderUpperBound,
    effectiveMaxItems,
    autoHeight,
    effectiveWidth,
    effectiveHeight,
    maxResizeWidth,

    // Functions
    scheduleMeasurement,
    scheduleContainerResizeMeasurement,
    resetToAutoSize,
    cleanup
  }
}
