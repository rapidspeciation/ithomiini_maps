import { test, expect } from '@playwright/test'

// ?export=1 and window.ithomiiniMapsExport(), on the committed data with the
// real CARTO basemap (labels need its glyphs). Request of the design pilot B:
// Tithorea harmonia females in Ecuador, framed by an explicit bbox.
// Frames Anangu and Loreto only; the other records are outside the picture.
const BBOX = [-77.3, -0.9, -76.2, -0.35]
const QUERY = new URLSearchParams({
  sp: 'Tithorea harmonia',
  source: 'Sanger Institute,GBIF (UNAM),GBIF (Other Institutions),Dore et al. (2022),iNaturalist',
  country: 'Ecuador', sex: 'female', sites: '1', site_labels: 'records', site_min: '1',
  style: 'light', color_by: 'subspecies', bbox: BBOX.join(','), export: '1',
}).toString()

// The database worker's browser (tests/fixtures/maps-export-contract.json there).
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', locale: 'en-US' })
test.skip(({ isMobile }) => isMobile, 'The fixed 760 x 570 export frame needs a desktop-sized viewport.')

test('export mode returns the picture with the records, view, legend and sites it shows', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto(`./?${QUERY}`)
  await page.waitForFunction(() => typeof window.ithomiiniMapsExport === 'function')
  const result = await page.evaluate(() => window.ithomiiniMapsExport())

  // Contract and fixed output.
  expect(result.version).toBe(1)
  expect([result.width, result.height]).toEqual([1600, 1200])
  const png = Buffer.from(result.png_base64, 'base64')
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 1200])
  expect(result.params.ignored).toEqual([])
  expect(result.params.applied.bbox).toEqual(BBOX)
  expect(result.basemap).toBe('light')
  expect(result.color_by).toBe('subspecies')
  expect(result.title).toBe('Tithorea harmonia · females · Ecuador')

  // Records: the whole filtered set with map-native fields, also outside the frame.
  const store = await page.evaluate(() => {
    const data = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('data')
    return data.filteredGeoJSON.features.map(f => `${f.properties.source}|${f.properties.id}`)
  })
  expect(result.records.length).toBeGreaterThan(0)
  expect(result.records.map(r => `${r.source}|${r.id}`).sort()).toEqual(store.sort())
  expect(result.records.every(r => r.sex === 'female' && r.country === 'Ecuador')).toBe(true)

  // Legend: rows (with the unknown row) add up to the records.
  expect(result.legend.unit).toBe('records')
  expect(result.legend.rows.reduce((sum, row) => sum + row.records, 0)).toBe(result.records.length)
  const unknown = result.legend.rows.find(row => row.unknown)
  if (unknown) await expect(page.locator('.legend-unknown')).toContainText(String(unknown.records))
  // Every row is in the picture: none behind "+ N more" or a scrollbar.
  expect(result.legend.truncated).toBe(false)
  const legendBox = await page.locator('.legend-container').boundingBox()
  const unknownBox = await page.locator('.legend-unknown').boundingBox()
  if (unknown) expect(unknownBox.y + unknownBox.height).toBeLessThanOrEqual(legendBox.y + legendBox.height)

  // View: exactly MapLibre's fit of the requested bbox in the measured frame.
  expect(result.view.frame).toEqual({ width: 760, height: 570 })
  expect(result.view.fit).toEqual({ padding: 32, max_zoom: 12 })
  const expected = await page.evaluate(({ bbox, padding, maxZoom }) => {
    const map = document.querySelector('#app').__vue_app__._instance.setupState.mapRef
    const camera = map.cameraForBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding, maxZoom })
    const center = camera.center.toArray ? camera.center.toArray() : [camera.center.lng, camera.center.lat]
    return { center, zoom: camera.zoom }
  }, { bbox: BBOX, padding: result.view.fit.padding, maxZoom: result.view.fit.max_zoom })
  expect(Math.abs(result.view.center[0] - expected.center[0])).toBeLessThan(1e-5)
  expect(Math.abs(result.view.center[1] - expected.center[1])).toBeLessThan(1e-5)
  expect(Math.abs(result.view.zoom - expected.zoom)).toBeLessThan(0.02)
  const [w, s, e, n] = result.view.bbox
  if (result.view.zoom < 12 - 1e-6) expect(w <= BBOX[0] && s <= BBOX[1] && e >= BBOX[2] && n >= BBOX[3]).toBe(true)

  // Sites: every record inside the actual view is in a drawn marker; members are real records.
  const recordKeys = new Set(result.records.map(r => `${r.source}|${r.id}`))
  const memberKeys = result.sites.flatMap(site => site.members.flatMap(member => member.record_ids))
  expect(new Set(memberKeys).size).toBe(memberKeys.length)
  expect(memberKeys.every(key => recordKeys.has(key))).toBe(true)
  const inView = result.records.filter(r => r.lng > w && r.lng < e && r.lat > s && r.lat < n)
  expect(inView.length).toBeGreaterThan(0)
  expect(inView.length).toBeLessThan(result.records.length)
  for (const record of inView) expect(memberKeys).toContain(`${record.source}|${record.id}`)
  for (const site of result.sites) {
    expect(site.records).toBe(site.members.reduce((sum, member) => sum + member.record_ids.length, 0))
    expect(site.merged_sites).toBe(site.members.length)
  }
  // Labels named in the metadata are the ones MapLibre drew.
  const drawn = await page.evaluate(() => {
    const map = document.querySelector('#app').__vue_app__._instance.setupState.mapRef
    const layers = ['collection-locality-labels', 'collection-locality-callouts'].filter(id => map.getLayer(id))
    return [...new Set(map.queryRenderedFeatures({ layers }).map(f => f.properties.label))]
  })
  const named = result.sites.flatMap(site => site.labels)
  expect(named.length).toBeGreaterThan(0)
  const drawnText = drawn.map(text => text.replace(/\s+/g, ' ').trim())
  for (const label of named) expect(drawnText).toContain(label)
  expect(named).toEqual(expect.arrayContaining(['Anangu Boca del Rio ECD OR', 'Loreto - Comunidad Pano']))

  // Picture: not blank, no preview border (fixed sample: no accent pixel in the outer 4 px),
  // and the live frame keeps its border afterwards.
  const pixels = await page.evaluate(async (b64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${b64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height)
    const frame = document.querySelector('.map.map-export-preview')
    const probe = document.createElement('div')
    probe.style.color = getComputedStyle(frame).getPropertyValue('--color-accent')
    document.body.appendChild(probe)
    const accent = getComputedStyle(probe).color.match(/\d+/g).map(Number)
    probe.remove()
    const isAccent = i => Math.abs(data[i] - accent[0]) < 40 && Math.abs(data[i + 1] - accent[1]) < 40 && Math.abs(data[i + 2] - accent[2]) < 40
    let edgeAccent = 0, sum = 0, sum2 = 0, count = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if ((x < 4 || y < 4 || x >= width - 4 || y >= height - 4) && isAccent(i)) edgeAccent++
        if ((x + y) % 7 === 0) {
          const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          sum += l; sum2 += l * l; count++
        }
      }
    }
    return { edgeAccent, sd: Math.sqrt(sum2 / count - (sum / count) ** 2), liveBorder: getComputedStyle(frame).borderTopColor }
  }, result.png_base64)
  expect(pixels.edgeAccent).toBe(0)
  const titleHeight = await page.evaluate(() => document.querySelector('.export-title-strip').getBoundingClientRect().height)
  expect(titleHeight).toBeLessThanOrEqual(result.view.fit.padding)
  expect(pixels.sd).toBeGreaterThan(8)
  expect(pixels.liveBorder).not.toBe('rgba(0, 0, 0, 0)')

  // The link the app keeps (map_url) still carries the same settings.
  const kept = new URL(page.url()).searchParams
  for (const name of ['style', 'color_by', 'bbox', 'sp', 'country', 'sex', 'sites', 'site_labels', 'site_min']) {
    expect(kept.get(name)).toBe(new URLSearchParams(QUERY).get(name))
  }
})

