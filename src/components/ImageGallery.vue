<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useDataStore } from '../stores/data'
import { useHostPlantStore } from '../stores/hostPlants'
import { getThumbnailUrl, getImageUrlCandidates, notifyTierFailed, getProxyState, checkWsrvForUrl } from '../utils/imageProxy'
import { useGalleryData } from '../composables/useGalleryData'
import { useHostPlantGalleryData } from '../composables/useHostPlantGalleryData'
import GallerySidebar from './GallerySidebar.vue'
import GalleryThumbnailStrip from './GalleryThumbnailStrip.vue'
import Panzoom from '@panzoom/panzoom'

const store = useDataStore()
const hostPlantStore = useHostPlantStore()
const props = defineProps({
  initialMode: {
    type: String,
    default: 'butterflies',
  },
})
const emit = defineEmits(['close'])
const proxyState = getProxyState()
const galleryMode = ref(props.initialMode === 'host-plants' ? 'host-plants' : 'butterflies')

const galleryItemKey = (item) => item?.gallery_id || `${item?.id || ''}|${item?.image_url || ''}`

// Gallery data from composable
const butterflyGallery = useGalleryData(store)
const hostPlantGallery = useHostPlantGalleryData(hostPlantStore)
const activeGallery = computed(() => galleryMode.value === 'host-plants' ? hostPlantGallery : butterflyGallery)
const allFilteredIndividuals = computed(() => activeGallery.value.allFilteredIndividuals.value)
const specimensWithImages = computed(() => activeGallery.value.specimensWithImages.value)
const groupedBySpecies = computed(() => activeGallery.value.groupedBySpecies.value)
const speciesList = computed(() => activeGallery.value.speciesList.value)
const totalSpecies = computed(() => activeGallery.value.totalSpecies.value)
const totalIndividuals = computed(() => activeGallery.value.totalIndividuals.value)
const allFilteredTotal = computed(() => activeGallery.value.allFilteredTotal.value)
const allFilteredWithoutImages = computed(() => activeGallery.value.allFilteredWithoutImages.value)
const totalSubspeciesCount = computed(() => activeGallery.value.totalSubspeciesCount.value)
const groupedThumbnails = computed(() => activeGallery.value.groupedThumbnails.value)
const isUnfilteredHostGallery = computed(() =>
  galleryMode.value === 'host-plants' && hostPlantStore.selectedTaxonSlugs.length === 0
)
const isHostGalleryLoading = computed(() =>
  galleryMode.value === 'host-plants' &&
  (
    hostPlantStore.loading ||
    hostPlantStore.galleryLoading ||
    !hostPlantStore.galleryDataset
  )
)

// Gallery state
const currentIndex = ref(0)
const isLoading = ref(true)
const loadError = ref(false)
const zoomLevel = ref(1)
const isPanned = ref(false)
const canResetView = computed(() => zoomLevel.value > 1.05 || isPanned.value)

// Sidebar state
const selectedSpecies = ref(null)
const selectedSubspecies = ref(null)

// Mobile: the filter/info sidebar opens as a slide-in drawer.
const showMobileGallerySidebar = ref(false)

// Thumbnail strip state - all collapsed by default (populated on mount)
const collapsedSpecies = ref(new Set())
const collapsedSubspecies = ref(new Set())
const thumbnailStripRef = ref(null)
const stripInitialized = ref(false)
const skipAutoExpand = ref(false)

// Refs
const imageContainer = ref(null)
const imageEl = ref(null)
const displayedImageUrl = ref('')

// Panzoom instance
let panzoomInstance = null
let panzoomElement = null
let imageLoadAttempt = 0
let directFallbackTimer = null
let directFallbackProbes = []

const updatePanState = (detail = null) => {
  const pan = detail || panzoomInstance?.getPan?.() || {}
  const x = Number(pan.x ?? 0)
  const y = Number(pan.y ?? 0)
  isPanned.value = Math.abs(x) > 1 || Math.abs(y) > 1
}

