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

test('credits are grouped with the scale, away from the default legend', async ({ page }) => {
  const credits = page.locator('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib')
  await expect(credits).toBeVisible()
  await expect(page.locator('.maplibregl-ctrl-bottom-left .maplibregl-ctrl-attrib')).toHaveCount(0)
  const scale = await page.locator('.maplibregl-ctrl-scale').boundingBox()
  const attr = await credits.boundingBox()
  expect(scale.y + scale.height).toBeLessThanOrEqual(attr.y)
  const creditText = credits.locator('.maplibregl-ctrl-attrib-inner')
  await expect(creditText).toBeVisible()
  await expect(creditText).toContainText('Test map attribution')
  await page.evaluate(() => window.testApp.mapRef.fire('drag'))
  await expect(creditText).toBeVisible()
  await expect(credits).not.toHaveClass(/maplibregl-compact/)
  const expanded = await credits.boundingBox()
  const ruler = await page.locator('.maplibregl-ctrl-scale').boundingBox()
  expect(ruler.y + ruler.height).toBeLessThanOrEqual(expanded.y)
})
