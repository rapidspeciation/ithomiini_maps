// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Mock useMediaQuery before importing the composable
const mockMobile = ref(false)
const mockTablet = ref(false)
vi.mock('@vueuse/core', () => ({
  useMediaQuery: vi.fn((query) => {
    if (query.includes('max-width: 768px')) return mockMobile
    if (query.includes('min-width: 769px')) return mockTablet
    return ref(false)
  }),
}))

import { useMobileLayout } from '../useMobileLayout'

describe('useMobileLayout', () => {
  let layout

  beforeEach(() => {
    mockMobile.value = false
    mockTablet.value = false
    layout = useMobileLayout()
  })

  describe('breakpoint detection', () => {
    it('detects desktop by default', () => {
      expect(layout.isMobile.value).toBe(false)
      expect(layout.isTablet.value).toBe(false)
      expect(layout.isDesktop.value).toBe(true)
    })

    it('detects mobile', () => {
      mockMobile.value = true
      expect(layout.isMobile.value).toBe(true)
      expect(layout.isDesktop.value).toBe(false)
    })

    it('detects tablet', () => {
      mockTablet.value = true
      expect(layout.isTablet.value).toBe(true)
      expect(layout.isDesktop.value).toBe(false)
    })
  })

  describe('sheet management', () => {
    it('starts with no active sheet', () => {
      expect(layout.activeSheet.value).toBe('none')
      expect(layout.sheetSnapPoint.value).toBe(0.15)
    })

    it('opens a sheet to half snap', () => {
      layout.openSheet('filter')
      expect(layout.activeSheet.value).toBe('filter')
      expect(layout.sheetSnapPoint.value).toBe(0.5)
    })

    it('closes sheet and resets state', () => {
      layout.openSheet('filter')
      layout.closeSheet()
      expect(layout.activeSheet.value).toBe('none')
      expect(layout.sheetSnapPoint.value).toBe(0.15)
      expect(layout.detailPointData.value).toBeNull()
    })

    it('opens detail sheet with point data at peek', () => {
      const point = { species: 'Mechanitis menophilus', lat: -1.5, lng: -77.8 }
      layout.openDetailSheet(point)
      expect(layout.activeSheet.value).toBe('detail')
      expect(layout.sheetSnapPoint.value).toBe(0.15)
      expect(layout.detailPointData.value).toEqual(point)
    })

    it('clears detail point data', () => {
      layout.openDetailSheet({ species: 'test' })
      layout.clearDetailSheet()
      expect(layout.detailPointData.value).toBeNull()
    })

    it('opening non-detail sheet clears detail data', () => {
      layout.openDetailSheet({ species: 'test' })
      layout.openSheet('filter')
      expect(layout.detailPointData.value).toBeNull()
    })
  })

  describe('showActionBar', () => {
    it('is false on desktop', () => {
      expect(layout.showActionBar.value).toBe(false)
    })

    it('is true on mobile with no sheet', () => {
      mockMobile.value = true
      expect(layout.showActionBar.value).toBe(true)
    })

    it('is true on mobile with sheet at low snap', () => {
      mockMobile.value = true
      layout.activeSheet.value = 'filter'
      layout.sheetSnapPoint.value = 0.3
      expect(layout.showActionBar.value).toBe(true)
    })

    it('is false on mobile with sheet past 50%', () => {
      mockMobile.value = true
      layout.activeSheet.value = 'filter'
      layout.sheetSnapPoint.value = 0.9
      expect(layout.showActionBar.value).toBe(false)
    })

    it('is true on mobile with sheet at exactly 50%', () => {
      mockMobile.value = true
      layout.activeSheet.value = 'filter'
      layout.sheetSnapPoint.value = 0.5
      expect(layout.showActionBar.value).toBe(true)
    })
  })
})