const handlePanzoomZoom = (e) => {
  zoomLevel.value = e.detail.scale
  updatePanState(e.detail)
}

const handlePanzoomPan = (e) => {
  updatePanState(e.detail)
}

const handlePanzoomReset = () => {
  zoomLevel.value = 1
  isPanned.value = false
}

const destroyPanzoom = () => {
  if (panzoomElement) {
    panzoomElement.removeEventListener('panzoomzoom', handlePanzoomZoom)
    panzoomElement.removeEventListener('panzoompan', handlePanzoomPan)
    panzoomElement.removeEventListener('panzoomreset', handlePanzoomReset)
    panzoomElement = null
  }
  if (panzoomInstance) {
    panzoomInstance.destroy()
    panzoomInstance = null
  }
}

const clearDirectFallbackTimer = () => {
  if (directFallbackTimer) {
    clearTimeout(directFallbackTimer)
    directFallbackTimer = null
  }
}

const clearDirectFallbackProbes = () => {
  directFallbackProbes.forEach(img => {
    img.onload = null
    img.onerror = null
    img.src = ''
  })
  directFallbackProbes = []
}

const ensureHostPlantGalleryData = async () => {
  if (galleryMode.value !== 'host-plants') return
  await hostPlantStore.loadMetadata()
  await hostPlantStore.loadGallery()
  const sample = hostPlantGallery.specimensWithImages.value.find(item => item.image_url)
  if (sample?.image_url) checkWsrvForUrl(sample.image_url)
}

const setGalleryMode = async (mode) => {
  const nextMode = mode === 'host-plants' ? 'host-plants' : 'butterflies'
  if (galleryMode.value === nextMode) return
  galleryMode.value = nextMode
  currentIndex.value = 0
  selectedSpecies.value = null
  selectedSubspecies.value = null
  stripInitialized.value = false
  await ensureHostPlantGalleryData()
  resetView()
  nextTick(() => {
    initializeThumbnailStrip()
    initializeSidebarFromCurrent({ expandCurrent: !isUnfilteredHostGallery.value })
  })
}

// Get subspecies list for selected species
const subspeciesList = computed(() => {
  if (!selectedSpecies.value || !groupedBySpecies.value[selectedSpecies.value]) {
    return []
  }
  const speciesGroup = groupedBySpecies.value[selectedSpecies.value]
  return Object.entries(speciesGroup.subspecies)
    .map(([name, data]) => ({
      name,
      count: data.count,
      hasPhoto: data.individuals.some(i => i.image_url)
    }))
    .filter(s => s.hasPhoto)
    .sort((a, b) => b.count - a.count)
})

// Get individuals list for selected species+subspecies (only those with images)
const individualsList = computed(() => {
  if (!selectedSpecies.value || !groupedBySpecies.value[selectedSpecies.value]) {
    return specimensWithImages.value
  }
  const speciesGroup = groupedBySpecies.value[selectedSpecies.value]

  if (selectedSubspecies.value && speciesGroup.subspecies[selectedSubspecies.value]) {
    return speciesGroup.subspecies[selectedSubspecies.value].individuals.filter(i => i.image_url)
  }

  return Object.values(speciesGroup.subspecies)
    .flatMap(s => s.individuals)
    .filter(i => i.image_url)
})

// Handle species selection
const selectSpecies = (species) => {
  selectedSpecies.value = species

  if (species && groupedBySpecies.value[species]) {
    const speciesGroup = groupedBySpecies.value[species]
    const subspeciesNames = Object.keys(speciesGroup.subspecies)

    const sortedSubspecies = subspeciesNames
      .map(name => ({
        name,
        hasPhoto: speciesGroup.subspecies[name].individuals.some(i => i.image_url)
      }))
      .filter(s => s.hasPhoto)

    if (sortedSubspecies.length > 0) {
      selectedSubspecies.value = sortedSubspecies[0].name
    } else {
      selectedSubspecies.value = null
    }
  } else {
    selectedSubspecies.value = null
  }

  updateCurrentIndexFromSelection()
}

