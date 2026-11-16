import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, markRaw, reactive, computed } from 'vue'
import { normalizeCountryName } from '../utils/clusterStats'
import { usePhotoLookup } from './dataPhotoLookup'
import { useGoatData } from './goatData'
import { log } from '../utils/logger'
import { applyNameCorrection, buildNameCorrectionIndex } from '../utils/nameCorrections'

export const useDatasetStore = defineStore('dataset', () => {
  // shallowRef prevents Vue from deep-proxying 155k+ records (saves ~200MB RAM)
  const allFeatures = shallowRef([])
  const imageSupplement = shallowRef([])
  const taxonomySynonyms = shallowRef([])
  // Old butterfly names -> current names, applied to every record as it loads.
  const taxonomyNameCorrections = shallowRef([])
  let nameCorrectionIndex = new Map()
  let nameCorrectionsLoad = null
  const loadedSources = reactive(new Set())
  const sourceLoading = reactive(new Set())
  const sourceProgress = reactive({})
  const loading = ref(true)
  const manifest = ref(null)

  const FALLBACK_SOURCES = {
    'Sanger Institute': { file: 'map_points_sanger.json', default: true },
    'GBIF (UNAM)': { file: 'map_points_gbif_unam.json', default: false },
    'GBIF (Other Institutions)': { file: 'map_points_gbif_other.json', default: false },
    'Dore et al. (2022)': { file: 'map_points_dore.json', default: false },
    'iNaturalist': { file: 'map_points_inaturalist.json', default: false },
  }

  const sourceConfig = computed(() => {
    const raw = manifest.value?.sources ?? FALLBACK_SOURCES
    if (raw.GBIF && !raw['GBIF (Other Institutions)']) {
      const migrated = { ...raw }
      migrated['GBIF (Other Institutions)'] = { ...migrated.GBIF, file: migrated.GBIF.file }
      delete migrated.GBIF
      return migrated
    }
    return raw
  })

  const imageSupplementFile = computed(() => manifest.value?.image_supplement ?? 'map_points_images.json')
  const recordCount = computed(() => allFeatures.value.length)

  const {
    photoLookup,
    mimicryPhotoLookup,
    gbifCitation,
    rebuildPhotoLookups,
    addPhotosFromData,
    loadGbifCitation,
    getPhotoForItem,
  } = usePhotoLookup(allFeatures, imageSupplement)

  const {
    goatSpecies,
    goatLoaded,
    goatLoading,
    goatMeta,
    loadGoatData,
    getGoatForSpecies,
    hasGoatData,
    hasDirectGoatData,
    getChromosomeNumber,
    formatGenomeSize,
    chromosomeRange,
  } = useGoatData()

  let pendingBatchFeatures = []
  let activeBatchLoads = 0

  const setNameCorrections = (corrections) => {
    taxonomyNameCorrections.value = Array.isArray(corrections) ? corrections : []
    nameCorrectionIndex = buildNameCorrectionIndex(taxonomyNameCorrections.value)
    triggerRef(taxonomyNameCorrections)
  }

  /** Loads the name corrections once; every data load waits for it so no record keeps an old name. */
  const ensureNameCorrections = () => {
    if (!nameCorrectionsLoad) {
      const basePath = import.meta.env.BASE_URL || '/'
      nameCorrectionsLoad = fetch(`${basePath}data/taxonomy_name_corrections.json`)
        .then(res => (res?.ok ? res.json() : { corrections: [] }))
        .then(data => setNameCorrections(data?.corrections))
        .catch((e) => {
          log.data.warn('Name corrections not loaded:', e)
          setNameCorrections([])
          nameCorrectionsLoad = null // let the next source load try again
        })
    }
    return nameCorrectionsLoad
  }

  const normalizeLoadedItem = (item, sourceName) => {
    applyNameCorrection(item, nameCorrectionIndex)
    if (item.country) item.country = normalizeCountryName(item.country)
    if (item.source !== sourceName) item.source = sourceName
    if (!item.subspecies || item.subspecies === 'Unknown' || item.subspecies === 'NA') {
      item.subspecies = item.scientific_name || 'Unknown'
    }
    markRaw(item)
  }

  const loadMapData = async () => {
    loading.value = true
    try {
      const basePath = import.meta.env.BASE_URL || '/'

      try {
        const manifestRes = await fetch(`${basePath}data/data_manifest.json`)
        if (manifestRes.ok) {
          manifest.value = await manifestRes.json()
        }
      } catch {
        // Manifest is optional
      }

      const config = sourceConfig.value
      const defaultSource = Object.entries(config).find(([, v]) => v.default)?.[0]
        ?? Object.keys(config)[0]
      const defaultFile = config[defaultSource]?.file

      const [defaultRes, imgRes, synonymsRes] = await Promise.all([
        fetch(`${basePath}data/${defaultFile}`),
        fetch(`${basePath}data/${imageSupplementFile.value}`),
        fetch(`${basePath}data/taxonomy_synonyms.json`).catch(() => null),
        ensureNameCorrections(),
      ])

      if (!defaultRes.ok) {
        throw new Error(`Failed to load ${defaultSource} data: ${defaultRes.status}`)
      }

      const defaultData = await defaultRes.json()
      const imgData = imgRes.ok ? await imgRes.json() : []
      const synonymsData = synonymsRes?.ok ? await synonymsRes.json() : { synonyms: [] }

      for (const item of defaultData) normalizeLoadedItem(item, defaultSource)

      allFeatures.value = defaultData
      triggerRef(allFeatures)

      for (const item of imgData) {
        applyNameCorrection(item, nameCorrectionIndex)
        markRaw(item)
      }
      imageSupplement.value = imgData
      triggerRef(imageSupplement)
      taxonomySynonyms.value = synonymsData.synonyms || []
      triggerRef(taxonomySynonyms)

      loadedSources.add(defaultSource)
      log.data.info(`✓ Loaded ${defaultData.length} ${defaultSource} records + ${imgData.length} image supplement`)

      rebuildPhotoLookups()
      loadGbifCitation()
      loadGoatData()
    } catch (e) {
      log.data.error('❌ Failed to load data:', e)
      allFeatures.value = []
    } finally {
      loading.value = false
    }
  }

  const loadSource = async (sourceName, { batch = false } = {}) => {
    if (loadedSources.has(sourceName)) return
    if (sourceLoading.has(sourceName)) return

    const fileName = sourceConfig.value[sourceName]?.file
    if (!fileName) return

    sourceLoading.add(sourceName)
    sourceProgress[sourceName] = 0
    if (batch) activeBatchLoads++

    try {
      const basePath = import.meta.env.BASE_URL || '/'
      const response = await fetch(`${basePath}data/${fileName}`)
      if (!response.ok) throw new Error(`${response.status}`)

      // Stream-read so we can surface byte-level progress to the UI.
      // Content-Length is reliable here since we host static JSON on GitHub Pages.
      const contentLength = Number(response.headers.get('Content-Length')) || 0
      const reader = response.body?.getReader()
      let text = ''
      if (reader && contentLength > 0) {
        const decoder = new TextDecoder()
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.length
          text += decoder.decode(value, { stream: true })
          sourceProgress[sourceName] = Math.min(0.99, received / contentLength)
        }
        text += decoder.decode()
      } else {
        // No Content-Length header → fall back to atomic read.
        text = await response.text()
      }
      const data = JSON.parse(text)
      await ensureNameCorrections()
      for (const item of data) normalizeLoadedItem(item, sourceName)

      loadedSources.add(sourceName)
      sourceProgress[sourceName] = 1

      if (batch) {
        pendingBatchFeatures.push(...data)
        log.data.info(`Loaded ${data.length} ${sourceName} records (batch pending: ${pendingBatchFeatures.length})`)
      } else {
        allFeatures.value.push(...data)
        triggerRef(allFeatures)
        log.data.info(`Loaded ${data.length} ${sourceName} records (total: ${allFeatures.value.length})`)
      }

      addPhotosFromData(data)
    } catch (e) {
      log.data.error(`Failed to load ${sourceName}:`, e)
    } finally {
      sourceLoading.delete(sourceName)
      // Keep 1.0 so the bar stays full briefly; schedule cleanup.
      if (sourceProgress[sourceName] !== 1) delete sourceProgress[sourceName]
      else setTimeout(() => { delete sourceProgress[sourceName] }, 400)
      if (batch) {
        activeBatchLoads--
        if (activeBatchLoads === 0 && pendingBatchFeatures.length > 0) {
          log.perf.start('batchFlush')
          allFeatures.value.push(...pendingBatchFeatures)
          triggerRef(allFeatures)
          log.perf.end('batchFlush', `${pendingBatchFeatures.length} records (total: ${allFeatures.value.length})`)
          pendingBatchFeatures = []
        }
      }
    }
  }

  return {
    loading,
    allFeatures,
    imageSupplement,
    taxonomySynonyms,
    taxonomyNameCorrections,
    setNameCorrections,
    loadedSources,
    sourceLoading,
    sourceProgress,
    manifest,
    FALLBACK_SOURCES,
    sourceConfig,
    imageSupplementFile,
    photoLookup,
    mimicryPhotoLookup,
    gbifCitation,
    goatSpecies,
    goatLoaded,
    goatLoading,
    goatMeta,
    recordCount,
    rebuildPhotoLookups,
    addPhotosFromData,
    loadGbifCitation,
    getPhotoForItem,
    loadGoatData,
    getGoatForSpecies,
    hasGoatData,
    hasDirectGoatData,
    getChromosomeNumber,
    formatGenomeSize,
    chromosomeRange,
    loadMapData,
    loadSource,
  }
})
