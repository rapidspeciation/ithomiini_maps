import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import {
  applyNameCorrection,
  buildNameCorrectionIndex,
  nameCorrectionSearchEntries,
  recordedName,
} from '../nameCorrections'
import { getCorrectionInfo } from '../goatHelpers'
import { useDatasetStore } from '../../stores/datasetStore'
import { useFilterStore } from '../../stores/filterStore'

// The shipped table, so the tests check the real old -> current pairs.
const shipped = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../../../public/data/taxonomy_name_corrections.json'),
  'utf8',
))
const index = buildNameCorrectionIndex(shipped.corrections)

const record = (scientificName, subspecies, extra = {}) => ({
  id: 'R1',
  scientific_name: scientificName,
  genus: scientificName.split(' ')[0],
  species: scientificName.split(' ')[1],
  subspecies,
  ...extra,
})

describe('taxonomy_name_corrections.json', () => {
  it('has 49 old names, no chains and no proceriformis, eurydice or dorissides change', () => {
    expect(shipped.corrections).toHaveLength(49)
    const oldNames = new Set(shipped.corrections.map(entry => entry.old_name))
    expect(oldNames.size).toBe(49)
    for (const entry of shipped.corrections) {
      expect(oldNames.has(entry.current_name)).toBe(false)
      expect(entry.reference).not.toBe('')
    }
    const text = JSON.stringify(shipped)
    expect(text).not.toMatch(/proceriformis|eurydice|dorissides/)
  })

  it.each([
    ['Mechanitis messenoides', 'holmgreni', 'Mechanitis messenoides', 'deceptus'],
    ['Mechanitis mazaeus', 'holmgreni', 'Mechanitis messenoides', 'deceptus'],
    ['Hypothyris ninonia', 'mamercus', 'Hypothyris mamercus', 'mamercus'],
    ['Melinaea ethra', 'imitata', 'Melinaea lilis', 'imitata'],
    ['Napeogenes peridia', 'hemimelanea', 'Napeogenes peridia', 'hemimelaena'],
    ['Godyris dircenna', 'dircenna', 'Godyris dircenna', null],
    ['Melinaea lilis', 'scylax', 'Melinaea scylax', null],
  ])('%s %s -> %s %s', (oldSpecies, oldSubspecies, newSpecies, newSubspecies) => {
    const item = record(oldSpecies, oldSubspecies)
    expect(applyNameCorrection(item, index)).toBe(true)
    expect(item.scientific_name).toBe(newSpecies)
    expect(item.genus).toBe(newSpecies.split(' ')[0])
    expect(item.species).toBe(newSpecies.split(' ')[1])
    expect(item.subspecies).toBe(newSubspecies)
    expect(item.name_correction.recorded_as).toBe(`${oldSpecies} ${oldSubspecies}`)
    expect(item.scientific_name_original ?? oldSpecies).toBe(oldSpecies)
  })

  it('leaves current names, kept forms and species-only records alone', () => {
    for (const [species, subspecies] of [
      ['Mechanitis messenoides', 'deceptus'],
      ['Mechanitis polymnia', 'proceriformis'],
      ['Mechanitis polymnia', 'eurydice'],
      ['Melinaea ethra', null],
      ['Hypothyris ninonia', 'daeta'],
    ]) {
      const item = record(species, subspecies)
      const before = { ...item }
      expect(applyNameCorrection(item, index)).toBe(false)
      expect(item).toEqual(before)
    }
  })

  it('keeps an earlier original name and marks the record as renamed', () => {
    const item = record('Hypothyris ninonia', 'mamercus', { scientific_name_original: 'Hypothyris ninonia' })
    applyNameCorrection(item, index)
    expect(item.scientific_name_original).toBe('Hypothyris ninonia')
    const info = getCorrectionInfo(record('Melinaea ethra', 'imitata'))
    expect(info).toBeNull()
    const renamed = record('Melinaea ethra', 'imitata')
    applyNameCorrection(renamed, index)
    expect(getCorrectionInfo(renamed)).toMatchObject({
      type: 'Renamed',
      originalName: 'Melinaea ethra',
      recordedAs: 'Melinaea ethra imitata',
      reference: 'van der Heijden et al. 2025',
    })
  })

  it('reads the recorded name from the species and a real subspecies only', () => {
    expect(recordedName(record('Godyris duillia', 'duillia'))).toBe('Godyris duillia duillia')
    expect(recordedName(record('Godyris duillia', 'Unknown'))).toBe('Godyris duillia')
    expect(recordedName(record('Godyris duillia', 'Godyris duillia'))).toBe('Godyris duillia')
    expect(nameCorrectionSearchEntries(shipped.corrections)).toContainEqual({
      oldName: 'Mechanitis messenoides holmgreni',
      currentName: 'Mechanitis messenoides deceptus',
      accepted: 'Mechanitis messenoides',
    })
  })
})

