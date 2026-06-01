import { reactive } from 'vue'

/**
 * Lightweight drag-to-resize for table columns.
 *
 * Widths are stored per namespace (one per table/view) keyed by column key, so
 * each table keeps its own column sizes. Call `startResize` from a resize
 * handle's mousedown, and use `getWidth` to read the current override (falling
 * back to the column's default width when the user hasn't resized it).
 */
export function useColumnResize() {
  // widths[namespace][columnKey] = number (px)
  const widths = reactive({})

  function getWidth(ns, key, fallback) {
    const w = widths[ns]?.[key]
    return w != null ? `${w}px` : fallback
  }

  let active = null

  function onMove(e) {
    if (!active) return
    const dx = e.clientX - active.startX
    const next = Math.max(48, Math.round(active.startW + dx))
    if (!widths[active.ns]) widths[active.ns] = {}
    widths[active.ns][active.key] = next
  }

  function stop() {
    active = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', stop)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function startResize(e, ns, key) {
    const th = e.target.closest('th')
    const startW = th ? th.getBoundingClientRect().width : 100
    active = { ns, key, startX: e.clientX, startW }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return { widths, getWidth, startResize }
}