// Handle subspecies selection
const selectSubspecies = (subspecies) => {
  selectedSubspecies.value = subspecies
  updateCurrentIndexFromSelection()
}

// Update currentIndex when species/subspecies selection changes
const updateCurrentIndexFromSelection = () => {
  const list = individualsList.value
  if (list.length > 0) {
    const firstIndividual = list[0]
    const idx = specimensWithImages.value.findIndex(s => galleryItemKey(s) === galleryItemKey(firstIndividual))
    if (idx >= 0) {
      currentIndex.value = idx
      resetView()
    }
  }
}

// Handle individual selection (by per-photo gallery key)
// When autoExpand is false, the group won't auto-expand when selecting
const selectIndividual = (key, autoExpand = true) => {
  if (!autoExpand) {
    skipAutoExpand.value = true
  }
  const idx = specimensWithImages.value.findIndex(s => galleryItemKey(s) === key)
  if (idx >= 0) {
    if (idx === currentIndex.value) {
      if (!autoExpand) skipAutoExpand.value = false
      return
    }
    currentIndex.value = idx
    resetView()
  }
}

// Initialize sidebar selection from current specimen
const initializeSidebarFromCurrent = ({ expandCurrent = true } = {}) => {
  const specimen = currentSpecimen.value
  if (!specimen) return

  selectedSpecies.value = specimen.scientific_name
  selectedSubspecies.value = specimen.subspecies

  if (expandCurrent) {
    expandOnly(specimen.scientific_name, specimen.subspecies)
  }
}

// Subspecies count for sidebar
const subspeciesCount = computed(() => subspeciesList.value.length)

// Initialize all species/subspecies as collapsed
const collapseAll = () => {
  const allSpecies = new Set()
  const allSubspecies = new Set()

  groupedThumbnails.value.forEach(speciesGroup => {
    allSpecies.add(speciesGroup.name)
    speciesGroup.subspecies.forEach(subspGroup => {
      allSubspecies.add(`${speciesGroup.name}|${subspGroup.name}`)
    })
  })

  collapsedSpecies.value = allSpecies
  collapsedSubspecies.value = allSubspecies
}

// Expand only a specific species and subspecies (keeping others collapsed)
const expandOnly = (species, subspecies) => {
  // Start with all collapsed
  collapseAll()

  // Expand the target species
  if (species) {
    const newSpeciesSet = new Set(collapsedSpecies.value)
    newSpeciesSet.delete(species)
    collapsedSpecies.value = newSpeciesSet
  }

  // Expand the target subspecies
  if (species && subspecies) {
    const key = `${species}|${subspecies}`
    const newSubspSet = new Set(collapsedSubspecies.value)
    newSubspSet.delete(key)
    collapsedSubspecies.value = newSubspSet
  }
}

// Toggle collapsed state for species
const toggleSpeciesCollapse = (speciesName) => {
  const newSet = new Set(collapsedSpecies.value)
  if (newSet.has(speciesName)) {
    newSet.delete(speciesName)
    const group = groupedThumbnails.value.find(item => item.name === speciesName)
    if (group?.subspecies?.length === 1) {
      const onlySubspecies = group.subspecies[0]
      const subspSet = new Set(collapsedSubspecies.value)
      subspSet.delete(`${speciesName}|${onlySubspecies.name}`)
      collapsedSubspecies.value = subspSet
    }
  } else {
    newSet.add(speciesName)
  }
  collapsedSpecies.value = newSet
}

// Toggle collapsed state for subspecies
const toggleSubspeciesCollapse = (key) => {
  const newSet = new Set(collapsedSubspecies.value)
  if (newSet.has(key)) {
    newSet.delete(key)
  } else {
    newSet.add(key)
  }
  collapsedSubspecies.value = newSet
}

// Position thumbnail strip to show active thumbnail (instant, no animation)
const positionToActiveThumbnail = () => {
  thumbnailStripRef.value?.positionToActiveThumbnail()
}

