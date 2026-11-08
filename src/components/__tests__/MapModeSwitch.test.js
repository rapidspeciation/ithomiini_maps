// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import MapModeSwitch from '../MapModeSwitch.vue'
import SidebarMapSettings from '../SidebarMapSettings.vue'
import { useDataStore } from '../../stores/data'
import { useViewStore } from '../../stores/viewStore'

const mounted = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

function mount(component) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(component) })
  app.use(pinia).mount(host)
  mounted.push(app)
  return { host, store: useDataStore() }
}

const radios = host => [...host.querySelectorAll('[role="radio"]')]
const checked = host => radios(host).find(b => b.getAttribute('aria-checked') === 'true')
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

describe('map-mode switch', () => {
  it('is a named radio group with the four modes, Points chosen by default', () => {
    const { host } = mount(MapModeSwitch)
    const group = host.querySelector('[role="radiogroup"]')
    expect(group.getAttribute('aria-label')).toBe('Map mode')
    expect(radios(host).map(b => b.textContent.trim())).toEqual(['Points', 'Clusters', 'Heatmap', 'Ranges'])
    expect(checked(host).dataset.mapMode).toBe('points')
    // One Tab stop: the chosen mode.
    expect(radios(host).map(b => b.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('a click changes the store mode, the chosen segment and the Tab stop', async () => {
    const { host, store } = mount(MapModeSwitch)
    host.querySelector('[data-map-mode="heatmap"]').click()
    await nextTick()
    expect(store.visualizationMode).toBe('heatmap')
    expect(checked(host).dataset.mapMode).toBe('heatmap')
    expect(checked(host).classList.contains('active')).toBe(true)
    expect(radios(host).map(b => b.tabIndex)).toEqual([-1, -1, 0, -1])
  })

  it('follows the store when the mode changes elsewhere (Smart Search, a shared link)', async () => {
    const { host, store } = mount(MapModeSwitch)
    store.visualizationMode = 'ranges'
    await nextTick()
    expect(checked(host).dataset.mapMode).toBe('ranges')
  })

  it('arrow keys, Home and End choose and move focus, wrapping at the ends', async () => {
    const { host, store } = mount(MapModeSwitch)
    const at = mode => host.querySelector(`[data-map-mode="${mode}"]`)
    at('points').focus()
    key(at('points'), 'ArrowRight')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('clusters')
    expect(document.activeElement).toBe(at('clusters'))
    key(at('clusters'), 'ArrowDown')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('heatmap')
    key(at('heatmap'), 'End')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('ranges')
    key(at('ranges'), 'ArrowRight')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('points')
    expect(document.activeElement).toBe(at('points'))
    key(at('points'), 'ArrowLeft')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('ranges')
    key(at('ranges'), 'Home')
    await nextTick(); await nextTick()
    expect(store.visualizationMode).toBe('points')
    // Other keys are left alone (Tab leaves the group).
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    at('points').dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
  })

  it('writes the mode to the shared link and reads it back; an unknown mode is ignored', async () => {
    localStorage.setItem('app-persist-enabled', 'true')
    const { host, store } = mount(MapModeSwitch)
    host.querySelector('[data-map-mode="clusters"]').click()
    await nextTick()
    expect(new URLSearchParams(window.location.search).get('viz')).toBe('clusters')
    expect(localStorage.getItem('app-visualization-mode')).toContain('clusters')
    host.querySelector('[data-map-mode="points"]').click()
    await nextTick()
    expect(new URLSearchParams(window.location.search).has('viz')).toBe(false)

    window.history.replaceState({}, '', '/?viz=heatmap')
    useViewStore().restoreVisualizationFromURL()
    await nextTick()
    expect(store.visualizationMode).toBe('heatmap')
    expect(checked(host).dataset.mapMode).toBe('heatmap')

    window.history.replaceState({}, '', '/?viz=bogus')
    useViewStore().restoreVisualizationFromURL()
    await nextTick()
    expect(store.visualizationMode).toBe('heatmap')
  })

  it('a remembered mode comes back; an unknown one starts as Points', () => {
    localStorage.setItem('app-persist-enabled', 'true')
    localStorage.setItem('app-visualization-mode', JSON.stringify('ranges'))
    expect(mount(MapModeSwitch).store.visualizationMode).toBe('ranges')
    localStorage.setItem('app-visualization-mode', JSON.stringify('bogus'))
    expect(mount(MapModeSwitch).store.visualizationMode).toBe('points')
  })
})

describe('sidebar map settings', () => {
  it('has no mode buttons, and shows the current mode’s options under its name', async () => {
    const { host, store } = mount(SidebarMapSettings)
    const buttonTexts = [...host.querySelectorAll('button')].map(b => b.textContent.trim())
    for (const label of ['Points', 'Clusters', 'Heatmap', 'Ranges']) expect(buttonTexts).not.toContain(label)
    const heading = () => host.querySelector('[data-map-mode-options] .section-label').textContent.trim()
    expect(heading()).toBe('Points settings')
    expect(host.textContent).toContain('Size markers by individuals')

    store.visualizationMode = 'heatmap'
    await nextTick()
    expect(heading()).toBe('Heatmap settings')
    expect(host.textContent).toContain('Intensity')
    expect(host.textContent).not.toContain('Size markers by individuals')

    store.visualizationMode = 'ranges'
    await nextTick()
    expect(heading()).toBe('Ranges settings')
    expect(host.textContent).toContain('Fill opacity')
  })
})
