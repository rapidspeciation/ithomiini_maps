export const LEGEND_LAYOUT = {
  MIN_WIDTH: 200,
  MAX_WIDTH: 600,
  MIN_HEIGHT: 120,
  MIN_SNUG_HEIGHT: 120,
  AUTO_WIDTH_MAX_CONTAINER_RATIO: 0.30,
  MAX_RESIZE_WIDTH_RATIO: 0.45,
  TARGET_HEIGHT_RATIO: 0.75,
  MAX_HEIGHT_RATIO: 0.80,
  // On narrow (mobile) map containers the height ratios alone let the legend
  // cover most of the screen. Cap it to an absolute pixel height there so the
  // map stays visible behind it.
  MOBILE_CONTAINER_WIDTH: 768,
  MOBILE_MAX_HEIGHT_PX: 320,
  MOBILE_TARGET_HEIGHT_PX: 280,
  // In export mode the legend is measured against the export frame; keep it to
  // a smaller fraction of that frame so it does not dominate the exported map.
  EXPORT_TARGET_HEIGHT_RATIO: 0.45,
  EXPORT_MAX_HEIGHT_RATIO: 0.55,
  MIN_ITEM_HEIGHT_PX: 22,
  FALLBACK_LEGEND_HEIGHT: 200,
  FALLBACK_CONTAINER_HEIGHT: 600,
  STICKY_EDGE_THRESHOLD: 20,
}