// Picture geometry (view.overlays, records[].in_picture, sites[].occluded): what the
// metadata says is visible must not sit under the title strip, legend, scale or credits.
const exportQuery = (bbox, extra = {}) => new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(QUERY)),
  bbox: bbox.join(','), ...extra }).toString()
const touches = ({ x, y, radius }, r) => {
  const dx = x - Math.max(r.x, Math.min(x, r.x + r.width))
  const dy = y - Math.max(r.y, Math.min(y, r.y + r.height))
  return dx * dx + dy * dy <= radius * radius
}
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function exportAt(page, query) {
  await page.goto(`./?${query}`)
  await page.waitForFunction(() => typeof window.ithomiiniMapsExport === 'function')
  const result = await page.evaluate(() => window.ithomiiniMapsExport())
  // Overlays as the page has them now (same layout as at capture), measured independently.
  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('.map canvas.maplibregl-canvas').getBoundingClientRect()
    return [['title', '.export-title-strip'], ['legend', '.legend-container'], ['scale', '.maplibregl-ctrl-scale'],
      ['attribution', '.maplibregl-ctrl-attrib']].flatMap(([kind, selector]) => [...document.querySelectorAll(`.map ${selector}`)]
      .map(node => node.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ kind, x: r.left - canvas.left, y: r.top - canvas.top, width: r.width, height: r.height })))
  })
  return { result, measured }
}

