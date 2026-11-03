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
