import { test, expect } from '@playwright/test'

test('loads committed occurrence data and a map canvas', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.locator('.legend-container')).toBeVisible()
  // Unfiltered data opens coloured by individuals per site, with a ramp key.
  await expect(page.locator('.legend-individuals')).toBeVisible()
  // MapLibre owns its mutable render state. Vue must retain the instance,
  // rather than proxy its internal buckets and graphics resources.
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__._instance.setupState.mapRef)
  expect(await page.evaluate(() => Boolean(
    document.querySelector('#app').__vue_app__._instance.setupState.mapRef.__v_isReactive
  ))).toBe(false)
})

test.describe('Desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('shows filters beside the map', async ({ page }) => {
    await page.goto('./')
    await expect(page.locator('.sidebar').first()).toBeVisible()
    await expect(page.locator('.map')).toBeVisible()
  })
})