function expectHonestGeometry(result, measured) {
  const overlays = result.view.overlays
  expect(overlays.map(o => o.kind)).toEqual(expect.arrayContaining(['title', 'legend', 'scale', 'attribution']))
  for (const m of measured) {
    const same = overlays.find(o => o.kind === m.kind && Math.abs(o.x - m.x) < 1 && Math.abs(o.y - m.y) < 1 &&
      Math.abs(o.width - m.width) < 1 && Math.abs(o.height - m.height) < 1)
    expect(same, `${m.kind} overlay reported`).toBeTruthy()
  }
  const frame = result.view.frame
  for (const site of result.sites) {
    const hit = overlays.some(o => touches(site, o)) || site.label_boxes.some(box => overlays.some(o => overlap(box, o)))
    expect(site.occluded, `site ${site.members[0]?.locality}`).toBe(hit)
    // Labels listed are the ones whose box is in the frame and clear of every overlay
    // (a clear label may still name a marker that is itself covered: the site is occluded).
    const clear = site.label_boxes.filter(box => box.x >= 0 && box.y >= 0 && box.x + box.width <= frame.width &&
      box.y + box.height <= frame.height && !overlays.some(o => overlap(box, o)))
    expect(site.labels.length).toBe(clear.length)
    expect(site.hidden_labels).toBe(site.label_boxes.length - clear.length)
  }
  const siteOf = new Map(result.sites.flatMap(site => site.members.flatMap(m => m.record_ids.map(id => [id, site]))))
  for (const r of result.records) {
    const inFrame = r.x >= 0 && r.x <= frame.width && r.y >= 0 && r.y <= frame.height
    const covered = overlays.some(o => r.x >= o.x && r.x <= o.x + o.width && r.y >= o.y && r.y <= o.y + o.height)
    const site = siteOf.get(`${r.source}|${r.id}`)
    expect(r.in_picture).toBe(Boolean(inFrame && !covered && site && !site.occluded))
  }
}

