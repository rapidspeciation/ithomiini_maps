import { test, expect } from '@playwright/test'

// Unfiltered data has too many taxa to colour, so the legend would show the
// individuals key; request the top ten groups to get a full, tall legend.
const showFullLegend = page => page.evaluate(() => {
  window.legendTestStores.data.filters.species = []
  window.legendTestStores.legend.setColorOverride('categories')
})

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 8,
      sources: { credits: { type: 'geojson', attribution: 'Test map attribution', data: { type: 'FeatureCollection', features: [] } } },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#e0e8ed' } },
        { id: 'credits', source: 'credits', type: 'fill' }
      ]
    })
  }))
  await page.goto('./')
  await page.waitForFunction(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const map = app?._instance?.setupState?.mapRef
    const data = app?.config.globalProperties.$pinia?._s.get('data')
    return map && data && !data.loading && data.allFeatures.length > 0
  })
  await page.locator('.legend-container').waitFor()
  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    window.legendTestApp = app._instance.setupState
    window.legendTestStores = Object.fromEntries(app.config.globalProperties.$pinia._s)
    window.legendTestStores.data.colorBy = 'species'
    window.legendTestStores.data.filters.species = ['Mechanitis polymnia']
  })
  await page.waitForFunction(() => {
    const data = window.legendTestStores.data
    const map = window.legendTestApp.mapRef
    const points = data.filteredGeoJSON?.features
    return points?.length > 0 &&
      points.every(point => point.properties.scientific_name === 'Mechanitis polymnia') &&
      map?.getSource('points-source') && map.loaded() && !map.isMoving()
  })
  await page.waitForFunction(() => document.querySelectorAll('.legend-item').length === 1)
  await expect.poll(async () => (await page.locator('.legend-container').boundingBox()).height).toBeLessThan(300)
})

async function geometry(page) {
  return page.evaluate(() => {
    const map = document.querySelector('.map').getBoundingClientRect()
    const legend = document.querySelector('.legend-container').getBoundingClientRect()
    const controls = document.querySelector('.maplibregl-ctrl-bottom-right')?.getBoundingClientRect()
    return {
      x: legend.left - map.left, y: legend.top - map.top,
      right: map.right - legend.right, bottom: map.bottom - legend.bottom,
      width: legend.width, height: legend.height,
      controlsHeight: controls?.height ?? 0,
      controlsWidth: controls?.width ?? 0,
      mapWidth: map.width, mapHeight: map.height
    }
  })
}

async function expectCorner(page, corner) {
  // Auto-fit measurement has a 150 ms container-resize debounce.
  await page.waitForTimeout(180)
  await expect.poll(async () => {
    const rect = await geometry(page)
    const horizontal = corner.endsWith('left') ? rect.x : rect.right
    const overlapsControls = rect.x + rect.width > rect.mapWidth - rect.controlsWidth
    const vertical = corner.startsWith('top') ? rect.y : rect.bottom - (overlapsControls ? rect.controlsHeight : 0)
    if (Math.min(rect.x, rect.y, rect.right, rect.bottom) < 8) return 100
    return Math.max(Math.abs(horizontal - 10), Math.abs(vertical - 10))
  }).toBeLessThan(3)
}

