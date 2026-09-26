import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { ASPECT_RATIOS } from '../utils/constants'

export function useExportPreview(containerSize) {
  const store = useDataStore()

  const exportHolePosition = computed(() => {
    if (!store.exportSettings.enabled) {
      return { x: 10, y: 10, width: 80, height: 80 }
    }

    const ratio = store.exportSettings.aspectRatio
    let targetWidth, targetHeight

    if (ratio === 'custom') {
      targetWidth = store.exportSettings.customWidth
      targetHeight = store.exportSettings.customHeight
    } else if (ASPECT_RATIOS[ratio]) {
      targetWidth = ASPECT_RATIOS[ratio].width
      targetHeight = ASPECT_RATIOS[ratio].height
    } else {
      return { x: 10, y: 10, width: 80, height: 80 }
    }

    const targetAspectRatio = targetWidth / targetHeight
    const containerW = containerSize.value.width || 1600
    const containerH = containerSize.value.height || 900
    const containerAspectRatio = containerW / containerH
    const maxPercent = 92

    let holeWidthPercent, holeHeightPercent

    if (targetAspectRatio > containerAspectRatio) {
      holeWidthPercent = maxPercent
      holeHeightPercent = (maxPercent / targetAspectRatio) * containerAspectRatio
    } else {
      holeHeightPercent = maxPercent
      holeWidthPercent = (maxPercent * targetAspectRatio) / containerAspectRatio
    }

    const x = (100 - holeWidthPercent) / 2
    const y = (100 - holeHeightPercent) / 2

    return {
      x: Math.max(2, x),
      y: Math.max(2, y),
      width: Math.min(96, holeWidthPercent),
      height: Math.min(96, holeHeightPercent)
    }
  })

  return {
    exportHolePosition
  }
}
