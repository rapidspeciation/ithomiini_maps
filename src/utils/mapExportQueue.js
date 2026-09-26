const exportQueues = new WeakMap()

// R and image captures both temporarily mutate map rendering. Serialize them
// per map and continue the queue even when an earlier export fails.
export function withMapExport(map, callback) {
  const previous = exportQueues.get(map) || Promise.resolve()
  const next = previous.catch(() => {}).then(callback)
  exportQueues.set(map, next)
  const cleanup = () => { if (exportQueues.get(map) === next) exportQueues.delete(map) }
  next.then(cleanup, cleanup)
  return next
}
