// Run against a local preview with real data, in an isolated browser context.
// CPU timings include the whole map. Software-rendered frame timings are not desktop FPS.
// Override PREVIEW_URL, CHROMIUM_PATH and BENCH_OUTPUT when needed.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const url = new URL(process.env.PREVIEW_URL || 'http://localhost:5178/ithomiini_maps/')
  url.searchParams.set('map_view', '-77.78,-0.96,10')
  await page.goto(url.href)
  await page.waitForFunction(() => {
    const map = document.querySelector('.map-wrapper')?.__vueParentComponent.setupState.map
    return map?.loaded() && map.getLayer('collection-locality-labels')
  })
  await page.waitForTimeout(1500)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]),
  )

  await page.evaluate(() => {
    const map = document.querySelector('.map-wrapper').__vueParentComponent.setupState.map
    window.localityProfile = {}
    for (const name of ['queryRenderedFeatures', 'getStyle', 'moveLayer']) {
      const original = map[name].bind(map)
      map[name] = (...args) => {
        const start = performance.now()
        const result = original(...args)
        const entry = window.localityProfile[name] ||= { calls: 0, ms: 0 }
        entry.calls++
        entry.ms += performance.now() - start
        return result
      }
    }
    for (const id of Object.keys(map.getStyle().sources).filter(id => id.startsWith('collection-local'))) {
      const source = map.getSource(id)
      if (!source.setData) continue
      const original = source.setData.bind(source)
      source.setData = (...args) => {
        const entry = window.localityProfile.setData ||= { calls: 0, ms: 0 }
        entry.calls++
        return original(...args)
      }
    }
  })

  const results = []
  // Repeat on/off to expose warm-up or ordering effects; text isolates arrow rendering.
  for (const variant of ['on', 'off', 'text', 'off', 'on']) {
    await page.evaluate(variant => {
      const state = document.querySelector('.map-wrapper').__vueParentComponent.setupState
      state.planning.localitySettings.enabled = variant !== 'off'
      for (const id of ['collection-locality-labels', 'collection-locality-callouts']) {
        state.map.setLayoutProperty(id, 'icon-image', variant === 'text' ? undefined : ['get', 'arrowImage'])
      }
      state.map.jumpTo({ center: [-77.78, -0.96], zoom: 10 })
    }, variant)
    await page.waitForFunction(() => document.querySelector('.map-wrapper').__vueParentComponent.setupState.map.loaded())
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      window.localityProfile = {}
      window.benchmarkFrames = []
      window.benchmarkLastFrame = performance.now()
      window.benchmarkTracking = true
      const frame = time => {
        window.benchmarkFrames.push(time - window.benchmarkLastFrame)
        window.benchmarkLastFrame = time
        if (window.benchmarkTracking) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    const before = await metrics()
    await page.evaluate(async () => {
      const map = document.querySelector('.map-wrapper').__vueParentComponent.setupState.map
      const stops = [
        { zoom: 10.6 }, { zoom: 9.8 },
        { zoom: 10, center: [-77.73, -0.99] }, { center: [-77.78, -0.96] },
      ]
      for (const target of stops) {
        await new Promise(resolve => {
          map.once('moveend', resolve)
          map.easeTo({ ...target, duration: 700 })
        })
        await new Promise(resolve => setTimeout(resolve, 400))
      }
    })
    const after = await metrics()
    const movement = await page.evaluate(() => {
      window.benchmarkTracking = false
      const frames = window.benchmarkFrames.filter(value => value > 0).sort((a, b) => a - b)
      return {
        profile: window.localityProfile,
        frames: frames.length,
        medianMs: frames[Math.floor(frames.length * 0.5)],
        p95Ms: frames[Math.floor(frames.length * 0.95)],
      }
    })

    await page.evaluate(() => { window.localityProfile = {} })
    const hoverBefore = await metrics()
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(650 + (i % 10) * 60, 240 + Math.floor(i / 10) * 100)
    }
    const hoverAfter = await metrics()
    const row = {
      variant,
      movement,
      cpuMs: {
        task: (after.TaskDuration - before.TaskDuration) * 1000,
        script: (after.ScriptDuration - before.ScriptDuration) * 1000,
      },
      hover: {
        taskMs: (hoverAfter.TaskDuration - hoverBefore.TaskDuration) * 1000,
        profile: await page.evaluate(() => window.localityProfile),
      },
    }
    results.push(row)
    console.log(JSON.stringify(row))
  }
  fs.writeFileSync(process.env.BENCH_OUTPUT || '/tmp/locality-performance-results.json', JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
