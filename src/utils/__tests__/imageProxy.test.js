// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  checkWsrvForUrl,
  getProxyState,
  getProxiedUrl,
  getDirectImageUrl,
  getImageUrlCandidates,
  getThumbnailUrl,
  notifyTierFailed,
  setProxyMode,
} from '../imageProxy'

describe('imageProxy', () => {
  beforeEach(() => {
    setProxyMode('auto')
    getProxyState().tierStatus.value = {
      wsrv: 'unknown',
      lh3: 'unknown',
      thumbnail: 'unknown',
    }
  })

  it('proxies non-Drive images through wsrv in auto mode', () => {
    const url = 'http://54.72.131.62/iiif/2/TCD52005.jpg/full/full/0/default.jpg'
    const resolved = getThumbnailUrl(url)

    expect(resolved).toContain('https://wsrv.nl/')
    expect(resolved).toContain('w=400')
    expect(decodeURIComponent(new URL(resolved).searchParams.get('url')))
      .toBe('http://54.72.131.62/iiif/2/TCD52005.jpg/full/400,/0/default.jpg')
  })

  it('resizes IIIF URLs directly when cache is off', () => {
    setProxyMode('off')
    const url = 'http://54.72.131.62/iiif/2/TCD52005.jpg/full/full/0/default.jpg'

    expect(getProxiedUrl(url))
      .toBe('http://54.72.131.62/iiif/2/TCD52005.jpg/full/2000,/0/default.jpg')
    expect(getThumbnailUrl(url))
      .toBe('http://54.72.131.62/iiif/2/TCD52005.jpg/full/400,/0/default.jpg')
  })

  it('skips wsrv in auto mode for known oversized GBIF media hosts', () => {
    const url = 'https://d2jcv3kl45hlgi.cloudfront.net/1673d1acc62e9356a298ec4029744356.jpg'

    expect(getThumbnailUrl(url)).toBe(url)
    expect(getImageUrlCandidates(url, { width: 400 })).toEqual([url])
  })

  it('still allows manual wsrv mode for oversized GBIF media debugging', () => {
    setProxyMode('wsrv')
    const url = 'https://d2jcv3kl45hlgi.cloudfront.net/1673d1acc62e9356a298ec4029744356.jpg'

    expect(getThumbnailUrl(url)).toContain('https://wsrv.nl/')
  })

  it('falls back to the direct image once wsrv failed to load that image', () => {
    // A URL of its own: the list of images wsrv could not fetch is kept for the whole page session.
    const url = 'https://example.org/blocked-plant.jpg'
    notifyTierFailed(getProxiedUrl(url))

    expect(getProxiedUrl(url)).toBe(url)
    expect(getImageUrlCandidates(url, { width: 400 })[0]).toBe(url)
  })

  it('a global wsrv block alone does not bypass wsrv for other external images', () => {
    getProxyState().tierStatus.value.wsrv = 'blocked'
    const url = 'https://example.org/plant.jpg'

    expect(getProxiedUrl(url)).toContain('https://wsrv.nl/')
  })

  it('keeps Google Drive tier behavior for Drive images', () => {
    const url = 'https://drive.google.com/uc?id=abc123'

    expect(getThumbnailUrl(url)).toContain('https://wsrv.nl/')
    expect(decodeURIComponent(new URL(getThumbnailUrl(url)).searchParams.get('url')))
      .toBe('https://drive.google.com/uc?id=abc123')
  })

  it('returns original URLs when image cache is off', () => {
    setProxyMode('off')
    const plantUrl = 'https://example.org/plant.jpg'
    const driveUrl = 'https://drive.google.com/uc?id=abc123'

    expect(getProxiedUrl(plantUrl)).toBe(plantUrl)
    expect(getThumbnailUrl(driveUrl)).toBe(driveUrl)
  })

  it('exposes a direct fallback URL independent of the cache mode', () => {
    const plantUrl = 'https://example.org/plant.jpg'
    const wsrvUrl = getProxiedUrl(plantUrl)

    expect(getDirectImageUrl(wsrvUrl)).toBe(plantUrl)

    const driveUrl = 'https://drive.google.com/uc?id=abc123'
    expect(getDirectImageUrl(getProxiedUrl(driveUrl))).toBe(driveUrl)
  })

  it('returns ordered fallback candidates for Google Drive images', () => {
    const driveUrl = 'https://drive.google.com/uc?id=abc123'
    const candidates = getImageUrlCandidates(driveUrl, { width: 400 })

    expect(candidates[0]).toContain('https://wsrv.nl/')
    expect(candidates).toContain('https://lh3.googleusercontent.com/d/abc123=w400')
    expect(candidates).toContain('https://drive.google.com/thumbnail?id=abc123&sz=w400')
    expect(candidates).toContain(driveUrl)
  })

  it('returns direct external image fallback after wsrv in auto mode', () => {
    const plantUrl = 'https://example.org/plant.jpg'

    expect(getImageUrlCandidates(plantUrl, { width: 400 })).toEqual([
      getThumbnailUrl(plantUrl),
      plantUrl,
    ])
  })

  it('uses https variants for http external images before falling back to http', () => {
    const plantUrl = 'http://sweetgum.nybg.org/images3/1617/372/00687486.jpg'
    const candidates = getImageUrlCandidates(plantUrl, { width: 400 })

    expect(decodeURIComponent(new URL(candidates[0]).searchParams.get('url')))
      .toBe('https://sweetgum.nybg.org/images3/1617/372/00687486.jpg')
    expect(candidates).toContain('https://sweetgum.nybg.org/images3/1617/372/00687486.jpg')
    expect(candidates).toContain(plantUrl)
  })

  it('does not add fallback candidates in manual wsrv mode', () => {
    setProxyMode('wsrv')
    const plantUrl = 'https://example.org/plant.jpg'
    const candidates = getImageUrlCandidates(plantUrl, { width: 400 })

    expect(candidates).toEqual([getThumbnailUrl(plantUrl)])
    expect(candidates[0]).toContain('https://wsrv.nl/')
  })

  it('can re-check wsrv against a non-Drive image URL', async () => {
    const previousImage = global.Image
    class MockImage {
      set src(value) {
        this._src = value
        setTimeout(() => this.onload?.(), 0)
      }
      get src() { return this._src }
    }
    global.Image = MockImage
    getProxyState().tierStatus.value.wsrv = 'blocked'

    await checkWsrvForUrl('https://example.org/plant.jpg')

    expect(getProxyState().tierStatus.value.wsrv).toBe('ok')
    global.Image = previousImage
  })
})
