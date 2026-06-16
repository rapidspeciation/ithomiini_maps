import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useScatterVisualization } from '../dataPointGrouping'

describe('dataPointGrouping', () => {
  it('groups popup individuals by unique occurrence while preserving record counts', () => {
    const geo = ref({ type: 'FeatureCollection', features: [] })
    const { groupPointsBySpecies, getSpeciesWithPhotos } = useScatterVisualization(
      geo,
      ref(false),
      ref(false)
    )

    const points = [
      { id: 'occ-1', scientific_name: 'Mechanitis polymnia', subspecies: 'polymnia' },
      { id: 'occ-1', scientific_name: 'Mechanitis polymnia', subspecies: 'polymnia', image_url: 'photo.jpg' },
      { id: 'occ-2', scientific_name: 'Mechanitis polymnia', subspecies: 'polymnia' },
      { id: 'occ-3', scientific_name: 'Ithomia agnosia', subspecies: null }
    ]

    const grouped = groupPointsBySpecies(points)
    const mechanitis = grouped['Mechanitis polymnia']
    const mechanitisSubsp = mechanitis.subspecies.polymnia

    expect(mechanitis.recordCount).toBe(3)
    expect(mechanitis.count).toBe(2)
    expect(mechanitisSubsp.recordCount).toBe(3)
    expect(mechanitisSubsp.count).toBe(2)
    expect(mechanitisSubsp.individuals).toHaveLength(2)
    expect(mechanitisSubsp.individuals[0].image_url).toBe('photo.jpg')

    const species = getSpeciesWithPhotos(points)
    expect(species.find(s => s.species === 'Mechanitis polymnia')).toMatchObject({
      count: 2,
      recordCount: 3
    })
  })
})
