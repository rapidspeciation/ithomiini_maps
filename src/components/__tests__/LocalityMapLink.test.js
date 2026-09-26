// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import LocalityMapLink from '../LocalityMapLink.vue'

const mounted = []
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() }
})

function mount(site) {
  const host = document.createElement('div')
  const app = createApp(LocalityMapLink, { site })
  document.body.append(host)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

describe('LocalityMapLink', () => {
  it('opens a single recorded point in a new Google Maps tab', () => {
    const host = mount({ recordedPoints: [[-78.77, -0.05]] })
    const link = host.querySelector('a')
    const url = new URL(link.href)
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('query')).toBe('-0.05,-78.77')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(link.getAttribute('aria-label')).toBe('Open in Google Maps')
    expect(link.title).toBe('Open in Google Maps')
  })

  it('offers every recorded point when a locality has more than one', () => {
    const host = mount({ recordedPoints: [[-78.77, -0.05], [-78.771, -0.051]] })
    expect(host.querySelector('summary').getAttribute('aria-label')).toBe('Open in Google Maps')
    expect([...host.querySelectorAll('a')].map(link => new URL(link.href).searchParams.get('query'))).toEqual([
      '-0.05,-78.77', '-0.051,-78.771'
    ])
    expect([...host.querySelectorAll('a')].every(link => link.target === '_blank' && link.rel.includes('noopener'))).toBe(true)
  })

  it('does not link invalid coordinates or a calculated site center', () => {
    const host = mount({ coordinates: [-78.8, -0.1], recordedPoints: [[NaN, -0.05], [-190, -0.05]] })
    expect(host.querySelector('a, summary')).toBeNull()
  })
})