test('all four corners survive resizing, content changes, and export scale', async ({ page }) => {
  const legend = page.locator('.legend-container')
  for (const [corner, key] of [
    ['bottom-left', 'Home'], ['top-left', 'ArrowUp'],
    ['top-right', 'ArrowRight'], ['bottom-right', 'ArrowDown']
  ]) {
    await legend.focus()
    await page.keyboard.press(key)
    await expectCorner(page, corner)
    await page.evaluate(() => window.legendTestStores.legend.setTextScale(1.25))
    await expectCorner(page, corner)
    await page.evaluate(() => window.legendTestStores.legend.setTextScale(1))
    await expectCorner(page, corner)
    await page.setViewportSize({ width: 900, height: 680 })
    await expectCorner(page, corner)
    await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = true })
    for (const scale of [0.5, 1, 1.5]) {
      await page.evaluate(value => { window.legendTestStores.data.exportSettings.uiScale = value }, scale)
      await expectCorner(page, corner)
    }
    await page.evaluate(() => { window.legendTestStores.data.exportSettings.aspectRatio = '1:1' })
    await expectCorner(page, corner)
    await page.evaluate(() => { window.legendTestStores.data.exportSettings.aspectRatio = '16:9' })
    await page.evaluate(() => {
      window.legendTestStores.data.exportSettings.uiScale = 1
      window.legendTestStores.data.exportSettings.enabled = false
    })
    await expectCorner(page, corner)
    if (corner === 'bottom-right') {
      await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible()
      await expectCorner(page, corner)
    }
  }
})

test('preview restores a free position and touch cancellation clears drag state', async ({ page }) => {
  const legend = page.locator('.legend-container')
  await legend.focus()
  await page.keyboard.press('Home')
  const before = await geometry(page)
  const box = await legend.boundingBox()
  const startX = box.x + 12
  const startY = box.y + 12
  await legend.dispatchEvent('mousedown', { clientX: startX, clientY: startY, button: 0 })
  await expect(legend).toHaveClass(/is-dragging/)
  await page.mouse.move(startX + 120, startY + 100 - before.y, { steps: 5 })
  await expect.poll(async () => (await geometry(page)).x).toBeGreaterThan(before.x + 100)
  await page.mouse.up()
  await expect(legend).not.toHaveClass(/is-dragging/)
  const free = await geometry(page)
  expect(free.x).toBeGreaterThan(before.x + 100)
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = true })
  await expect(legend).toHaveClass(/is-export/)
  await page.waitForTimeout(200)
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = false })
  await expect(legend).not.toHaveClass(/is-export/)
  await expect.poll(async () => Math.abs((await geometry(page)).x - free.x)).toBeLessThan(2)
  await expect.poll(async () => Math.abs((await geometry(page)).y - free.y)).toBeLessThan(2)

  await page.evaluate(() => {
    const event = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'touches', { value: [{ clientX: 25, clientY: 25 }] })
    document.querySelector('.legend-container').dispatchEvent(event)
  })
  await expect(legend).toHaveClass(/is-dragging/)
  await page.evaluate(() => document.dispatchEvent(new Event('touchcancel')))
  await expect(legend).not.toHaveClass(/is-dragging/)

  const map = await page.locator('.map').boundingBox()
  const current = await legend.boundingBox()
  await legend.dispatchEvent('mousedown', { clientX: current.x + 12, clientY: current.y + 12, button: 0 })
  await page.mouse.move(map.x + map.width + 100, map.y + map.height + 100, { steps: 4 })
  await page.mouse.up()
  const clamped = await geometry(page)
  expect(clamped.right).toBeGreaterThanOrEqual(8)
  expect(clamped.bottom).toBeGreaterThanOrEqual(8)
})

test('preview retains legend height and permits border resize', async ({ page }) => {
  const legend = page.locator('.legend-container')
  await showFullLegend(page)
  await expect.poll(async () => (await legend.boundingBox()).height)
    .toBeGreaterThan(page.viewportSize().width < 600 ? 200 : 350)
  const normal = await legend.boundingBox()
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = true })
  await expect(legend).toHaveClass(/is-export/)
  const frame = await geometry(page)
  const reserve = normal.width > frame.mapWidth - frame.controlsWidth ? frame.controlsHeight : 0
  await expect.poll(async () => (await legend.boundingBox()).height)
    .toBeGreaterThan(Math.min(normal.height, frame.mapHeight - 20 - reserve) * 0.85)
  await legend.hover()
  await expect(page.getByTitle('Sticky edges ON (click to disable)')).toBeInViewport()
  const south = page.locator('.resize-s')
  await expect(south).toBeVisible()
  const before = await legend.boundingBox()
  const handle = await south.boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 35, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await legend.boundingBox()).height).toBeLessThan(before.height - 20)
})

