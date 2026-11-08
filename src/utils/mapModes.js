// The four ways the map draws the filtered records (stores/viewStore.js `visualizationMode`). One list for the map's
// mode switch, Smart Search and the shared-link reader.
export const MAP_MODES = [
  { value: 'points', label: 'Points', title: 'Points: one marker per site' },
  { value: 'clusters', label: 'Clusters', title: 'Clusters: nearby points grouped' },
  { value: 'heatmap', label: 'Heatmap', title: 'Heatmap: where records are dense' },
  { value: 'ranges', label: 'Ranges', title: 'Ranges: hex density or hull polygons' },
]

export const isMapMode = value => MAP_MODES.some(mode => mode.value === value)

export const mapModeLabel = value => MAP_MODES.find(mode => mode.value === value)?.label ?? 'Points'
