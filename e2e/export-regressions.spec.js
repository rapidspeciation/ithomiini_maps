import { test, expect } from '@playwright/test'

// These composition regressions do not require a remote tile server. The app
// still uses a real MapLibre map and the committed occurrence data.
test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 8, sources: { credits: { type: 'geojson', attribution: 'Test map attribution', data: { type: 'FeatureCollection', features: [] } } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e0e8ed' } }, { id: 'credits', source: 'credits', type: 'fill' }] }),
  }))
  await page.goto('./')
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?._instance?.setupState.mapRef)
  await page.waitForFunction(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('data')
    return store && !store.loading && store.allFeatures.length > 0
  })
  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    window.testApp = app._instance.setupState
    window.testStores = Object.fromEntries(app.config.globalProperties.$pinia._s)
    window.testStores.data.filters.species = ['Mechanitis polymnia']
  })
  // The application debounces layer updates by 50 ms and then animates fitBounds.
  await page.waitForTimeout(100)
  await page.waitForFunction(() => window.testApp.mapRef.loaded() && !window.testApp.mapRef.isMoving())
})

test('repeated image exports retain requested size and restore rendering state', async ({ page }) => {
  await page.evaluate(() => Object.assign(window.testStores.data.exportSettings, {
    enabled: false, aspectRatio: 'custom', customWidth: 800, customHeight: 600,
    dpi: 100, includeLegend: false, includeAttribution: true,
  }))
  for (let i = 0; i < 2; i++) {
    await page.evaluate(enabled => { window.testStores.data.exportSettings.enabled = enabled }, i === 1)
    await page.waitForTimeout(100)
    await page.waitForFunction(() => window.testApp.mapRef.loaded() && !window.testApp.mapRef.isMoving())
    const before = await page.evaluate(() => ({
      ratio: window.testApp.mapRef.getPixelRatio(),
      open: document.querySelector('.maplibregl-ctrl-attrib').hasAttribute('open'),
      bounds: window.testApp.mapRef.getBounds().toArray(),
    }))
    const download = page.waitForEvent('download')
    await page.evaluate(() => window.testApp.directExportMap())
    const result = await download
    expect(result.suggestedFilename()).toContain('800x600')
    const stream = await result.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const png = Buffer.concat(chunks)
    expect(png.readUInt32BE(16)).toBe(800)
    expect(png.readUInt32BE(20)).toBe(600)
    expect(await page.evaluate(() => ({
      ratio: window.testApp.mapRef.getPixelRatio(),
      open: document.querySelector('.maplibregl-ctrl-attrib').hasAttribute('open'),
      bounds: window.testApp.mapRef.getBounds().toArray(),
    }))).toEqual(before)
  }
})