test('corner selection sticks on resize and Ctrl+corner drag scales text and box', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Ctrl+mouse drag requires a keyboard and pointer')
  const legend = page.locator('.legend-container')
  await showFullLegend(page)
  await expect.poll(async () => legend.locator('.legend-item').count()).toBeGreaterThan(5)
  await legend.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowRight')
  await expectCorner(page, 'top-right')
  await legend.hover()
  await expect(page.getByTitle('Sticky edges ON (click to disable)')).toBeInViewport()
  const before = await legend.boundingBox()
  const beforeRows = await legend.locator('.legend-item').count()
  const textBefore = await page.locator('.legend-title').evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().height / el.offsetHeight)
  const handle = await page.locator('.resize-se').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await expect(page.locator('.resize-se .resize-scale-hint')).toBeVisible()
  await page.keyboard.down('Control')
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 55, handle.y + handle.height / 2 + 45, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  const after = await legend.boundingBox()
  const afterRows = await legend.locator('.legend-item').count()
  const textAfter = await page.locator('.legend-title').evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().height / el.offsetHeight)
  expect(after.width).toBeGreaterThan(before.width * 1.08)
  expect(textAfter).toBeGreaterThan(textBefore * 1.08)
  expect(Math.abs(after.width / after.height - before.width / before.height)).toBeLessThan(0.03)
  expect(afterRows).toBe(beforeRows)
  await expectCorner(page, 'top-right')
  await page.setViewportSize({ width: 900, height: 680 })
  await expectCorner(page, 'top-right')
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = true })
  await legend.hover()
  await expect(page.getByTitle('Sticky edges ON (click to disable)')).toBeInViewport()
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = false })
  await legend.hover()
  await page.getByTitle('Sticky edges ON (click to disable)').click()
  await expect.poll(() => page.evaluate(() => window.legendTestStores.legend.corner)).toBe('free')
})

test('sticky drag snaps before release, detaches, and can be disabled', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Pointer drag checks run on desktop')
  const legend = page.locator('.legend-container')
  await legend.focus()
  await page.keyboard.press('Home')
  const frame = await geometry(page)
  const map = await page.locator('.map').boundingBox()
  const start = await legend.boundingBox()
  const inset = 8
  await legend.dispatchEvent('mousedown', { clientX: start.x + inset, clientY: start.y + inset, button: 0 })
  const rightX = map.x + frame.mapWidth - frame.width - 10
  const bottomY = map.y + frame.mapHeight - frame.height - 10 - frame.controlsHeight
  await page.mouse.move(rightX - 8 + inset, bottomY - 8 + inset)
  await expect.poll(async () => Math.abs((await legend.boundingBox()).x - rightX)).toBeLessThan(2)
  await expect.poll(async () => Math.abs((await legend.boundingBox()).y - bottomY)).toBeLessThan(2)
  await page.mouse.move(map.x + 400, map.y + 250)
  await expect.poll(async () => Math.abs((await legend.boundingBox()).x - rightX)).toBeGreaterThan(100)
  await page.mouse.move(rightX - 8 + inset, bottomY - 8 + inset)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.legendTestStores.legend.corner)).toBe('bottom-right')
  await page.setViewportSize({ width: 900, height: 680 })
  await expectCorner(page, 'bottom-right')

  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = true })
  await legend.dispatchEvent('mousedown', { clientX: (await legend.boundingBox()).x + inset, clientY: (await legend.boundingBox()).y + inset, button: 0 })
  const previewMap = await page.locator('.map').boundingBox()
  await page.mouse.move(previewMap.x + 18 + inset, previewMap.y + 18 + inset)
  await expect.poll(async () => Math.abs((await geometry(page)).x - 10)).toBeLessThan(3)
  await expect.poll(async () => Math.abs((await geometry(page)).y - 10)).toBeLessThan(3)
  await page.mouse.up()
  await page.evaluate(() => { window.legendTestStores.data.exportSettings.enabled = false })
  await expectCorner(page, 'bottom-right')

  await legend.hover()
  await page.getByTitle('Sticky edges ON (click to disable)').click()
  await expect.poll(() => page.evaluate(() => window.legendTestStores.legend.corner)).toBe('free')
  const freeStart = await legend.boundingBox()
  await legend.dispatchEvent('mousedown', { clientX: freeStart.x + inset, clientY: freeStart.y + inset, button: 0 })
  const freeMap = await page.locator('.map').boundingBox()
  await page.mouse.move(freeMap.x + 25 + inset, freeMap.y + 25 + inset)
  await expect.poll(async () => (await geometry(page)).x).toBeGreaterThan(22)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.legendTestStores.legend.corner)).toBe('free')
})

