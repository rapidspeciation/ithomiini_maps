import { test, expect } from '@playwright/test'

test('draws one marker per site as pie or shape icons', async ({ page }) => {
  // A local style keeps this regression independent of external basemap tiles.
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e0e8ed' } },
    ] }),
  }))
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await page.waitForFunction(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const map = app?._instance.setupState.mapRef
    const data = app?.config.globalProperties.$pinia._s.get('data')
    return map?.style && map.getSource('points-source') && data?.allFeatures.length > 0
  })
  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    window.shapeMap = app._instance.setupState.mapRef
    window.shapeStores = Object.fromEntries(app.config.globalProperties.$pinia._s)
  })

  // Unfiltered: too many t  // Unfiltered: the ten most abundant species are coloured, the rest grey.
  await page.waitForFunction(() => window.shapeMap.getLayer('points-layer')?.type === 'symbol' && window.shapeMap.loaded())
  const sites = await page.evaluate(() => {
    const records = shapeStores.data.displayGeoJSON.features
    const keys = new Set(records.map(({ geometry: { coordinates: [lng, lat] } }) => `${lat.toFixed(4)},${lng.toFixed(4)}`))
    return { records: records.length, keys: keys.size, data: shapeMap.getSource('points-source').serialize().data,
      colored: shapeStores.data.colorPlan.colored.length }
  })
  expect(sites.keys).toBeLessThan(sites.records)
  expect(sites.data.features).toHaveLength(sites.keys)
  expect(sites.data.features[0].properties).toHaveProperty('individuals')
  expect(sites.data.features[0].properties.marker_icon).toBeTruthy()
  expect(sites.colored).toBe(10)

  // Two species with shapes: triangles for single-species sites, pies for mixed ones.
  await page.evaluate(() => {
    shapeStores.data.filters.species = ['Mechanitis polymnia', 'Ithomia salapia']
    shapeStores.data.setColorBy('species')
    shapeStores.legend.shapeSettings.enabled = true
    shapeStores.legend.setGroupShape('Mechanitis polymnia', 'triangle')
    shapeStores.legend.setCustomColor('Mechanitis polymnia', '#cc00ff')
  })
  await page.waitForFunction(() => shapeMap.getSource('points-source').serialize().data.features
    .some(f => f.properties.marker_icon?.startsWith('shape-triangle')) && window.shapeMap.loaded())
  const icons = await page.evaluate(() => shapeMap.getSource('points-source').serialize().data.features.map(f => f.properties.marker_icon))
  expect(icons.some(icon => icon.startsWith('site-pie:'))).toBe(true)

  // Back to all taxa in preview export mode.
  await page.evaluate(() => {
    shapeStores.legend.shapeSettings.enabled = false
    shapeStores.legend.setGroupShape('Mechanitis polymnia', 'circle')
    shapeStores.legend.setCustomColor('Mechanitis polymnia', null)
    shapeStores.data.filters.species = []
    shapeStores.data.exportSettings.uiScale = 1.5
    shapeStores.data.exportSettings.enabled = true
  })
  await page.waitForFunction(() => !shapeMap.getSource('points-source').serialize().data.features
    .some(f => f.properties.marker_icon?.startsWith('shape-triangle')) && window.shapeMap.loaded())
  expect(await page.evaluate(() => shapeMap.getLayer('points-layer').type)).toBe('symbol')
  expect(errors).toEqual([])
})