// Location name from current individual
const locationName = computed(() => {
  const point = currentSpecimen.value
  return point?.collection_location || point?.locality || point?.location || null
})

// Coordinates from current individual
const coordinates = computed(() => {
  const point = currentSpecimen.value
  if (point?.lat && point?.lng) {
    return { lat: point.lat, lng: point.lng }
  }
  if (point?.latitude && point?.longitude) {
    return { lat: point.latitude, lng: point.longitude }
  }
  return null
})


const currentHostSlug = computed(() => currentSpecimen.value?.host_taxon_slug || null)
const currentHostGalleryIndex = computed(() => {
  const slug = currentHostSlug.value
  return slug ? hostPlantStore.galleryIndexCache?.[slug] : null
})
const currentHostLoadedLimit = computed(() => {
  const slug = currentHostSlug.value
  return slug ? (hostPlantStore.galleryVisibleLimitBySlug?.[slug] || 0) : 0
})
const currentHostTotalImages = computed(() => currentHostGalleryIndex.value?.total_images || 0)
const canLoadMoreHostImages = computed(() =>
  galleryMode.value === 'host-plants' &&
  currentHostSlug.value &&
  currentHostTotalImages.value > currentHostLoadedLimit.value
)
const loadMoreHostImages = async (slug = currentHostSlug.value) => {
  if (!slug) return
  const speciesSnapshot = new Set(collapsedSpecies.value)
  const subspeciesSnapshot = new Set(collapsedSubspecies.value)
  const selectedSpeciesSnapshot = selectedSpecies.value
  const selectedSubspeciesSnapshot = selectedSubspecies.value
  await hostPlantStore.loadMoreGalleryForSlug(slug, 10)
  collapsedSpecies.value = speciesSnapshot
  collapsedSubspecies.value = subspeciesSnapshot
  selectedSpecies.value = selectedSpeciesSnapshot
  selectedSubspecies.value = selectedSubspeciesSnapshot
}

const hostPhotoOrderOptions = computed(() =>
  hostPlantStore.galleryPhotoContextOrder
    .map(key => hostPlantStore.galleryPhotoContextOptions.find(option => option.key === key))
    .filter(Boolean)
)

const moveHostPhotoOrder = (key, direction) => {
  hostPlantStore.moveGalleryPhotoContext(key, direction)
  nextTick(() => {
    initializeThumbnailStrip()
    initializeSidebarFromCurrent({ expandCurrent: !isUnfilteredHostGallery.value })
  })
}

// Current specimen
const currentSpecimen = computed(() => {
  return specimensWithImages.value[currentIndex.value] || null
})

const currentImageCandidates = computed(() => {
  void proxyState.mode.value
  void proxyState.tierStatus.value
  return currentSpecimen.value?.image_url
    ? getImageUrlCandidates(currentSpecimen.value.image_url, { width: 2000 })
    : []
})

const startDirectFallbackRace = (attemptId, primaryUrl, candidates) => {
  clearDirectFallbackTimer()
  clearDirectFallbackProbes()
  const fallbacks = candidates.filter(url => url && url !== primaryUrl)
  if (!primaryUrl || fallbacks.length === 0) return

  directFallbackTimer = setTimeout(() => {
    let settled = false
    fallbacks.forEach(url => {
      const probe = new Image()
      directFallbackProbes.push(probe)
      probe.referrerPolicy = 'no-referrer'
      probe.onload = () => {
        if (settled || attemptId !== imageLoadAttempt || !isLoading.value) return
        settled = true
        clearDirectFallbackProbes()
        notifyTierFailed(primaryUrl)
        displayedImageUrl.value = url
      }
      probe.onerror = () => {
        if (attemptId !== imageLoadAttempt) return
        notifyTierFailed(url)
      }
      probe.src = url
    })
  }, 3000)
}

