import { test, expect } from '@playwright/test'

test('draws one marker per site and rebuilds the source when colour modes switch', async ({ page }) => {
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

  // Unfiltered: too many taxa to colour, so native circles coloured by individuals.
  await page.waitForFunction(() => window.shapeMap.getLayer('points-layer')?.type === 'circle' && window.shapeMap.loaded())
  const sites = await page.evaluate(() => {
    const records = shapeStores.data.displayGeoJSON.features
    const keys = new Set(records.map(({ geometry: { coordinates: [lng, lat] } }) => `${lat.toFixed(4)},${lng.toFixed(4)}`))
    return { records: records.length, keys: keys.size, data: shapeMap.getSource('points-source').serialize().data }
  })
  expect(sites.keys).toBeLessThan(sites.records)
  expect(sites.data.features).toHaveLength(sites.keys)
  expect(sites.data.features[0].properties).toHaveProperty('individuals')

  // Two species: categories, drawn as pie or shape icons in a rebuilt source.
  await page.evaluate(() => {
    window.circleSource = shapeMap.getSource('points-source')
    shapeStores.data.filters.species = ['Mechanitis polymnia', 'Ithomia salapia']
    shapeStores.data.colorBy = 'species'
    shapeStores.legend.shapeSettings.enabled = true
    shapeStores.legend.setGroupShape('Mechanitis polymnia', 'triangle')
    shapeStores.legend.setCustomColor('Mechanitis polymnia', '#cc00ff')
  })
  await page.waitForFunction(() => window.shapeMap.getLayer('points-layer')?.type === 'symbol' && window.shapeMap.loaded())
  expect(await page.evaluate(() => shapeMap.getSource('points-source') !== circleSource)).toBe(true)
  const icons = await page.evaluate(() => shapeMap.getSource('points-source').serialize().data.features.map(f => f.properties.marker_icon))
  expect(icons.some(icon => icon.startsWith('shape-triangle'))).toBe(true)
  expect(icons.some(icon => icon.startsWith('site-pie:'))).toBe(true)

  // Back to all taxa: individuals circles again, in preview export mode.
  await page.evaluate(() => {
    window.symbolSource = shapeMap.getSource('points-source')
    shapeStores.legend.shapeSettings.enabled = false
    shapeStores.legend.setGroupShape('Mechanitis polymnia', 'circle')
    shapeStores.legend.setCustomColor('Mechanitis polymnia', null)
    shapeStores.data.filters.species = []
    shapeStores.data.exportSettings.uiScale = 1.5
    shapeStores.data.exportSettings.enabled = true
  })
  await page.waitForFunction(() => window.shapeMap.getLayer('points-layer')?.type === 'circle' && window.shapeMap.loaded())
  expect(await page.evaluate(() => shapeMap.getSource('points-source') !== symbolSource)).toBe(true)
  expect(errors).toEqual([])
})
