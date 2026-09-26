import { describe, expect, it } from 'vitest'
import { parseBioprojectIds } from '../goatHelpers'

describe('parseBioprojectIds', () => {
  it('accepts a single ID, a list, or a JSON-encoded list', () => {
    expect(parseBioprojectIds('PRJEB43745')).toEqual(['PRJEB43745'])
    expect(parseBioprojectIds(['PRJEB43745', 'PRJNA1015221'])).toEqual(['PRJEB43745', 'PRJNA1015221'])
    expect(parseBioprojectIds('[ "PRJEB43745", "PRJEB75669", "PRJEB43745" ]')).toEqual(['PRJEB43745', 'PRJEB75669'])
  })

  it('drops empty and malformed values', () => {
    expect(parseBioprojectIds(null)).toEqual([])
    expect(parseBioprojectIds('not an id, PRJEB1')).toEqual(['PRJEB1'])
  })
})
