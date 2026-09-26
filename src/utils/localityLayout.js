const CELL = 48
const MAX_TEXT_WIDTH = 164
const TEXT_LINE_HEIGHT = 16
// Room for a visible leader and arrowhead between the text and its marker.
const LABEL_GAP = 16
// Fallback ring used when every near position is taken; longer leaders keep the link clear.
const FAR_GAP = 40
const CANDIDATES = Array.from({ length: 16 }, (_, index) => index)
const VIEWPORT_MARGIN = 8

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

/** Explicit line breaks keep our measured boxes close to MapLibre's text boxes. */
export function wrapLocalityLabel(label, measure) {
  const words = String(label).trim().split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (current && measure(next) > MAX_TEXT_WIDTH) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines.join('\n')
}

function cellsFor(rect) {
  const keys = []
  for (let x = Math.floor(rect.left / CELL); x <= Math.floor(rect.right / CELL); x++) {
    for (let y = Math.floor(rect.top / CELL); y <= Math.floor(rect.bottom / CELL); y++) keys.push(`${x}:${y}`)
  }
  return keys
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

class SpatialGrid {
  constructor() { this.cells = new Map() }
  add(rect) {
    for (const key of cellsFor(rect)) {
      if (!this.cells.has(key)) this.cells.set(key, [])
      this.cells.get(key).push(rect)
    }
  }
  intersects(rect) {
    const seen = new Set()
    for (const key of cellsFor(rect)) {
      for (const item of this.cells.get(key) || []) {
        if (seen.has(item)) continue
        seen.add(item)
        if (overlaps(item, rect)) return true
      }
    }
    return false
  }
}

function candidate(anchor, radius, width, height, index) {
  const x = anchor.x, y = anchor.y
  const gap = radius + (index < 8 ? LABEL_GAP : FAR_GAP)
  const centers = [
    [x, y - gap - height / 2], [x, y + gap + height / 2],
    [x - gap - width / 2, y], [x + gap + width / 2, y],
    [x - gap - width / 2, y - gap - height / 2],
    [x + gap + width / 2, y - gap - height / 2],
    [x - gap - width / 2, y + gap + height / 2],
    [x + gap + width / 2, y + gap + height / 2],
  ]
  const [cx, cy] = centers[index % 8]
  return { x: cx, y: cy, left: cx - width / 2, right: cx + width / 2,
    top: cy - height / 2, bottom: cy + height / 2 }
}

function leaderGeometry(rect, anchor, radius) {
  const start = { x: clamp(anchor.x, rect.left, rect.right), y: clamp(anchor.y, rect.top, rect.bottom) }
  const dx = anchor.x - start.x, dy = anchor.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return null
  const ux = dx / length, uy = dy / length
  const tip = { x: anchor.x - ux * radius, y: anchor.y - uy * radius }
  return { shaft: [start, tip], arrowhead: {
    point: tip, rotation: (Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360,
  } }
}

/** Greedy label layout: eight near positions, then eight farther ones. Only text and marker boxes block placement; leaders may cross. */
export function layoutLocalityLabels(items, { project, width, height, measure, markerObstacles = [], preferred = new Map() }) {
  const grid = new SpatialGrid()
  for (const obstacle of markerObstacles) {
    const { x, y, radius } = obstacle
    if (![x, y, radius].every(Number.isFinite)) continue
    grid.add({ left: x - radius, right: x + radius, top: y - radius, bottom: y + radius })
  }
  const projected = []
  for (const item of items) {
    const anchor = project(item.coordinates)
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue
    if (anchor.x < -80 || anchor.x > width + 80 || anchor.y < -80 || anchor.y > height + 80) continue
    const radius = Number.isFinite(item.radius) ? item.radius : 0
    // A labeled record is also a marker obstacle even if the renderer omits it from queries.
    grid.add({ left: anchor.x - radius, right: anchor.x + radius,
      top: anchor.y - radius, bottom: anchor.y + radius })
    projected.push({ item, anchor, radius })
  }
  projected.sort((a, b) => a.item.priority - b.item.priority || a.item.key.localeCompare(b.item.key))
  const placements = []
  const choices = new Map()
  for (const { item, anchor, radius } of projected) {
    const text = wrapLocalityLabel(item.label, measure)
    const lines = text.split('\n')
    const measured = Math.max(...lines.map(line => measure(line)))
    // Font metrics differ slightly from MapLibre glyphs; leave conservative slack.
    const labelWidth = measured * 1.15 + 14
    const labelHeight = lines.length * TEXT_LINE_HEIGHT + 10
    const previous = preferred.get(item.key)
    const indices = previous == null ? CANDIDATES
      : [previous, ...CANDIDATES.filter(index => index !== previous)]
    for (const index of indices) {
      const rect = candidate(anchor, radius, labelWidth, labelHeight, index)
      if (rect.left < VIEWPORT_MARGIN || rect.top < VIEWPORT_MARGIN ||
        rect.right > width - VIEWPORT_MARGIN || rect.bottom > height - VIEWPORT_MARGIN ||
        grid.intersects(rect)) continue
      grid.add(rect)
      choices.set(item.key, index)
      const inkWidth = measured + 4
      const inkHeight = lines.length * 14 + 4
      const inkRect = { left: rect.x - inkWidth / 2, right: rect.x + inkWidth / 2,
        top: rect.y - inkHeight / 2, bottom: rect.y + inkHeight / 2 }
      placements.push({ item, text, center: { x: rect.x, y: rect.y }, rect,
        anchor, leader: leaderGeometry(inkRect, anchor, item.leaderRadius ?? radius), candidate: index })
      break
    }
  }
  return { placements, choices }
}
