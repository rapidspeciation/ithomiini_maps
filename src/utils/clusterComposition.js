/**
 * Combine the colour segments of a cluster's sites. Each record contributes
 * once, so ring proportions match the legend's record counts.
 */
export function combineSiteSegments(sites) {
  const counts = new Map()
  let total = 0
  for (const site of sites) {
    for (const segment of site?.segments || []) {
      counts.set(segment.color, (counts.get(segment.color) || 0) + segment.count)
      total += segment.count
    }
  }
  return {
    total,
    segments: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([color, count]) => ({ color, count, fraction: count / total })),
  }
}

/** Cluster marker radius from the individuals it contains. */
export function clusterCircleRadius(count) {
  if (count >= 500) return 32
  if (count >= 100) return 25
  if (count >= 50) return 20
  if (count >= 20) return 16
  return 12
}

/** Draw a sharp, proportional ring with a transparent center. */
export function drawCompositionRing(segments, count) {
  const pixelRatio = 2
  const radius = clusterCircleRadius(count) - 1
  const width = 5
  const size = Math.ceil((radius + width / 2 + 2) * 2 * pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  context.lineWidth = width * pixelRatio
  context.lineCap = 'butt'
  let angle = -Math.PI / 2
  for (const segment of segments) {
    const next = angle + Math.PI * 2 * segment.fraction
    context.beginPath()
    context.arc(center, center, radius * pixelRatio, angle, next)
    context.strokeStyle = segment.color
    context.stroke()
    angle = next
  }
  return context.getImageData(0, 0, size, size)
}
