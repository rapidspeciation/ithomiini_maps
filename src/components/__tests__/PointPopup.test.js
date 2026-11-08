// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import PointPopup from '../PointPopup.vue'

const mounted = []
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() }
})

function mount(props) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(PointPopup, props)
  app.use(createPinia())
  app.mount(host)
  mounted.push({ app, host })
  return host
}

const points = ['Suchipakari', 'Rio Pusuno', 'San Pedro de Arajuno', 'Y de Misahualli', '<img src=x onerror=alert(1)>']
  .map((collection_location, index) => ({
    id: `CAM0000${index + 1}`, source: 'Sanger Institute', collection_location,
    lat: -1 - index * 0.06, lng: -77.6, country: 'Ecuador',
    scientific_name: index % 2 ? 'Mechanitis lysimnia' : 'Mechanitis polymnia',
    subspecies: index % 2 ? 'lysimnia' : 'polymnia', observation_date: '18-Jan-22'
  }))

describe('PointPopup', () => {
  it('opens clusters on a species overview with sites, then drills into specimens', async () => {
    let focused = null
    const host = mount({
      coordinates: { lat: -1, lng: -77.6 }, points, isCluster: true,
      onFocusSite: site => { focused = site }
    })
    expect(host.querySelector('.site-summary')).not.toBeNull()
    expect(host.querySelector('.photo-container')).toBeNull()
    expect(host.textContent).toContain('5individuals')
    const rows = [...host.querySelectorAll('.species-row')]
    expect(rows.map(row => row.querySelector('.species-row-name').textContent)).toEqual(['Mechanitis polymnia', 'Mechanitis lysimnia'])
    expect(rows[0].querySelector('.species-row-count').textContent).toBe('3')

    expect(host.querySelectorAll('.cluster-site')).toHaveLength(4)
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(host.querySelector('img')).toBeNull()
    host.querySelector('[aria-label="Focus Suchipakari on map"]').click()
    expect(focused.name).toBe('Suchipakari')
    expect(focused.recordCount).toBe(1)
    const mapsLink = [...host.querySelectorAll('.cluster-site')]
      .find(row => row.textContent.includes('Suchipakari')).querySelector('.locality-map-link')
    expect(new URL(mapsLink.href).searchParams.get('query')).toBe('-1,-77.6')
    expect(mapsLink.target).toBe('_blank')
    expect(mapsLink.rel).toContain('noopener')
    host.querySelector('.cluster-sites-toggle').click()
    await nextTick()
    expect(host.querySelectorAll('.cluster-site')).toHaveLength(5)

    rows[1].click()
    await nextTick()
    expect(host.querySelector('.site-summary')).toBeNull()
    expect(host.querySelector('.photo-container')).not.toBeNull()
    // Two species to choose from; the chosen species has one subspecies, shown as text.
    expect(host.querySelectorAll('.taxonomy-select')).toHaveLength(1)
    expect(host.querySelector('.taxonomy-select').value).toBe('Mechanitis lysimnia')
    expect(host.querySelector('.single-taxon').textContent.trim()).toBe('lysimnia')
    // The overview already shows site details; the specimen view keeps one line.
    expect(host.querySelector('.location-summary')).toBeNull()
    expect(host.querySelector('.crumb-place').textContent.trim()).toBe('5 sites')
    expect(host.querySelector('.goat-section')).toBeNull()
    host.querySelector('.popup-back').click()
    await nextTick()
    expect(host.querySelector('.site-summary')).not.toBeNull()
  })

  it('opens a site with several species on the overview unless a species was requested', async () => {
    const site = points.slice(0, 2).map(point => ({ ...point, collection_location: 'Suchipakari', lat: -1 }))
    const overview = mount({ coordinates: { lat: -1, lng: -77.6 }, points: site })
    expect(overview.querySelector('.summary-name').textContent).toBe('Suchipakari')
    expect(overview.querySelector('.summary-meta').textContent).toContain('Ecuador')
    const direct = mount({ coordinates: { lat: -1, lng: -77.6 }, points: site, initialSpecies: 'Mechanitis lysimnia' })
    expect(direct.querySelector('.site-summary')).toBeNull()
    expect(direct.querySelector('.popup-back')).not.toBeNull()
    expect(direct.querySelector('.crumb-place').textContent.trim()).toBe('Suchipakari · Ecuador')
    expect(direct.querySelector('.location-summary')).toBeNull()
  })

  it('preserves the ordinary location summary and specimen layout', () => {
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [points[0]] })
    expect(host.querySelector('.photo-container')).not.toBeNull()
    expect(host.textContent).toContain('Location Summary')
    expect(host.textContent).toContain('Suchipakari')
    expect(new URL(host.querySelector('.location-summary .locality-map-link').href).searchParams.get('query')).toBe('-1,-77.6')
    expect(host.querySelector('.cluster-sites')).toBeNull()
    expect(host.querySelector('.cluster-sites-toggle')).toBeNull()
  })

  it('opens the gallery from a click on the record photo, once per click', async () => {
    let opened = 0
    const withPhoto = { ...points[0], image_url: 'https://example.org/photo.jpg' }
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [withPhoto], onOpenGallery: () => { opened++ } })
    await nextTick()
    const photo = host.querySelector('.photo-container')
    expect(photo.classList.contains('photo-openable')).toBe(true)
    photo.querySelector('img').click()
    expect(opened).toBe(1)
    host.querySelector('.expand-btn').click()
    expect(opened).toBe(2)
    expect(host.querySelector('.expand-btn').getAttribute('aria-label')).toBe('Open photo in the gallery')

    const without = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [points[1]], onOpenGallery: () => { opened++ } })
    without.querySelector('.photo-container').click()
    expect(opened).toBe(2)
    expect(without.querySelector('.photo-container').classList.contains('photo-openable')).toBe(false)
  })

  it('shows "No photo" with no gallery action when every photo source fails', async () => {
    let opened = 0
    const withPhoto = { ...points[0], image_url: 'https://example.org/broken.jpg' }
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [withPhoto], onOpenGallery: () => { opened++ } })
    await nextTick()
    // Each candidate (proxy, then direct) fails in turn; the last failure gives up.
    for (let i = 0; i < 5 && host.querySelector('.photo-container img'); i++) {
      host.querySelector('.photo-container img').dispatchEvent(new Event('error'))
      await nextTick()
    }
    const photo = host.querySelector('.photo-container')
    expect(photo.querySelector('img')).toBeNull()
    expect(photo.textContent).toContain('No photo')
    expect(photo.classList.contains('photo-openable')).toBe(false)
    expect(host.querySelector('.expand-btn')).toBeNull()
    expect(host.querySelector('.photo-indicator')).toBeNull()
    photo.click()
    expect(opened).toBe(0)
  })

  it('tries the next photo source when the first one fails', async () => {
    const withPhoto = { ...points[0], image_url: 'https://example.org/photo.jpg' }
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [withPhoto] })
    await nextTick()
    const first = host.querySelector('.photo-container img').getAttribute('src')
    host.querySelector('.photo-container img').dispatchEvent(new Event('error'))
    await nextTick()
    const second = host.querySelector('.photo-container img')
    expect(second).not.toBeNull()
    expect(second.getAttribute('src')).not.toBe(first)
    expect(host.querySelector('.expand-btn')).not.toBeNull()
  })

  it('shows a one-record popup as plain text, without repeated counts of 1', () => {
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: [points[0]] })
    expect(host.querySelectorAll('select')).toHaveLength(0)
    expect([...host.querySelectorAll('.single-taxon')].map(el => el.textContent.trim())).toEqual(['Mechanitis polymnia', 'polymnia'])
    expect(host.querySelectorAll('.count-badge')).toHaveLength(0)
    const labels = [...host.querySelectorAll('.section-label')].map(el => el.textContent.trim())
    expect(labels).toEqual(['Individual', 'Species', 'Subspecies'])
    const stats = [...host.querySelectorAll('.location-summary .stat-label')].map(el => el.textContent.trim())
    expect(stats).toEqual(['species', 'individual'])
  })

  it('keeps choices and counts when a site has several records', () => {
    const site = points.slice(0, 2).map(point => ({ ...point, collection_location: 'Suchipakari', lat: -1, scientific_name: 'Mechanitis polymnia', subspecies: 'polymnia' }))
    const host = mount({ coordinates: { lat: -1, lng: -77.6 }, points: site })
    expect(host.querySelector('.individual-select')).not.toBeNull()
    expect(host.querySelector('.individuals-section .count-badge').textContent).toBe('2')
    expect(host.querySelector('.individuals-section .section-label').textContent.trim()).toBe('Individuals')
    expect(host.querySelector('.location-summary .location-stats').textContent).toContain('individuals')
  })

  it('puts focus on the expand button when the photo opens the gallery, so it comes back there', async () => {
    const withPhoto = { ...points[0], image_url: 'https://example.org/photo.jpg' }
    let focusedAtOpen = null
    const host = mount({
      coordinates: { lat: -1, lng: -77.6 }, points: [withPhoto],
      onOpenGallery: () => { focusedAtOpen = document.activeElement }
    })
    await nextTick()
    host.querySelector('.photo-container img').click()
    expect(focusedAtOpen).toBe(host.querySelector('.expand-btn'))
  })
})
