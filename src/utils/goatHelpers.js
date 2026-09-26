const CORRECTION_COLORS = {
  Synonym: '#f59e0b',
  Spelling: '#f97316',
  Subspecies: '#a855f7',
  Reclassified: '#06b6d4'
}

/**
 * Get correction/curation info for a data record
 * @param {Object} item - Data record with curation_status, curated_name, curation_basis fields
 * @returns {Object|null} Correction info with type, label, tooltip
 */
export function getCorrectionInfo(item) {
  const hasNameChange = !!item?.scientific_name_original
  const hasSubspeciesChange = !!item?.subspecies_original

  if (!hasNameChange && !hasSubspeciesChange) return null

  let type = 'Corrected'
  if (hasNameChange && item.curation_status === 'synonym_resolved') {
    type = 'Synonym'
  } else if (hasNameChange && item.curation_status === 'corrected_literature') {
    type = 'Spelling'
  } else if (hasNameChange) {
    type = 'Spelling'
  }

  if (hasSubspeciesChange && !hasNameChange) {
    type = 'Subspecies'
  }

  if (hasNameChange && item.curation_status === 'verified' && hasSubspeciesChange) {
    type = 'Reclassified'
  }

  return {
    type,
    color: CORRECTION_COLORS[type] || '#f59e0b',
    originalName: item.scientific_name_original || null,
    originalSubspecies: item.subspecies_original || null
  }
}

/**
 * Build GoaT species URL
 * @param {string} speciesName - Scientific name
 * @returns {string|null} GoaT URL
 */
export function getGoatUrl(speciesName, getGoatForSpecies) {
  const goat = getGoatForSpecies?.(speciesName)
  if (!goat?.taxon_id) return null
  return `https://goat.genomehubs.org/record?recordId=${goat.taxon_id}&result=taxon&taxonomy=ncbi`
}

/** GoaT returns one BioProject ID, a list, or a JSON-encoded list; keep valid, unique IDs. */
export function parseBioprojectIds(value) {
  if (!value) return []
  let parsed = value
  if (typeof parsed === 'string' && parsed.trim().startsWith('[')) {
    try { parsed = JSON.parse(parsed) } catch { /* fall back to splitting */ }
  }
  const ids = Array.isArray(parsed) ? parsed : String(parsed).split(/[\s,;]+/)
  return [...new Set(ids.map(id => String(id).trim()).filter(id => /^PRJ[A-Z]{2}\d+$/i.test(id)))]
}