test('full legend attracts each edge during a real pointer drag without a release jump', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Real mouse drag requires a pointer')
  const legend = page.locator('.legend-container')
  await showFullLegend(page)
  await expect.poll(async () => (await legend.boundingBox()).height).toBeGreaterThan(350)
  await legend.hover()
  const handle = await page.locator('.drag-handle').boundingBox()
  const frame = await geometry(page)
  const pointer = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const rightX = frame.mapWidth - frame.width - 10
  const bottomY = frame.mapHeight - frame.height - 10 - frame.controlsHeight
  const middleY = Math.round((10 + bottomY) / 2)
  const moveRaw = async (x, y) => page.mouse.move(
    pointer.x + x - frame.x, pointer.y + y - frame.y, { steps: 4 }
  )
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await expect(legend).toHaveClass(/is-dragging/)
  await moveRaw(rightX - 16, middleY)
  await expect.poll(async () => Math.abs((await geometry(page)).right - 26)).toBeLessThan(2)
  await moveRaw(rightX - 8, middleY)
  await expect.poll(async () => Math.abs((await geometry(page)).right - 10)).toBeLessThan(2)
  await expect.poll(async () => Math.abs((await geometry(page)).y - middleY)).toBeLessThan(2)
  await moveRaw(rightX - 8, 18)
  await expect.poll(async () => Math.abs((await geometry(page)).y - 10)).toBeLessThan(2)
  const beforeRelease = await geometry(page)
  await page.mouse.up()
  const afterRelease = await geometry(page)
  expect(Math.abs(afterRelease.x - beforeRelease.x)).toBeLessThan(1)
  expect(Math.abs(afterRelease.y - beforeRelease.y)).toBeLessThan(1)
  await expect.poll(() => page.evaluate(() => window.legendTestStores.legend.corner)).toBe('top-right')

  await legend.hover()
  await page.getByTitle('Sticky edges ON (click to disable)').click()
  await legend.hover()
  const freeHandle = await page.locator('.drag-handle').boundingBox()
  const freePointer = { x: freeHandle.x + freeHandle.width / 2, y: freeHandle.y + freeHandle.height / 2 }
  await page.mouse.move(freePointer.x, freePointer.y)
  await page.mouse.down()
  await page.mouse.move(freePointer.x + frame.mapWidth, freePointer.y + frame.mapHeight)
  const beforeFreeRelease = await geometry(page)
  expect(beforeFreeRelease.right).toBeGreaterThanOrEqual(8)
  expect(beforeFreeRelease.bottom).toBeGreaterThanOrEqual(8)
  await page.mouse.up()
  const afterFreeRelease = await geometry(page)
  expect(Math.abs(afterFreeRelease.x - beforeFreeRelease.x)).toBeLessThan(1)
  expect(Math.abs(afterFreeRelease.y - beforeFreeRelease.y)).toBeLessThan(1)
})
