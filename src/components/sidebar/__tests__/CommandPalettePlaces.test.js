// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import { createPinia } from 'pinia'
import CommandPaletteDialog from '../CommandPaletteDialog.vue'
import { useDatasetStore } from '../../../stores/datasetStore'

const mounted = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() } }

async function mountPalette({ phone, features }) {
  const map = { fitBounds: vi.fn(), flyTo: vi.fn(), resize: vi.fn() }
  const setView = vi.fn()
  const palette = ref(null)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(CommandPaletteDialog, { ref: palette }) })
  const pinia = createPinia()
  app.use(pinia)
  if (features) useDatasetStore(pinia).allFeatures = features
  app.provide('mobileLayout', { isMobile: ref(phone) })
  app.provide('mapRef', shallowRef(map))
  app.provide('setView', setView)
  app.mount(host)
  mounted.push(app)
  palette.value.open()
  await flush()
  return { map, setView }
}

async function type(text) {
  const input = document.querySelector('.cmd-input')
  input.value = text
  input.dispatchEvent(new Event('input'))
  await flush()
}

describe('Smart Search places on phones', () => {
  it('searches places on a tap and moves the map to the chosen one', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { display_name: 'Tena, Napo, Ecuador', lat: '-0.99', lon: '-77.81', boundingbox: ['-1.0', '-0.98', '-77.82', '-77.80'] },
        { display_name: 'Tena, Napo, Ecuador', lat: '-0.99', lon: '-77.81' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { map, setView } = await mountPalette({ phone: true })
    await type('Tena')
    const heading = [...document.querySelectorAll('.cmd-group-heading')].find(el => el.textContent === 'Places')
    expect(heading).toBeTruthy()
    // Nothing is sent to the geocoder while typing.
    expect(fetchMock).not.toHaveBeenCalled()

    document.querySelector('.cmd-item--place-search').click()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const rows = [...document.querySelectorAll('.cmd-place-name')]
    expect(rows.map(r => r.textContent)).toEqual(['Tena, Napo, Ecuador'])

    rows[0].closest('button').click()
    await flush()
    expect(setView).toHaveBeenCalledWith('map')
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
  })

  it('offers no places section on larger screens, which have their own location box', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await mountPalette({ phone: false })
    await type('Tena')
    expect([...document.querySelectorAll('.cmd-group-heading')].some(el => el.textContent === 'Places')).toBe(false)
  })
})

describe('Smart Search subspecies rows', () => {
  it('names the species once when the subspecies value already starts with it', async () => {
    const record = (scientific_name, subspecies) => ({ scientific_name, subspecies, genus: scientific_name.split(' ')[0], family: 'Nymphalidae', tribe: 'Ithomiini' })
    await mountPalette({ phone: false, features: [record('Pteronymia artena', 'Pteronymia artena artena'), record('Melinaea menophilus', 'hicetas')] })
    await type('artena')
    const row = [...document.querySelectorAll('.cmd-item')].find(el => el.textContent.includes('Subspecies'))
    expect(row.querySelector('.cmd-species')).toBeNull()
    await type('hicetas')
    const other = [...document.querySelectorAll('.cmd-item')].find(el => el.textContent.includes('Subspecies'))
    expect(other.querySelector('.cmd-species').textContent).toBe('Melinaea menophilus')
  })
})