test('Sol bbox: Anangu under the title strip is not claimed visible', async ({ page }) => {
  test.setTimeout(180000)
  const { result, measured } = await exportAt(page, exportQuery([-77.3, -1.235, -76.2, -0.685]))
  expectHonestGeometry(result, measured)
  const title = result.view.overlays.find(o => o.kind === 'title')
  expect(title.y).toBe(0)
  expect(title.height).toBeGreaterThan(25)
  const anangu = result.records.filter(r => r.y >= 0 && r.y < title.height && r.x >= 0 && r.x <= result.view.frame.width)
  expect(anangu.length).toBeGreaterThan(0)
  for (const r of anangu) expect(r.in_picture).toBe(false)
  const site = result.sites.find(s => s.members.some(m => /Anangu/.test(m.locality)))
  expect(site?.occluded).toBe(true)
  expect(site.occluded_by).toContain('title')
  // Its label avoided the strip (layout obstacle), so any label listed for it is fully below the strip.
  for (const box of site.label_boxes) expect(box.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(result.title_truncated).toBe(false)
  expect(result.capture_attempts).toBe(1)
})

test('original auto frame: the legend moves off the markers, so every drawn site is visible', async ({ page }) => {
  test.setTimeout(180000)
  const { result, measured } = await exportAt(page, exportQuery([-77.74989, -1.08566, -76.24961, -0.46604]))
  expectHonestGeometry(result, measured)
  expect(result.view.legend_placement.occluded_sites).toBe(0)
  expect(result.sites.filter(s => s.occluded)).toEqual([])
  expect(result.sites.length).toBeGreaterThan(3)
  // Picture unchanged in size; the view is still the exact fit.
  expect([result.width, result.height]).toEqual([1600, 1200])
  expect(result.view.frame).toEqual({ width: 760, height: 570 })
})

test('a legend change during the capture: one retry, consistent result; changes every time: explicit rejection', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto(`./?${QUERY}`)
  await page.waitForFunction(() => typeof window.ithomiiniMapsExport === 'function')
  // html-to-image reads the map canvas during the capture, after the metadata snapshot.
  const once = await page.evaluate(async () => {
    const legend = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('legend')
    const original = HTMLCanvasElement.prototype.toDataURL
    let fired = false
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (!fired) { fired = true; legend.toggleItemVisibility('hermias') }
      return original.apply(this, args)
    }
    try {
      const result = await window.ithomiiniMapsExport()
      return { attempts: result.capture_attempts, subspecies: [...new Set(result.records.map(r => r.subspecies))], hidden: [...legend.hiddenItems] }
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original
    }
  })
  expect(once.attempts).toBe(2)
  expect(once.hidden).toEqual(['hermias'])
  expect(once.subspecies).not.toContain('hermias')

  const always = await page.evaluate(async () => {
    const legend = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('legend')
    const original = HTMLCanvasElement.prototype.toDataURL
    let calls = 0
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (calls++ % 2 === 0) legend.toggleItemVisibility('hermias')
      return original.apply(this, args)
    }
    try {
      await window.ithomiiniMapsExport()
      return 'resolved'
    } catch (error) {
      return error.message
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original
    }
  })
  expect(always).toContain('The map changed while the picture was being taken')
})

test('a bbox link is dropped after a programmatic move and does not snap back on resize', async ({ page }) => {
  test.setTimeout(120000)
  const bbox = [-77.3, -1.235, -76.2, -0.685]
  await page.goto(`./?sp=Tithorea+harmonia&bbox=${bbox.join(',')}`)
  const mapReady = () => document.querySelector('#app').__vue_app__._instance.setupState.mapRef?.loaded()
  await page.waitForFunction(mapReady, null, { timeout: 60000 })
  expect(new URL(page.url()).searchParams.get('bbox')).toBe(bbox.join(','))
  const moved = await page.evaluate(() => new Promise(resolve => {
    const map = document.querySelector('#app').__vue_app__._instance.setupState.mapRef
    map.once('moveend', () => resolve(map.getCenter().toArray()))
    map.easeTo({ center: [-70, -5], zoom: 5, duration: 200 })
  }))
  expect(new URL(page.url()).searchParams.has('bbox')).toBe(false)
  await page.setViewportSize({ width: 1100, height: 700 })
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => {
    const map = document.querySelector('#app').__vue_app__._instance.setupState.mapRef
    return { center: map.getCenter().toArray(), zoom: map.getZoom() }
  })
  expect(Math.abs(after.center[0] - moved[0])).toBeLessThan(1e-6)
  expect(Math.abs(after.center[1] - moved[1])).toBeLessThan(1e-6)
  expect(Math.abs(after.zoom - 5)).toBeLessThan(1e-6)
  expect(new URL(page.url()).searchParams.has('bbox')).toBe(false)
})
