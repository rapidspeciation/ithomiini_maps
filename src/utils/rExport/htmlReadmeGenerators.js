/** Human-readable provenance and a precise vector/raster contract. */
export function generateReadme(view) {
  const layers = view.layers
  const rasterNotes = []
  if (layers.rasterOverlayIds.length) {
    rasterNotes.push(`SDM rasters stored as separate georeferenced PNGs: ${layers.rasterOverlayIds.join(', ')}`)
  }
  if (layers.rasterVisualizationIds.length) {
    rasterNotes.push(`${view.mode} visualization captured as raster in background.png: ${layers.rasterVisualizationIds.join(', ')}`)
  }
  return `WINGS ATLAS — EDITABLE R MAP EXPORT

Run from a terminal: Rscript --vanilla generate_map.R
Install prerequisites if needed: install.packages(c("jsonlite", "png", "svglite"))
The script also works when called from RStudio with source("generate_map.R").
It writes ithomiini_map.pdf, ithomiini_map.svg, ithomiini_map.png and
ithomiini_map.session.txt (the R/package environment used) here.
Missing packages stop with an installation command; the script never installs
software or downloads map tiles behind your back.
The script checks SVG device compatibility before writing map outputs. If it
reports a graphics API mismatch after an R upgrade, rebuild svglite with
install.packages("svglite", type = "source"), then restart R/RStudio and rerun.

Edit the SETTINGS list at the top of generate_map.R to change output size,
point sizes, colors, opacity, font family, background, legend and output filename.
Portable font families are "sans", "serif" and "mono"; a named system font
also works if installed on the machine that renders the PDF/SVG.
The main drawing functions remain plain R/grid code. The source data and
rendered view are separate, so geographic and visual edits are inspectable.

FILES
  generate_map.R          Researcher-editable vector drawing script
  data.geojson            Displayed markers: one per site (records in range mode),
                          with individuals, species, colours/pie slices and sizes
  records.geojson         Every filtered occurrence record, for analysis
  range_polygons.geojson  Editable hull/hex geometry, when range mode is active
  host_plants.geojson     Editable host plant triangles, when active
  sdm_*.png              Separate georeferenced SDM rasters, when active
  legend.json             Rendered legend rows and CSS-pixel positions
  view_config.json        View, layer manifest, provenance and resolved sizes
  checksums.json          SHA-256 checksums for every other ZIP input
  basemap.png             Captured basemap without scientific map layers
  background.png          Captured heatmap/cluster visualization, if active

VECTOR AND RASTER
  ${layers.editablePoints} occurrence points, ${layers.editableRanges} range polygons, and
  ${layers.editableHostPlants} host plant symbols are separate
  editable elements in PDF/SVG. Their browser-projected screen positions keep
  the exact exported extent, zoom, bearing and canvas aspect ratio. The
  geographic originals remain in the GeoJSON files.
  Basemap imagery is always raster. The selected background is an offline
  capture of this specific map view, not a live tile service.
  ${rasterNotes.length ? rasterNotes.join('\n  ') : 'No scientific overlays were baked into the background.'}
  Change SETTINGS$background to "basemap" to omit raster overlays, or to
  "none" for a transparent background. Cluster/heatmap views use a raster
  visualization because MapLibre's aggregation cannot be reconstructed from
  raw points by simply drawing each record. Their raw records remain in
  records.geojson for analysis, but the script does not substitute them visually.

VIEW AND PROVENANCE
  App commit: ${view.appCommit}
  Generated: ${view.generatedAt}
  Page: ${view.pageUrl}
  Dataset source: ${view.source}
  Filtered records: ${view.filteredRecordCount}
  Displayed records: ${view.displayedRecordCount}
  View mode: ${view.mode}${view.rangeMethod ? ` (${view.rangeMethod})` : ''}
  Color: ${view.colorBy} (${view.colorAttribute})
  Basemap style: ${view.basemapStyle}
  Canvas: ${view.canvas.width} x ${view.canvas.height} CSS pixels
  Bounds: ${view.bounds.west}, ${view.bounds.south}, ${view.bounds.east}, ${view.bounds.north}

The exported point positions are view-specific. After changing geographic
coordinates or the map extent, re-export to refresh projected screen positions.
For reproducibility, keep this ZIP with the PDF/SVG and cite the data source
and tile contributors in publication captions.
`
}
