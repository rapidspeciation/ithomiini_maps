import { DYNAMIC_COLORS } from '../constants'
import { generateHexBins, generateRangePolygons } from '../rangePolygons'

const GROUP_ATTRIBUTES = {
  species: 'scientific_name', subspecies: 'subspecies',
  genus: 'genus', mimicry: 'mimicry_ring'
}

/** MapLibre's project() includes its current center, zoom, bearing and pitch. */
export function screenGeometry(geometry, project) {
  if (geometry.type === 'Point') {
    const { x, y } = project(geometry.coordinates)
    return { type: 'Point', coordinates: [x, y] }
  }
  const projectRing = ring => ring.map(coordinates => {
    const { x, y } = project(coordinates)
    return [x, y]
  })
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(projectRing) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(polygon => polygon.map(projectRing)) }
  }
  throw new Error(`Unsupported export geometry: ${geometry.type}`)
}

/** Record-level points (range mode) in their legend colour, grey when uncoloured. */
export function resolvePointFeatures(features, { attribute, palette, hiddenItems, project }) {
  const hidden = new Set(hiddenItems)
  return features.filter(feature => !hidden.has(feature.properties[attribute])).map(feature => {
    const category = feature.properties[attribute]
    const { x, y } = project(feature.geometry.coordinates)
    return {
      ...feature,
      properties: {
        ...feature.properties,
        display_color: palette[category] || '#6b7280',
        display_sort_key: 1,
        screen_x: x,
        screen_y: y
      }
    }
  })
}

/**
 * One marker per site, as drawn in the browser: a colour (single group or
 * individuals ramp) or pie segments, and a size factor from individuals.
 * Large sites come first so small ones are painted on top.
 */
export function resolveSiteFeatures(sites, { project, shapeFor = () => 'circle', strokeFor = () => null }) {
  return sites.map(site => {
    const { x, y } = project(site.coordinates)
    const species = [...new Set(site.records.map(record => record.properties.scientific_name).filter(Boolean))].sort()
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: site.coordinates },
      properties: {
        collection_location: site.locality,
        country: site.country,
        individuals: site.individuals,
        record_count: site.recordCount,
        species_count: site.speciesCount,
        species: species.join('; '),
        display_color: site.fill,
        display_segments: site.segments.length > 1
          ? site.segments.map(({ label, color, fraction }) => ({ label, color, fraction }))
          : null,
        display_label: site.segments.length === 1 ? site.segments[0].label : null,
        display_size_factor: site.sizeFactor,
        display_shape: site.segments.length > 1 ? 'circle' : shapeFor(site),
        display_stroke_color: strokeFor(site),
        display_sort_key: -site.individuals,
        screen_x: x,
        screen_y: y
      }
    }
  }).sort((a, b) => a.properties.display_sort_key - b.properties.display_sort_key)
}

export function resolveRangeFeatures(geojson, settings, _palette, project) {
  let source
  if (settings.method === 'hexbin') {
    source = generateHexBins(geojson, settings)
  } else if (settings.method === 'hulls') {
    const attribute = GROUP_ATTRIBUTES[settings.groupBy] || 'scientific_name'
    const names = [...new Set(geojson.features.map(f => f.properties[attribute])
      .filter(value => value && value !== 'Unknown' && value !== 'NA'))].sort()
    const colors = Object.fromEntries(names.map((name, index) => [name, DYNAMIC_COLORS[index % DYNAMIC_COLORS.length]]))
    source = generateRangePolygons(geojson, settings, colors)
    // The hull geometry cache is independent of palette; resolve its color here.
    source = { ...source, features: source.features.map(feature => ({
      ...feature,
      properties: { ...feature.properties, color: colors[feature.properties.group_name] || '#6b7280' }
    })) }
  } else {
    throw new Error(`Unsupported range method: ${settings.method}`)
  }
  return {
    type: 'FeatureCollection',
    features: source.features.map(feature => ({
      ...feature,
      properties: { ...feature.properties },
      screen_geometry: screenGeometry(feature.geometry, project)
    }))
  }
}

const visible = element => {
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
}