describe('name corrections in the stores', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renames records when a source loads, so filters only see the current name', async () => {
    const rows = [
      record('Mechanitis messenoides', 'holmgreni', { id: 'D1', source: 'Dore et al. (2022)' }),
      record('Hypothyris ninonia', 'mamercus', { id: 'D2', source: 'Dore et al. (2022)' }),
      record('Mechanitis polymnia', 'proceriformis', { id: 'D3', source: 'Dore et al. (2022)' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('taxonomy_name_corrections.json')) {
        return { ok: true, json: async () => shipped }
      }
      if (String(url).endsWith('map_points_dore.json')) {
        return { ok: true, headers: { get: () => null }, body: null, text: async () => JSON.stringify(rows) }
      }
      return { ok: false, status: 404 }
    }))

    const dataset = useDatasetStore()
    await dataset.loadSource('Dore et al. (2022)')
    const names = dataset.allFeatures.map(item => `${item.scientific_name} ${item.subspecies}`)
    expect(names).toEqual([
      'Mechanitis messenoides deceptus',
      'Hypothyris mamercus mamercus',
      'Mechanitis polymnia proceriformis',
    ])
  })

  it('finds the current species when an old name is typed in the species search', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const dataset = useDatasetStore()
    const filters = useFilterStore()
    dataset.setNameCorrections(shipped.corrections)
    dataset.allFeatures = [
      record('Mechanitis messenoides', 'deceptus', { family: 'Nymphalidae', tribe: 'Ithomiini', source: 'Sanger Institute' }),
      record('Hypothyris mamercus', 'mamercus', { family: 'Nymphalidae', tribe: 'Ithomiini', source: 'Sanger Institute' }),
      record('Hypothyris ninonia', 'daeta', { family: 'Nymphalidae', tribe: 'Ithomiini', source: 'Sanger Institute' }),
      record('Melinaea lilis', 'imitata', { family: 'Nymphalidae', tribe: 'Ithomiini', source: 'Sanger Institute' }),
    ]
    const search = query => filters.filterSpeciesOptions(filters.speciesFilterOptions, query)

    expect(search('holmgreni')).toEqual([
      expect.objectContaining({
        value: 'Mechanitis messenoides',
        synonymMeta: 'old name: Mechanitis mazaeus holmgreni, now Mechanitis messenoides deceptus (+1 more)',
      }),
    ])
    expect(search('Melinaea ethra imitata')).toEqual([
      expect.objectContaining({ value: 'Melinaea lilis', synonym: 'Melinaea ethra imitata' }),
    ])
    expect(search('noinonia').map(option => option.value)).toEqual(['Hypothyris ninonia'])
    // The direct match comes first; the old name Hypothyris ninonia mamercus points to H. mamercus.
    expect(search('ninonia').map(option => option.value)).toEqual(['Hypothyris ninonia', 'Hypothyris mamercus'])
  })
})
