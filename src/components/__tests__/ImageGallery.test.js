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

  it('keeps the arrows in the caption row: previous, name and count, next (a row under the photo on phones)', async () => {
    const { host } = await mountGallery()
    const row = host.querySelector('.photo-nav-row')
    expect([...row.children].map(el => el.className.split(' ').find(c => ['nav-prev', 'image-counter', 'nav-next'].includes(c))))
      .toEqual(['nav-prev', 'image-counter', 'nav-next'])
    expect(host.querySelector('.image-viewer').contains(host.querySelector('.nav-prev'))).toBe(false)
  })

  it('shows one record like the popup: plain names, no count badges, no Search summary', async () => {
    const { host } = await mountGallery({ features: [records[0]] })
    const sidebar = host.querySelector('.gallery-sidebar')
    expect(sidebar.querySelectorAll('.single-taxon').length).toBe(2)
    expect(sidebar.querySelector('.single-taxon').textContent.trim()).toBe('Mechanitis messenoides')
    expect(sidebar.querySelector('.single-individual-id').textContent.trim()).toBe('CAM070000')
    expect(sidebar.querySelectorAll('.count-badge').length).toBe(0)
    expect(sidebar.querySelector('.search-summary')).toBeNull()
    expect(sidebar.textContent).toContain('Individual')
    expect(sidebar.textContent).not.toContain('Individuals')
  })

  it('names the sex and says "Coordinates" like the popup, and shows no "1 / 1" for one photo', async () => {
    const { host } = await mountGallery({ features: [{ ...records[0], sex: 'female' }] })
    const rows = [...host.querySelectorAll('.sidebar-details .detail-row')].map(el => el.textContent.replace(/\s+/g, ''))
    expect(rows).toContain('Sex:♀female')
    expect(rows.some(r => r.startsWith('Coordinates:'))).toBe(true)
    expect(host.querySelector('.image-counter').textContent).not.toContain('/')
    expect(host.querySelector('.image-counter').classList.contains('image-counter--single')).toBe(true)
  })

  it('opens Image cache from the top row of the sidebar, before the facts, with the same five choices', async () => {
    const { host } = await mountGallery()
    const sidebar = host.querySelector('.gallery-sidebar')
    const button = sidebar.querySelector('.gallery-top-row .image-cache-btn')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // It comes before the species picker and the record facts in the sidebar.
    expect(button.compareDocumentPosition(sidebar.querySelector('.sidebar-details')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    button.click(); await nextTick()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = sidebar.querySelector('#gallery-image-cache')
    expect(panel.style.display).not.toBe('none')
    expect([...panel.querySelectorAll('.proxy-option-name')].map(e => e.textContent)).toEqual(['Auto', 'wsrv.nl', 'Google CDN', 'Thumbnail', 'Off'])
    expect(sidebar.querySelector('.collapsible-section')).toBeNull()
  })

  it('hides the gallery close button while the phone Info drawer, with its own close button, is open', async () => {
    const { host } = await mountGallery()
    const galleryClose = host.querySelector('.btn-close')
    expect(galleryClose.classList.contains('btn-close--behind-drawer')).toBe(false)
    host.querySelector('.btn-gallery-filters').click(); await nextTick()
    expect(galleryClose.classList.contains('btn-close--behind-drawer')).toBe(true)
    host.querySelector('.gallery-sidebar-close').click(); await nextTick()
    expect(galleryClose.classList.contains('btn-close--behind-drawer')).toBe(false)
  })

  it('keeps pickers, count badges and the Search summary for several records', async () => {
    const { host } = await mountGallery()
    const sidebar = host.querySelector('.gallery-sidebar')
    // Two species keep their picker; the shown species has one subspecies, which reads as plain text.
    expect([...sidebar.querySelectorAll('.single-taxon')].map(el => el.textContent.trim())).toEqual(['deceptus'])
    expect(sidebar.querySelectorAll('.count-badge').length).toBe(2)
    expect(sidebar.querySelector('.search-summary')).not.toBeNull()
  })
})
