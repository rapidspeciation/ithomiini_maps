import { recordedCoordinates, siteKeyForFeature } from './collectionSites'

export const LEADER_IMAGE_PREFIX = 'collection-locality-leader'

/** Label ink follows the basemap: light text on dark or photographic maps, dark text on light maps. */
export const LOCALITY_PALETTES = {
  light: { text: '#1d2b28', halo: 'rgba(255, 255, 255, 0.92)', ink: [29, 43, 40], outline: [255, 255, 255] },
  dark: { text: '#eef2f0', halo: 'rgba(16, 18, 28, 0.9)', ink: [238, 242, 240], outline: [16, 18, 28] },
}

function inTriangle(x, y, top, left, right) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const point = [x, y]
  const a = cross(top, left, point), b = cross(left, right, point), c = cross(right, top, point)
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)
}

/** Quantized image dimensions keep the sprite atlas small across camera stops. */
export function leaderImageSpec(length, radius, emphasized = false, theme = 'light') {
  const height = Math.max(12, Math.min(160, Math.round(length / 2) * 2))
  const tip = Math.max(0, Math.min(height - 7, Math.round(radius)))
  return { id: `${LEADER_IMAGE_PREFIX}-${theme}-${height}-${tip}-${emphasized ? 1 : 0}`,
    length: height, radius: tip, emphasized, theme }
}

/** A thin leader and small filled triangle, anchored at the original map point. */
export function drawLocalityLeader({ length, radius, emphasized = false, theme = 'light' }) {
  const { ink: inkColor, outline } = LOCALITY_PALETTES[theme] || LOCALITY_PALETTES.light
  const width = 16, height = (length + 2) * 2, pixelRatio = 2
  const data = new Uint8Array(width * height * 4)
  const tip = radius * pixelRatio
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5, py = y + 0.5
      const outer = inTriangle(px, py, [8, tip], [2, tip + 12], [14, tip + 12])
      const inner = inTriangle(px, py, [8, tip + 1], [3, tip + 11], [13, tip + 11])
      const shaft = py >= tip + 10 && py <= length * pixelRatio && Math.abs(px - 8) <= 2.25
      if (!outer && !shaft) continue
      const ink = inner || (shaft && Math.abs(px - 8) <= (emphasized ? 1.25 : 0.8))
      const index = (y * width + x) * 4
      const [r, g, b] = ink ? inkColor : outline
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = 255
    }
  }
  return { width, height, data, pixelRatio }
}

/** Keep map labels at genuine observation points while retaining the stable site ID. */
export function groupLocalityAnchors(features) {
  const anchors = new Map()
  for (const feature of features || []) {
    const coordinates = recordedCoordinates(feature)
    if (!coordinates) continue
    const siteId = siteKeyForFeature(feature)
    const record = feature.properties ?? feature
    const name = typeof record.collection_location === 'string'
      ? record.collection_location.trim().replace(/\s+/g, ' ')
      : ''
    const label = name && !/^(unknown|n\/a|na|null|none|-)$/i.test(name)
      ? name : `Unnamed area near ${coordinates[1].toFixed(2)}, ${coordinates[0].toFixed(2)}`
    const key = `${siteId}\0${coordinates[0]}\0${coordinates[1]}`
    const existing = anchors.get(key)
    if (existing) existing.recordCount++
    else anchors.set(key, { siteId, anchorKey: JSON.stringify([siteId, ...coordinates]), label, coordinates, recordCount: 1 })
  }
  return [...anchors.values()]
}
