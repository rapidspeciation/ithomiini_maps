// Old butterfly names -> current names (public/data/taxonomy_name_corrections.json).
// Applied to each occurrence record when it loads, so the map, the filters and the search use the
// current name. The record keeps the name as recorded in scientific_name_original / subspecies_original
// and name_correction, the same fields the data table already shows as a correction.

const isRealSubspecies = (subspecies, scientificName) => Boolean(subspecies)
  && subspecies !== 'Unknown'
  && subspecies !== 'NA'
  && subspecies !== scientificName

const normalizeName = name => String(name || '').trim().replace(/\s+/g, ' ')

/** Map of old name -> correction entry. */
export function buildNameCorrectionIndex(corrections = []) {
  const index = new Map()
  for (const entry of corrections) {
    const oldName = normalizeName(entry?.old_name)
    const currentName = normalizeName(entry?.current_name)
    if (!oldName || !currentName || oldName === currentName) continue
    index.set(oldName, { ...entry, old_name: oldName, current_name: currentName })
  }
  return index
}

/** The full name a record was recorded under: "Genus species" or "Genus species subspecies". */
export function recordedName(item) {
  const scientificName = normalizeName(item?.scientific_name)
  if (!scientificName) return ''
  const subspecies = normalizeName(item?.subspecies)
  return isRealSubspecies(subspecies, scientificName) ? `${scientificName} ${subspecies}` : scientificName
}

/**
 * Rename one record in place when its recorded name has a correction.
 * A current species-rank name clears the subspecies (it becomes null).
 * Returns true when the record changed.
 */
export function applyNameCorrection(item, index) {
  if (!item || !index?.size) return false
  const oldName = recordedName(item)
  const entry = index.get(oldName)
  if (!entry) return false

  const [genus, epithet, subspecies = null] = entry.current_name.split(' ')
  const oldScientificName = normalizeName(item.scientific_name)
  const oldSubspecies = isRealSubspecies(normalizeName(item.subspecies), oldScientificName)
    ? normalizeName(item.subspecies)
    : null
  const newScientificName = `${genus} ${epithet}`

  if (newScientificName !== oldScientificName && !item.scientific_name_original) {
    item.scientific_name_original = oldScientificName
  }
  if (oldSubspecies && subspecies !== oldSubspecies && !item.subspecies_original) {
    item.subspecies_original = oldSubspecies
  }

  item.scientific_name = newScientificName
  item.genus = genus
  item.species = epithet
  item.subspecies = subspecies
  item.name_correction = { recorded_as: oldName, reference: entry.reference || '' }
  return true
}

/** Search entries for the species filter: an old name points to the current species. */
export function nameCorrectionSearchEntries(corrections = []) {
  const entries = []
  for (const entry of buildNameCorrectionIndex(corrections).values()) {
    const [genus, epithet] = entry.current_name.split(' ')
    entries.push({ oldName: entry.old_name, currentName: entry.current_name, accepted: `${genus} ${epithet}` })
  }
  return entries
}
