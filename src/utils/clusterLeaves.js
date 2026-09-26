/** Read exact worker membership; spatial proximity is not a substitute for a cluster. */
export async function readClusterLeaves(source, clusterId, count) {
  if (!source || !Number.isInteger(clusterId) || !Number.isFinite(count) || count < 1) return []
  const leaves = await source.getClusterLeaves(clusterId, count, 0)
  return Array.isArray(leaves) ? leaves : []
}