const startImageLoad = () => {
  const specimenUrl = currentSpecimen.value?.image_url || ''
  const candidates = currentImageCandidates.value
  const primaryUrl = candidates[0] || ''
  imageLoadAttempt += 1
  const attemptId = imageLoadAttempt
  clearDirectFallbackTimer()
  clearDirectFallbackProbes()
  displayedImageUrl.value = primaryUrl

  if (!specimenUrl || !primaryUrl) {
    isLoading.value = false
    loadError.value = Boolean(specimenUrl)
    return
  }

  isLoading.value = true
  loadError.value = false
  startDirectFallbackRace(attemptId, primaryUrl, candidates)
}

// Proxy-version counter — forces re-evaluation of thumbnail URLs in v-for
const proxyVersion = computed(() =>
  `${proxyState.mode.value}-${JSON.stringify(proxyState.tierStatus.value)}`
)

// Thumbnail URL helper — reactive wrapper for use in v-for templates
const resolvedThumbUrl = (url) => {
  void proxyVersion.value
  return getThumbnailUrl(url)
}

const thumbCandidateCache = new Map()
const resolvedThumbCandidates = (url) => {
  const version = proxyVersion.value
  const key = `${version}|${url}`
  if (!thumbCandidateCache.has(key)) {
    thumbCandidateCache.set(key, getImageUrlCandidates(url, { width: 400 }))
  }
  return thumbCandidateCache.get(key)
}

// Navigation
const hasPrev = computed(() => currentIndex.value > 0)
const hasNext = computed(() => currentIndex.value < specimensWithImages.value.length - 1)

const goToPrev = () => {
  if (hasPrev.value) {
    currentIndex.value--
    resetView()
  }
}

const goToNext = () => {
  if (hasNext.value) {
    currentIndex.value++
    resetView()
  }
}

const goToIndex = (idx) => {
  currentIndex.value = idx
  resetView()
}

// Reset view state
const resetView = () => {
  isLoading.value = true
  loadError.value = false
  zoomLevel.value = 1
  isPanned.value = false
  startImageLoad()
  // Reset panzoom if it exists
  if (panzoomInstance) {
    panzoomInstance.reset({ animate: false })
  }
}

// Initialize panzoom on image
const initPanzoom = () => {
  if (!imageEl.value) return

  destroyPanzoom()

  panzoomInstance = Panzoom(imageEl.value, {
    maxScale: 5,
    minScale: 1,
    cursor: 'grab'
  })

  // Enable wheel zoom on container
  imageContainer.value?.addEventListener('wheel', handleWheel, { passive: false })

  // Track zoom level changes
  panzoomElement = imageEl.value
  panzoomElement.addEventListener('panzoomzoom', handlePanzoomZoom)
  panzoomElement.addEventListener('panzoompan', handlePanzoomPan)
  panzoomElement.addEventListener('panzoomreset', handlePanzoomReset)
  updatePanState()
}

const handleWheel = (e) => {
  if (panzoomInstance) {
    e.preventDefault()
    panzoomInstance.zoomWithWheel(e)
  }
}

// Image loaded handler
const onImageLoad = () => {
  clearDirectFallbackTimer()
  clearDirectFallbackProbes()
  isLoading.value = false
  loadError.value = false
  nextTick(() => {
    initPanzoom()
  })
}

const onImageError = () => {
  // In auto mode, mark the current tier as blocked and retry with next tier
  const currentUrl = displayedImageUrl.value
  const candidates = currentImageCandidates.value
  const currentCandidateIndex = candidates.indexOf(currentUrl)
  const nextUrl = candidates[currentCandidateIndex + 1]

  if (currentUrl && nextUrl) {
    notifyTierFailed(currentUrl)
    clearDirectFallbackTimer()
    clearDirectFallbackProbes()
    displayedImageUrl.value = nextUrl
    isLoading.value = true
    loadError.value = false
    return
  }

  if (proxyState.mode.value === 'auto' && currentUrl) {
    const ts = proxyState.tierStatus.value
    // Only retry if there's a tier below that isn't blocked yet
    const hasLowerTier =
      (currentUrl.includes('wsrv.nl') && ts.lh3 !== 'blocked') ||
      (currentUrl.includes('lh3.google') && ts.thumbnail !== 'blocked')
    if (hasLowerTier) {
      notifyTierFailed(currentUrl)
      startImageLoad()
      return
    }
  }
  // No more fallbacks — show error
  if (currentUrl) notifyTierFailed(currentUrl)
  isLoading.value = false
  loadError.value = true
}

