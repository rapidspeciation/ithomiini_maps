import { defineStore, storeToRefs } from 'pinia'
import { useDatasetStore } from './datasetStore'
import { useFilterStore } from './filterStore'
import { useViewStore } from './viewStore'

export const useDataStore = defineStore('data', () => {
  const dataset = useDatasetStore()
  const filters = useFilterStore()
  const view = useViewStore()

  const loadMapData = async () => {
    await dataset.loadMapData()
    filters.restoreFiltersFromURL()
    view.restoreVisualizationFromURL()
    await filters.loadSourcesForFilters()
  }

  const resetAllFilters = () => {
    filters.resetAllFilters()
    view.resetVisualizationState()
  }

  return {
    ...storeToRefs(dataset),
    ...storeToRefs(filters),
    ...storeToRefs(view),

    DEFAULT_HEATMAP_SETTINGS: view.DEFAULT_HEATMAP_SETTINGS,
    DEFAULT_RANGE_SETTINGS: view.DEFAULT_RANGE_SETTINGS,

    loadMapData,
    resetAllFilters,
    setColorBy: view.setColorBy,
    getPhotoForItem: dataset.getPhotoForItem,
    getGoatForSpecies: dataset.getGoatForSpecies,
    hasGoatData: dataset.hasGoatData,
    hasDirectGoatData: dataset.hasDirectGoatData,
    getChromosomeNumber: dataset.getChromosomeNumber,
    formatGenomeSize: dataset.formatGenomeSize,
    filterSpeciesOptions: filters.filterSpeciesOptions,
    getPointsAtCoordinates: view.getPointsAtCoordinates,
    groupPointsBySpecies: view.groupPointsBySpecies,
    getSpeciesWithPhotos: view.getSpeciesWithPhotos,
  }
})
