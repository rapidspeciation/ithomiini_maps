import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// A system colour scheme the test can flip, as the OS does.
function fakeSystem(dark) {
  const listeners = []
  const query = {
    matches: dark,
    addEventListener: (_type, fn) => listeners.push(fn),
    removeEventListener: () => {},
  }
  window.matchMedia = vi.fn(() => query)
  return { set(value) { query.matches = value; listeners.forEach(fn => fn({ matches: value })) } }
}

async function loadStore() {
  vi.resetModules()
  const mod = await import('../theme')
  setActivePinia(createPinia())
  return { ...mod, store: mod.useThemeStore() }
}

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  root().removeAttribute('data-mode')
  root().removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
})

describe('theme preference', () => {
  it('follows the system when nothing is stored, and keeps following it', async () => {
    const system = fakeSystem(true)
    const { store } = await loadStore()
    expect(store.modePref).toBe('system')
    expect(root().dataset.mode).toBe('dark')
    expect(root().style.colorScheme).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#1a1a2e')
    system.set(false)
    await nextTick()
    expect(store.currentMode).toBe('light')
    expect(root().dataset.mode).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f8f9fa')
  })

  it('remembers Light or Dark without «Remember Settings», and System is remembered too', async () => {
    const system = fakeSystem(false)
    let { store, MODE_KEY } = await loadStore()
    store.setModePref('dark')
    expect(localStorage.getItem(MODE_KEY)).toBe('dark')
    expect(root().dataset.mode).toBe('dark')
    system.set(false) // the system no longer decides
    expect(store.currentMode).toBe('dark')
    ;({ store } = await loadStore())
    expect(store.modePref).toBe('dark')
    expect(store.currentMode).toBe('dark')
    store.setModePref('system')
    expect(localStorage.getItem(MODE_KEY)).toBe('system')
    expect(store.currentMode).toBe('light')
  })

  it('keeps System after a reload even when the older app-mode key says dark', async () => {
    const system = fakeSystem(false)
    localStorage.setItem('app-persist-enabled', 'true')
    localStorage.setItem('app-mode', 'dark')
    let { store } = await loadStore()
    expect(store.currentMode).toBe('dark')
    store.setModePref('system')
    expect(store.currentMode).toBe('light')
    ;({ store } = await loadStore())
    expect(store.modePref).toBe('system')
    expect(store.currentMode).toBe('light')
    system.set(true)
    expect(store.currentMode).toBe('dark')
  })

  it('toggles to an explicit choice', async () => {
    fakeSystem(true)
    const { store } = await loadStore()
    store.toggleMode()
    expect(store.modePref).toBe('light')
    expect(root().dataset.mode).toBe('light')
  })

  it('keeps the palette only with «Remember Settings», as before', async () => {
    fakeSystem(false)
    let { store } = await loadStore()
    store.setTheme('ocean')
    expect(localStorage.getItem('app-theme')).toBeNull()
    ;({ store } = await loadStore())
    expect(store.currentTheme).toBe('emerald')
    localStorage.setItem('app-persist-enabled', 'true')
    localStorage.setItem('app-theme', JSON.stringify('ocean')) // as persistence.saveAllState writes it
    ;({ store } = await loadStore())
    expect(store.currentTheme).toBe('ocean')
    expect(root().dataset.theme).toBe('ocean')
  })

  it('parses unknown stored values as «follow the system»', async () => {
    const { parseModePref, resolveMode } = await loadStore()
    expect(parseModePref('sepia')).toBe('system')
    expect(parseModePref(null)).toBe('system')
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('light', true)).toBe('light')
  })
})

describe('boot script in index.html', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')
  const boot = /<script>([\s\S]*?)<\/script>/.exec(html)[1]

  const cases = [
    { system: true, stored: {}, mode: 'dark', palette: 'emerald' },
    { system: false, stored: {}, mode: 'light', palette: 'emerald' },
    { system: true, stored: { 'atlas-theme-mode': 'light' }, mode: 'light', palette: 'emerald' },
    { system: false, stored: { 'atlas-theme-mode': 'dark', 'app-theme': 'ocean' }, mode: 'dark', palette: 'emerald' },
    { system: false, stored: { 'app-persist-enabled': 'true', 'app-theme': '"sunset"', 'app-mode': 'dark' }, mode: 'dark', palette: 'sunset' },
    { system: false, stored: { 'app-persist-enabled': 'true', 'app-mode': 'dark', 'atlas-theme-mode': 'system' }, mode: 'light', palette: 'emerald' },
  ]
  for (const c of cases) {
    it(`agrees with the store: system ${c.system ? 'dark' : 'light'}, stored ${JSON.stringify(c.stored)}`, async () => {
      fakeSystem(c.system)
      for (const [k, v] of Object.entries(c.stored)) localStorage.setItem(k, v)
      new Function(boot)()
      const booted = { mode: root().dataset.mode, palette: root().dataset.theme, bar: document.querySelector('meta[name="theme-color"]').getAttribute('content') }
      expect(booted.mode).toBe(c.mode)
      expect(booted.palette).toBe(c.palette)
      const { store, pageColour } = await loadStore()
      expect(store.currentMode).toBe(booted.mode)
      expect(store.currentTheme).toBe(booted.palette)
      expect(booted.bar).toBe(pageColour(c.palette, c.mode))
    })
  }
})