// Zoom controls
const zoomIn = () => {
  if (panzoomInstance) {
    panzoomInstance.zoomIn({ animate: true })
  }
}

const zoomOut = () => {
  if (panzoomInstance) {
    panzoomInstance.zoomOut({ animate: true })
  }
}

const resetZoom = () => {
  if (panzoomInstance) {
    panzoomInstance.reset({ animate: true })
    isPanned.value = false
    zoomLevel.value = 1
  }
}

// View on map - set focus point and close gallery
const viewOnMap = () => {
  if (!currentSpecimen.value || !coordinates.value) return

  // Set the focus point in the store
  store.focusPoint = {
    lat: coordinates.value.lat,
    lng: coordinates.value.lng,
    properties: currentSpecimen.value
  }

  // Close the gallery
  emit('close')
}

// Keyboard navigation
const onKeyDown = (e) => {
  switch (e.key) {
    case 'ArrowLeft':
      goToPrev()
      break
    case 'ArrowRight':
      goToNext()
      break
    case 'Escape':
      if (canResetView.value) {
        resetZoom()
      } else {
        emit('close')
      }
      break
    case '+':
    case '=':
      zoomIn()
      break
    case '-':
      zoomOut()
      break
  }
}

// Handle pre-selection from store (when opening from popup)
const handleGallerySelection = () => {
  const selection = store.gallerySelection
  if (!selection) return

  if (selection.mode) {
    galleryMode.value = selection.mode === 'host-plants' ? 'host-plants' : 'butterflies'
  }

  // Set species and subspecies from selection
  const targetSpecies = selection.hostTaxon || selection.species
  if (targetSpecies) {
    selectedSpecies.value = targetSpecies
  }
  if (selection.subspecies) {
    selectedSubspecies.value = selection.subspecies
  }

  // Find and select the individual by ID
  const targetIndividual = selection.occurrenceId || selection.individualId
  if (targetIndividual) {
    const idx = specimensWithImages.value.findIndex(s => String(s.id) === String(targetIndividual) || galleryItemKey(s) === String(targetIndividual))
    if (idx >= 0) {
      currentIndex.value = idx
    } else if (targetSpecies) {
      updateCurrentIndexFromSelection()
    }
  } else if (targetSpecies) {
    // If no individual ID, find first individual of the species/subspecies with image
    updateCurrentIndexFromSelection()
  }

  // Expand only the selected species/subspecies (others stay collapsed)
  expandOnly(targetSpecies, selection.subspecies)

  // Clear the selection after handling
  store.gallerySelection = null

  // Position to active thumbnail instantly (no smooth scroll to avoid loading all images)
  positionToActiveThumbnail()
}

// Initialize thumbnail strip - collapse all by default
const initializeThumbnailStrip = () => {
  if (stripInitialized.value) return
  collapseAll()
  stripInitialized.value = true
}

