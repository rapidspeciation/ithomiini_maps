// Keeps keyboard focus inside a full-screen layer (the photo gallery): Tab and Shift+Tab wrap around its own
// controls instead of walking to the page hidden behind it.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The controls a Tab press can reach inside `container`, in document order (hidden ones left out). */
export function focusableIn(container) {
  if (!container) return []
  return [...container.querySelectorAll(FOCUSABLE)].filter(el => {
    if (el.closest('[inert], [aria-hidden="true"]')) return false
    const style = el.ownerDocument.defaultView.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && !el.hidden
  })
}

/**
 * Call from a keydown handler. On Tab, moves focus to the next control inside `container`, wrapping at either
 * end, and returns true when it handled the key. Focus that is outside the container is brought back in.
 */
export function trapTabKey(event, container) {
  if (event.key !== 'Tab' || !container) return false
  const items = focusableIn(container)
  if (!items.length) { event.preventDefault(); container.focus?.(); return true }
  const active = container.ownerDocument.activeElement
  const index = items.indexOf(active)
  // Focus on something inside that the list does not know (a scroll box the browser made focusable): let the
  // browser move on; if that leaves the layer, the next Tab brings focus back.
  if (index < 0 && active !== container && container.contains(active)) return false
  let next
  if (index < 0) next = event.shiftKey ? items[items.length - 1] : items[0]
  else if (event.shiftKey) next = index === 0 ? items[items.length - 1] : null
  else next = index === items.length - 1 ? items[0] : null
  if (!next) return false // the browser moves to the neighbour inside the container
  event.preventDefault()
  next.focus()
  return true
}
