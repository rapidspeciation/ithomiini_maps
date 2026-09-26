// Shape utilities for MapLibre GL marker visualization.
//
// APPROACH: We generate colored shape images with borders baked in (non-SDF),
// rather than using SDF icons with icon-halo. This is because icon-halo has
// known bugs in MapLibre where borders don't scale properly with zoom.
// See: https://github.com/maplibre/maplibre-native/issues/2175

// Shape options for UI selection
export const SHAPE_OPTIONS = [
  { value: 'circle', label: 'Circle', icon: '●' },
  { value: 'square', label: 'Square', icon: '■' },
  { value: 'triangle', label: 'Triangle', icon: '▲' },
  { value: 'rhombus', label: 'Diamond', icon: '◆' }
]

// Draw a shape on a canvas context with fill and stroke baked in.
function drawShape(ctx, shapeName, size, fillColor, strokeColor, strokeWidth, fillOpacity, strokeOpacity) {
  const center = size / 2
  const padding = strokeWidth + 2
  const innerSize = size - padding * 2

  ctx.fillStyle = fillColor
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()

  switch (shapeName) {
    case 'circle': {
      const radius = innerSize / 2
      ctx.arc(center, center, radius, 0, Math.PI * 2)
      break
    }
    case 'square': {
      const halfSize = innerSize / 2
      ctx.rect(center - halfSize, center - halfSize, innerSize, innerSize)
      break
    }
    case 'triangle': {
      const h = innerSize * 0.866 // height = side * sqrt(3)/2
      const top = center - h / 2
      const bottom = center + h / 2
      const halfBase = innerSize / 2
      ctx.moveTo(center, top)
      ctx.lineTo(center + halfBase, bottom)
      ctx.lineTo(center - halfBase, bottom)
      ctx.closePath()
      break
    }
    case 'rhombus': {
      const half = innerSize / 2
      ctx.moveTo(center, center - half)
      ctx.lineTo(center + half, center)
      ctx.lineTo(center, center + half)
      ctx.lineTo(center - half, center)
      ctx.closePath()
      break
    }
    default:
      ctx.arc(center, center, innerSize / 2, 0, Math.PI * 2)
  }

  ctx.globalAlpha = fillOpacity
  ctx.fill()
  if (strokeWidth > 0) {
    ctx.globalAlpha = strokeOpacity
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// Generate a colored shape image with border baked in.
// Returns data in the format MapLibre's addImage() expects.
export function generateColoredShapeImage(shapeName, fillColor, strokeColor, strokeWidth = 3, size = 64, fillOpacity = 1, strokeOpacity = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const scaledStrokeWidth = (strokeWidth / 32) * size

  drawShape(ctx, shapeName, size, fillColor, strokeColor, scaledStrokeWidth, fillOpacity, strokeOpacity)

  const imageData = ctx.getImageData(0, 0, size, size)
  return {
    width: size,
    height: size,
    data: new Uint8Array(imageData.data.buffer)
  }
}

// Generate a unique image name for a colored shape (used as MapLibre image key).
export function getColoredShapeImageName(shapeName, fillColor, strokeColor, strokeWidth = 3, fillOpacity = 1, strokeOpacity = 1) {
  const fill = fillColor.replace('#', '').toLowerCase()
  const stroke = strokeColor.replace('#', '').toLowerCase()
  const sw = Math.round(strokeWidth * 10) / 10
  return `shape-${shapeName}-${fill}-${stroke}-w${sw}-a${fillOpacity}-${strokeOpacity}`
}

// Build a MapLibre match expression for icon-image based on colored shape images.
export function buildColoredShapeExpression(colorToImageMap, colorAttributeName, defaultImageName) {
  if (colorToImageMap.size === 0) {
    return defaultImageName
  }

  const expression = ['match', ['get', colorAttributeName]]

  for (const [color, imageName] of colorToImageMap) {
    expression.push(color, imageName)
  }

  expression.push(defaultImageName)

  return expression
}