// Setup/cleanup
onMounted(async () => {
  document.addEventListener('keydown', onKeyDown)
  await ensureHostPlantGalleryData()

  // Initialize thumbnail strip with all collapsed
  nextTick(() => {
    initializeThumbnailStrip()
  })

  // Check for gallery selection from popup
  if (store.gallerySelection) {
    handleGallerySelection()
  } else {
    initializeSidebarFromCurrent({ expandCurrent: !isUnfilteredHostGallery.value })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  imageLoadAttempt += 1
  clearDirectFallbackTimer()
  clearDirectFallbackProbes()
  destroyPanzoom()
  imageContainer.value?.removeEventListener('wheel', handleWheel)
})

watch(currentImageCandidates, () => {
  startImageLoad()
}, { immediate: true })

// Watch for filter changes
watch(() => store.filteredGeoJSON, () => {
  if (galleryMode.value !== 'butterflies') return
  currentIndex.value = 0
  resetView()
  // Reset strip initialization flag so it re-collapses
  stripInitialized.value = false
  nextTick(() => {
    initializeThumbnailStrip()
    initializeSidebarFromCurrent()
  })
})

watch(() => hostPlantStore.galleryDataset, () => {
  if (galleryMode.value !== 'host-plants') return
  currentIndex.value = 0
  resetView()
  stripInitialized.value = false
  nextTick(() => {
    initializeThumbnailStrip()
    initializeSidebarFromCurrent({ expandCurrent: !isUnfilteredHostGallery.value })
  })
})

watch(() => props.initialMode, (mode) => {
  setGalleryMode(mode)
})

// Watch for currentIndex changes to sync sidebar and expand current group
watch(currentIndex, () => {
  const specimen = currentSpecimen.value
  if (specimen) {
    const speciesChanged = specimen.scientific_name !== selectedSpecies.value
    const subspeciesChanged = specimen.subspecies !== selectedSubspecies.value

    if (speciesChanged) {
      selectedSpecies.value = specimen.scientific_name
    }
    if (subspeciesChanged) {
      selectedSubspecies.value = specimen.subspecies
    }

    // If navigating to a different species/subspecies, expand that group (unless skipAutoExpand is set)
    if ((speciesChanged || subspeciesChanged) && !skipAutoExpand.value) {
      // Expand the new species if collapsed
      if (specimen.scientific_name && collapsedSpecies.value.has(specimen.scientific_name)) {
        const newSet = new Set(collapsedSpecies.value)
        newSet.delete(specimen.scientific_name)
        collapsedSpecies.value = newSet
      }

      // Expand the new subspecies if collapsed
      if (specimen.scientific_name && specimen.subspecies) {
        const key = `${specimen.scientific_name}|${specimen.subspecies}`
        if (collapsedSubspecies.value.has(key)) {
          const newSet = new Set(collapsedSubspecies.value)
          newSet.delete(key)
          collapsedSubspecies.value = newSet
        }
      }

      // Position to the thumbnail
      positionToActiveThumbnail()
    }

    // Reset the skip flag
    skipAutoExpand.value = false
  }
})
</script>

<template>
  <div class="image-gallery">
    <!-- Close button -->
    <button class="btn-close" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </button>

    <!-- Mobile: open the info/filters drawer -->
    <button class="btn-gallery-filters" @click="showMobileGallerySidebar = true" aria-label="Info and filters">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>Info</span>
    </button>

    <!-- Mobile: butterflies / host-plants toggle, surfaced outside the drawer -->
    <div class="gallery-mode-toggle-floating">
      <button :class="{ active: galleryMode === 'butterflies' }" @click="setGalleryMode('butterflies')">Butterflies</button>
      <button :class="{ active: galleryMode === 'host-plants' }" @click="setGalleryMode('host-plants')">Host Plants</button>
    </div>

    <!-- Mobile drawer backdrop -->
    <div v-if="showMobileGallerySidebar" class="gallery-sidebar-backdrop" @click="showMobileGallerySidebar = false"></div>

    <!-- Empty state -->
    <div v-if="isHostGalleryLoading" class="empty-state">
      <div class="spinner"></div>
      <h3>Loading Host Plant Images</h3>
      <p>Preparing the host plant occurrence gallery.</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="specimensWithImages.length === 0" class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <h3>No Images Available</h3>
      <p>
        {{ galleryMode === 'host-plants'
          ? 'No host plant occurrence images are available for the current plant filter.'
          : 'No specimens in the current filter have images attached.' }}
      </p>
      <button class="btn-back" @click="emit('close')">Back to Map</button>
    </div>

    <!-- Main gallery -->
    <template v-else>
      <!-- Gallery layout with sidebar -->
      <div class="gallery-layout">
        <!-- Sidebar -->
        <GallerySidebar
          :current-specimen="currentSpecimen"
          :current-specimen-key="galleryItemKey(currentSpecimen)"
          :selected-species="selectedSpecies"
          :selected-subspecies="selectedSubspecies"
          :species-list="speciesList"
          :subspecies-list="subspeciesList"
          :individuals-list="individualsList"
          :total-species="totalSpecies"
          :total-individuals="totalIndividuals"
          :total-subspecies-count="totalSubspeciesCount"
          :all-filtered-total="allFilteredTotal"
          :all-filtered-without-images="allFilteredWithoutImages"
          :coordinates="coordinates"
          :location-name="locationName"
          :mode="galleryMode"
          :photo-order-options="hostPhotoOrderOptions"
          :date-order="hostPlantStore.galleryDateOrder"
          :mobile-open="showMobileGallerySidebar"
          @select-species="selectSpecies"
          @select-subspecies="selectSubspecies"
          @select-individual="selectIndividual"
          @view-on-map="viewOnMap"
          @move-photo-order="moveHostPhotoOrder"
          @set-date-order="hostPlantStore.setGalleryDateOrder"
          @set-gallery-mode="setGalleryMode"
          @close-mobile="showMobileGallerySidebar = false"
        />

        <!-- Image viewer wrapper (for positioning nav buttons) -->
        <div class="image-viewer-wrapper">
          <!-- Image viewer -->
          <div
            ref="imageContainer"
            class="image-viewer"
          >
            <!-- Loading spinner -->
            <div v-if="isLoading" class="image-loading">
              <div class="spinner"></div>
            </div>

            <!-- Error state -->
            <div v-else-if="loadError" class="image-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p>Failed to load image</p>
            </div>

            <!-- Image (hidden while loading) -->
            <img
              v-if="currentSpecimen?.image_url"
              v-show="!isLoading && !loadError"
              ref="imageEl"
              :src="displayedImageUrl"
              referrerpolicy="no-referrer"
              :alt="currentSpecimen.scientific_name"
              class="gallery-image"
              decoding="async"
              @load="onImageLoad"
              @error="onImageError"
              draggable="false"
            />
          </div>

          <!-- Navigation arrows (inside wrapper) -->
          <button
            class="nav-btn nav-prev"
            :disabled="!hasPrev"
            @click="goToPrev"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>

          <button
            class="nav-btn nav-next"
            :disabled="!hasNext"
            @click="goToNext"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </button>

          <!-- Zoom controls -->
          <div class="zoom-controls">
            <button @click="zoomOut" :disabled="zoomLevel <= 1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <span class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</span>
            <button @click="zoomIn" :disabled="zoomLevel >= 5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
                <line x1="11" y1="8" x2="11" y2="14"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <button @click="resetZoom" :disabled="!canResetView" class="reset-btn">
              Reset
            </button>
          </div>

          <!-- Image counter -->
          <div class="image-counter">
            {{ currentIndex + 1 }} / {{ specimensWithImages.length }}
          </div>

        </div>
      </div>

      <GalleryThumbnailStrip
        v-if="specimensWithImages.length > 1"
        ref="thumbnailStripRef"
        :grouped-thumbnails="groupedThumbnails"
        :current-item="currentSpecimen"
        :collapsed-species="collapsedSpecies"
        :collapsed-subspecies="collapsedSubspecies"
        :thumb-url="resolvedThumbUrl"
        :thumb-candidates="resolvedThumbCandidates"
        @toggle-species="toggleSpeciesCollapse"
        @toggle-subspecies="toggleSubspeciesCollapse"
        @select-individual="selectIndividual"
        @load-more-host="loadMoreHostImages"
      />
    </template>
  </div>
</template>


<style scoped src="./image-gallery-styles.css"></style>
