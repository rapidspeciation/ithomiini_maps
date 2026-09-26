// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(host.querySelectorAll('.taxonomy-select')).toHaveLength(2)
    expect(host.querySelector('.taxonomy-select').value).toBe('Mechanitis lysimnia')
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
})
