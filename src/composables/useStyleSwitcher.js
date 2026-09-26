import { ref } from 'vue'
import { MAP_STYLES } from '../utils/mapStyles'

export function useStyleSwitcher(map, addDataLayer, callbacks = {}) {
  const currentStyle = ref('dark')
  const { recreateClusterExtentCircle, setStyleChanging, onStyleStart, onStyleReady, onStyleIdle } = callbacks

  // Generation counter prevents stale style.load callbacks from running
  // when the user switches styles rapidly (e.g. streets → terrain before
  // the streets style.load fires).
  let switchGeneration = 0

  const whenStyleReady = (gen, callback, startedAt = Date.now()) => {
    if (!map.value || gen !== switchGeneration) return
    try {
      if (map.value.isStyleLoaded?.()) {
        callback()
        return
      }
    } catch {
      // Keep waiting; MapLibre can briefly reject readiness checks while
      // swapping style objects.
    }

    if (Date.now() - startedAt > 5000) {
      callback()
      return
    }
    setTimeout(() => whenStyleReady(gen, callback, startedAt), 50)
  }

  const switchStyle = async (styleName) => {
    if (!map.value || !MAP_STYLES[styleName]) return

    if (setStyleChanging) {
      setStyleChanging(true)
    }

    const center = map.value.getCenter()
    const zoom = map.value.getZoom()
    const bearing = map.value.getBearing()
    const pitch = map.value.getPitch()

    currentStyle.value = styleName
    const styleConfig = MAP_STYLES[styleName]
    const gen = ++switchGeneration

    onStyleStart?.()
    map.value.setStyle(styleConfig.style)

    let handled = false
    const rebuildOverlays = () => {
      // Guard: skip if already handled or a newer switch has occurred
      if (handled || gen !== switchGeneration || !map.value) return
      handled = true

      map.value.jumpTo({ center, zoom, bearing, pitch })
      addDataLayer({ skipZoom: true })

      // Notify caller that style is ready (e.g., for re-adding boundaries)
      if (onStyleReady) {
        onStyleReady()
      }

      map.value.once('idle', () => {
        if (gen !== switchGeneration || !map.value) return
        onStyleIdle?.()
        if (recreateClusterExtentCircle) {
          recreateClusterExtentCircle()
        }

        setTimeout(() => {
          if (gen === switchGeneration && map.value && setStyleChanging) {
            setStyleChanging(false)
          }
        }, 100)
      })
    }

    const handleStyleReady = () => whenStyleReady(gen, rebuildOverlays)

    map.value.once('style.load', handleStyleReady)
    map.value.once('styledata', handleStyleReady)

    // Fallback: for inline raster styles (streets, satellite, terrain),
    // style.load may not fire promptly because the style object is parsed
    // synchronously. The timeout ensures we still initialize the map layers.
    setTimeout(handleStyleReady, 100)
  }

  return {
    currentStyle,
    switchStyle
  }
}
