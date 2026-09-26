/** Compact, validated camera state for sharing the area being discussed. */
export function parseSharedMapView(value) {
  if (!value) return null
  const values = value.split(',').map(Number)
  if (values.length !== 3 || !values.every(Number.isFinite)) return null
  const [lng, lat, zoom] = values
  if (lng < -180 || lng > 180 || lat < -85 || lat > 85 || zoom < 2 || zoom > 18) return null
  return { center: [lng, lat], zoom }
}
