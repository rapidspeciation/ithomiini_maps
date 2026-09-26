# Editable R map export

The R export ZIP captures the displayed map with original geographic records and resolved screen coordinates, colors and layer styles. It includes a readable `generate_map.R`, view/legend JSON, an offline basemap and SHA-256 input checksums. Install `jsonlite`, `png` and `svglite`, then run `Rscript --vanilla generate_map.R` or source the script in RStudio.

Edit the script's `SETTINGS` block to change output scale, point colors/sizes, opacity, font family and legend offsets. PDF/SVG retain editable occurrence symbols, host-plant symbols, range polygons, legend text and controls. Basemaps and SDMs remain raster. Heatmap and cluster displays use an explicitly identified composite raster, while preserving raw records for analysis. Changing geographic coordinates or extent requires refreshing projected screen positions. Pitched SDM views are rejected with an explanation.

The script checks SVG-device compatibility before writing map outputs. After upgrading R, an old svglite binary may load but fail with a graphics API mismatch. Reinstall svglite from source in the library used by the active R session, restart R, and rerun. It does not install packages automatically.

Validation used six real browser ZIPs executed with R 4.6.1: species, custom shapes, scaled preview, hulls, heatmap and SDM/host layers. In the 604-record species fixture all colors matched, and the largest SVG point-center difference from captured MapLibre projections was 0.0091 CSS pixels. Font rendering and raster resampling remain device dependent. Unit coverage checks grouping colors, hidden records, hull geometry, scaled legend fonts and serialized exports after a failed capture.
