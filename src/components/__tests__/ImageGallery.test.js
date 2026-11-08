// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import ImageGallery from '../ImageGallery.vue'
import { useDatasetStore } from '../../stores/datasetStore'
import { useDataStore } from '../../stores/data'

const mounted = []
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() }
  document.body.innerHTML = ''
})

const record = (i, scientific_name, subspecies) => ({
  id: `CAM0${70000 + i}`, source: 'Sanger Institute', scientific_name, subspecies,
  genus: scientific_name.split(' ')[0], family: 'Nymphalidae', tribe: 'Ithomiini', lat: -1, lng: -77.6,
  country: 'Ecuador', image_url: `https://example.org/${i}.jpg`,
})
const records = [
  ...Array.from({ length: 6 }, (_, i) => record(i, 'Mechanitis messenoides', 'deceptus')),
  ...Array.from({ length: 3 }, (_, i) => record(10 + i, 'Hypothyris euclea', 'intermedia')),
]

async function mountGallery({ selection, features = records } = {}) {
  const outside = document.createElement('button')
  outside.textContent = 'Expand photo'
  document.body.append(outside)
  outside.focus()
  const host = document.createElement('div')
  document.body.append(host)
  const pinia = createPinia()
  const app = createApp(ImageGallery, { initialMode: 'butterflies' })
  app.use(pinia)
  useDatasetStore(pinia).allFeatures = features
  if (selection) useDataStore(pinia).gallerySelection = selection
  app.mount(host)
  mounted.push({ app, host })
  await nextTick(); await nextTick()
  return { host, outside, app }
}

describe('ImageGallery', () => {
  it('opens with the group of the shown photo unfolded in the strip', async () => {
    const { host } = await mountGallery({ selection: { species: 'Mechanitis messenoides', subspecies: 'deceptus', individualId: 'CAM070003' } })
    await nextTick()
    const groups = [...host.querySelectorAll('.species-group')]
    const open = groups.find(g => g.textContent.includes('Mechanitis messenoides'))
    // Every photo of the open group is a thumbnail, not a single folded preview.
    expect(open.querySelectorAll('.thumbnail:not(.preview-thumb)').length).toBe(6)
    const other = groups.find(g => g.textContent.includes('Hypothyris euclea'))
    expect(other.querySelector('.preview-thumb')).not.toBeNull()
  })

  it('is a dialog: focus moves to Close, stays inside on Tab, and returns on close', async () => {
    const { host, outside, app } = await mountGallery()
    const root = host.querySelector('.image-gallery')
    expect(root.getAttribute('role')).toBe('dialog')
    expect(root.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('.btn-close'))

    outside.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(root.contains(document.activeElement)).toBe(true)

    app.unmount(); mounted.length = 0
    expect(document.activeElement).toBe(outside)
  })

  it('shows the previous and next arrows only when there is more than one photo', async () => {
    const many = await mountGallery()
    expect(many.host.querySelector('.nav-prev')).not.toBeNull()
    expect(many.host.querySelector('.nav-next')).not.toBeNull()
    for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() }
    const one = await mountGallery({ features: [records[0]] })
    expect(one.host.querySelector('.image-gallery')).not.toBeNull()
    expect(one.host.querySelector('.nav-prev')).toBeNull()
    expect(one.host.querySelector('.nav-next')).toBeNull()
  })
})
