// window.ithomiiniMapsExport(): the picture and its metadata from one settled state.
// See docs/field-sites.md.

export const EXPORT_CHANGED_MESSAGE = 'The map changed while the picture was being taken.'

/**
 * `prepare()` readies the map; `capture({ onSettled, onCaptured })` takes the picture
 * (mapImageExport.captureMapImage options); `snapshot()` reads all of the metadata
 * inside onSettled, before the capture; `version()` changes whenever anything the
 * picture or its metadata depends on changes. If it differs between the start of the
 * snapshot and the end of the capture, the attempt is dropped and the export starts
 * again, once; a second change rejects. Nothing is read after the capture.
 * → { output, snapshot, attempts }
 */
export async function runConsistentExport({ prepare, capture, snapshot, version, attempts = 2 }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await prepare(attempt)
    let before = null
    let taken = null
    let unchanged = false
    const output = await capture({
      onSettled: async () => {
        before = version()
        taken = await snapshot()
      },
      onCaptured: async () => { unchanged = before !== null && version() === before },
    })
    if (taken && unchanged) return { output, snapshot: taken, attempts: attempt }
  }
  throw new Error(`${EXPORT_CHANGED_MESSAGE} Tried ${attempts} times; leave the map alone during the export.`)
}
