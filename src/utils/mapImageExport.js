import { withMapExport } from './mapExportQueue'
import { toPng } from 'html-to-image'
import { ASPECT_RATIOS } from './constants'
import { loadImage } from './canvasHelpers'

export function imageExportDimensions(settings) {
  const size = settings.aspectRatio === 'custom'
    ? { width: settings.customWidth, height: settings.customHeight }
    : ASPECT_RATIOS[settings.aspectRatio] || ASPECT_RATIOS['16:9']
  const width = Math.round(Number(size.width) * Number(settings.dpi) / 100)
  const height = Math.round(Number(size.height) * Number(settings.dpi) / 100)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 64_000_000) {
    throw new Error('Choose export dimensions between 1 and 16,384 pixels, with at most 64 million pixels in total.')
  }
  return { width, height }
}

// Keep the entire current view when export preview is off. Padding is preferable
// to stretching coordinates or silently cropping the user's selected extent.
export function containImage(sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight }
}

export function includeExportNode(node, settings) {
  const classes = node.classList
  if (!classes) return true
  if (classes.contains('maplibregl-ctrl-top-right') || classes.contains('export-info-badge') ||
      classes.contains('legend-toolbar') || classes.contains('resize-zone')) return false
  if (!settings.includeLegend && classes.contains('legend-container')) return false
  if (!settings.includeScaleBar && classes.contains('maplibregl-ctrl-scale')) return false
  if (!settings.includeAttribution && classes.contains('maplibregl-ctrl-attrib')) return false
  return true
}

export function waitForMapIdle(map, timeoutMs = 15000) {
  if (map.loaded()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      map.off('idle', onIdle)
      if (error) reject(error)
      else resolve()
    }
    const onIdle = () => finish()
    const timer = setTimeout(() => finish(new Error('The map is still loading. Wait for the map tiles to finish, then try exporting again.')), timeoutMs)
    map.on('idle', onIdle)
  })
}

const settleLayout = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

export function captureMapImage(map, settings, options) {
  return withMapExport(map, () => captureImage(map, settings, options))
}

async function captureImage(map, settings, { capture = toPng, settle = settleLayout } = {}) {
  const { width, height } = imageExportDimensions(settings)
  const container = map.getContainer()
  if (!container.clientWidth || !container.clientHeight) throw new Error('Open the map view before exporting an image.')
  await waitForMapIdle(map)
  const originalPixelRatio = map.getPixelRatio()
  const attribution = container.querySelector('.maplibregl-ctrl-attrib')
  const attributionWasOpen = attribution?.hasAttribute('open')
  const backgroundColor = getComputedStyle(container).getPropertyValue('--color-bg-primary').trim() || '#1a1a2e'
  let dataUrl
  try {
    // The Include Attribution option means readable credits in the figure,
    // including when the user keeps the interactive control collapsed.
    if (settings.includeAttribution) attribution?.setAttribute('open', '')
    await settle()
    const pixelRatio = Math.min(8, Math.max(width / container.clientWidth, height / container.clientHeight))
    map.setPixelRatio(pixelRatio)
    map.triggerRepaint()
    await waitForMapIdle(map)
    dataUrl = await capture(container, {
      pixelRatio, backgroundColor,
      // Hide the frame only on the clone, preserving the live map dimensions.
      style: { borderColor: 'transparent', boxShadow: 'none' },
      filter: node => includeExportNode(node, settings),
    })
  } finally {
    if (attribution && !attributionWasOpen) attribution.removeAttribute('open')
    map.setPixelRatio(originalPixelRatio)
    map.triggerRepaint()
  }
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create the export image. Try a smaller output size.')
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)
  const rect = containImage(image.width, image.height, width, height)
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  const format = settings.format === 'jpg' ? 'jpg' : 'png'
  const blob = await new Promise(resolve => canvas.toBlob(resolve, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95))
  if (!blob) throw new Error('The browser could not encode the image. Try a smaller output size.')
  return { blob, width, height, format }
}
