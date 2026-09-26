import { test, expect } from '@playwright/test'

test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true })
  test.beforeEach(async ({ page }) => { await page.goto('./') })

  test('keeps the map visible and desktop sidebar closed', async ({ page }) => {
    await expect(page.locator('.map')).toBeVisible()
    await expect(page.locator('.sidebar').first()).not.toBeVisible()
    await expect(page.locator('.mobile-quick-bar')).toBeVisible()
  })

  test('opens and closes the mobile sidebar', async ({ page }) => {
    await page.locator('.mobile-menu-btn').click()
    await expect(page.locator('.mobile-sidebar-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Close menu', exact: true }).click()
    await expect(page.locator('.mobile-sidebar-panel')).toHaveCount(0)
    await expect(page.locator('.mobile-quick-bar')).toBeVisible()
  })

  test('switches map and table from the quick controls', async ({ page }) => {
    const controls = page.locator('.mobile-quick-bar')
    await controls.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(page.locator('.map')).not.toBeVisible()
    await controls.getByRole('button', { name: 'Map', exact: true }).click()
    await expect(page.locator('.map')).toBeVisible()
  })
})
