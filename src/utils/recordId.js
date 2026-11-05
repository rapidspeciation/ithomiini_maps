/**
 * Record ids. Specimens the collection sheet lists without a CAM ID ('NOT GIVEN', blank) get a
 * synthetic id NOID-<SOURCE>-<hash> in scripts/process_data.py, so every record stays unique.
 * The app shows those as "No ID" and keeps the synthetic id for exports and tooltips.
 */
export const SYNTHETIC_ID_PREFIX = 'NOID-'
export const NO_ID_LABEL = 'No ID'

export const isSyntheticId = id => typeof id === 'string' && id.startsWith(SYNTHETIC_ID_PREFIX)

export function displayRecordId(id, fallback = 'N/A') {
  if (id === null || id === undefined || id === '') return fallback
  return isSyntheticId(id) ? NO_ID_LABEL : String(id)
}

/** Tooltip for an id cell: the synthetic key is shown here only, never as the label. */
export const recordIdTitle = id => (isSyntheticId(id) ? `No CAM ID in the sheet (record key ${id})` : undefined)
