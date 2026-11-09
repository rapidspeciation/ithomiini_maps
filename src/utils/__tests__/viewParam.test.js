// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { searchWithView } from '../viewParam'

describe('searchWithView', () => {
  it('adds view=table and keeps the other parameters', () => {
    expect(searchWithView('?sp=Mechanitis+messenoides&map_view=-76,-1,5', 'table'))
      .toBe('?sp=Mechanitis+messenoides&map_view=-76%2C-1%2C5&view=table')
  })
  it('drops the parameter for the map, the default view', () => {
    expect(searchWithView('?view=table&sp=A+b', 'map')).toBe('?sp=A+b')
    expect(searchWithView('?view=table', 'map')).toBe('')
    expect(searchWithView('', 'map')).toBe('')
  })
})
