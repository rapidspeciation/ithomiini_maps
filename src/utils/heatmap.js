// Busiest location's total weight. MapLibre's kernel peaks near 0.4 per unit
// weight, so this puts the busiest site at the top of the colour ramp.
const PEAK_WEIGHT = 2.5

/**
 * Attach a `heat_weight` so each location contributes log-compressed record
 * counts. A single record stays visible, and a site with hundreds of stacked
 * records no longer saturates the whole map. The scale is relative to the
 * filtered records, not an abundance estimate.
 */
export function withHeatmapWeights(collection) {
  const features = collection.features
  const counts = new Map()
  let maximum = 1
  const keys = features.map(feature => {
    const [lng, lat] = feature.geometry.coordinates
    const key = `${lng.toFixed(4)},${lat.toFixed(4)}`
    const count = (counts.get(key) || 0) + 1
    counts.set(key, count)
    maximum = Math.max(maximum, count)
    return key
  })
  const scale = PEAK_WEIGHT / Math.log1p(maximum)
  return {
    ...collection,
    features: features.map((feature, index) => {
      const count = counts.get(keys[index])
      // Split the location's weight across its records so the sum is log-scaled.
      const weight = scale * Math.log1p(count) / count
      return { ...feature, properties: { ...feature.properties, heat_weight: weight } }
    }),
  }
}