export function snapshotLegend(container) {
  const element = document.querySelector('.legend-container')
  if (!element || !visible(element)) return { visible: false, rows: [] }
  const mapRect = container.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  const renderedScale = element.offsetWidth ? rect.width / element.offsetWidth : 1
  const relative = el => {
    const r = el.getBoundingClientRect()
    return { x: r.x - mapRect.x, y: r.y - mapRect.y, width: r.width, height: r.height }
  }
  const textLines = el => {
    const node = [...el.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())
    if (!node) return [{ text: el.textContent.trim(), box: relative(el) }]
    const lines = new Map()
    const words = [...node.textContent.matchAll(/\S+/g)]
    for (const word of words) {
      const range = document.createRange()
      range.setStart(node, word.index)
      range.setEnd(node, word.index + word[0].length)
      const r = range.getBoundingClientRect()
      const yKey = Math.round(r.y)
      if (!lines.has(yKey)) lines.set(yKey, { text: '', box: { x: r.x - mapRect.x, y: r.y - mapRect.y, width: 0, height: r.height } })
      const line = lines.get(yKey)
      line.text += (line.text ? ' ' : '') + word[0]
      line.box.width = Math.max(line.box.width, r.right - mapRect.x - line.box.x)
    }
    return lines.size ? [...lines.values()] : [{ text: el.textContent.trim(), box: relative(el) }]
  }
  const rows = []
  const selectors = '.legend-title, .legend-group-header, .legend-item, .legend-more, .individuals-ramp, .individuals-scale > span'
  element.querySelectorAll(selectors).forEach(el => {
    if (!visible(el)) return
    if (el.classList.contains('individuals-ramp')) {
      rows.push({ type: 'ramp', box: relative(el), colors: (el.dataset.colors || '').split(',').filter(Boolean), lines: [] })
      return
    }
    let type = 'item'
    let textEl = el.querySelector('.legend-label') || el
    if (el.classList.contains('legend-title')) {
      type = 'title'
      textEl = el.querySelector('span') || el
    } else if (el.classList.contains('legend-group-header')) {
      type = 'header'
      textEl = el.querySelector('.species-name') || el
    } else if (el.classList.contains('legend-more')) {
      type = 'more'
    }
    const rawLabel = textEl.textContent.trim()
    const style = window.getComputedStyle(textEl)
    const transform = value => style.textTransform === 'uppercase' ? value.toUpperCase() : value
    const shape = el.querySelector('.legend-shape')
    const shapeMark = shape?.querySelector('circle, rect, polygon')
    const count = el.querySelector('.legend-count')
    const countStyle = count ? window.getComputedStyle(count) : null
    const rowStyle = window.getComputedStyle(el)
    rows.push({
      type, label: transform(rawLabel), count: count?.textContent?.trim() || null,
      box: relative(el), textBox: relative(textEl),
      lines: textLines(textEl).map(line => ({ ...line, text: transform(line.text) })),
      color: style.color, fontSize: parseFloat(style.fontSize) * renderedScale,
      fontWeight: style.fontWeight, fontStyle: style.fontStyle,
      dividerColor: type === 'title' ? rowStyle.borderBottomColor : null,
      dividerWidth: type === 'title' ? parseFloat(rowStyle.borderBottomWidth) * renderedScale : 0,
      countBox: count ? relative(count) : null,
      countColor: countStyle?.color || null,
      countFontSize: countStyle ? parseFloat(countStyle.fontSize) * renderedScale : null,
      shapeBox: shape ? relative(shape) : null,
      shapeType: shapeMark?.tagName?.toLowerCase() === 'rect' ? 'square'
        : shapeMark?.tagName?.toLowerCase() === 'polygon'
          ? shapeMark.getAttribute('points')?.startsWith('16,4 29') ? 'triangle' : 'rhombus'
          : 'circle',
      shapeColor: shapeMark?.getAttribute('fill') || null,
      shapeStroke: shapeMark?.getAttribute('stroke') || null
    })
  })
  const style = window.getComputedStyle(element)
  return {
    visible: true,
    box: { x: rect.x - mapRect.x, y: rect.y - mapRect.y, width: rect.width, height: rect.height },
    background: style.backgroundColor,
    border: style.borderColor,
    rows
  }
}

export function snapshotControls(container) {
  const map = container.getBoundingClientRect()
  const snapshot = selector => {
    const el = container.querySelector(selector)
    if (!el || !visible(el)) return null
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return {
      text: el.textContent.trim(),
      box: { x: rect.x - map.x, y: rect.y - map.y, width: rect.width, height: rect.height },
      color: style.color,
      background: style.backgroundColor,
      borderColor: style.borderBottomColor,
      fontSize: parseFloat(style.fontSize)
    }
  }
  return { scale: snapshot('.maplibregl-ctrl-scale'), attribution: snapshot('.maplibregl-ctrl-attrib') }
}
