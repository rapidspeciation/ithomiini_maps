// HTML map and README generators for R export package
// Extracted from rExport.js for maintainability

/**
 * Generate README for the ZIP package
 * @param {string} citationText - Citation text to include
 * @param {string} shortHash - Short git commit hash
 * @returns {string} README content
 */
const generateReadme = (citationText, shortHash) => {
  return `═══════════════════════════════════════════════════════════════════════════
ITHOMIINI MAPS - R EXPORT PACKAGE
═══════════════════════════════════════════════════════════════════════════

This ZIP contains data and scripts to recreate your map view as true
vector graphics (SVG/PDF) for publications.

FILES INCLUDED:
---------------
- data.geojson      : Filtered specimen data with pre-computed colors
- view_config.json  : Map view bounds and settings
- legend.json       : Legend colors and labels
- basemap.png       : Exact basemap from web app (CartoDB Dark tiles)
- map.html          : Standalone HTML file (EXACT reproduction of web preview)
- generate_map.R    : R script to recreate the map
- README.txt        : This file

QUICK START:
------------
1. Extract all files to a folder
2. Open R or RStudio
3. Set working directory to the extracted folder
4. Run: source("generate_map.R")
5. Find your exports in the folder

OUTPUT FILES:
-------------
- ithomiini_map.pdf : Vector PDF for publications
- ithomiini_map.png : High-resolution raster (300 DPI)
- ithomiini_map.svg : Editable vector (Adobe Illustrator/Inkscape)

REQUIREMENTS:
-------------
All packages will auto-install if missing:
- sf               : Spatial data handling
- ggplot2          : Plotting
- dplyr            : Data manipulation
- tidyr            : Data tidying
- jsonlite         : Reading config files
- maptiles         : CartoDB Dark Matter basemap tiles
- tidyterra        : Plot raster tiles with ggplot2
- ggspatial        : Scale bar
- grid             : Custom legend rendering
- png              : Read fallback basemap image

VIEWING IN BROWSER (map.html):
------------------------------
The map.html file is a standalone HTML file that renders identically to the
web app preview. You can open it directly in any browser to view and interact
with the map.

WHY R?
------
The web map uses WebGL rendering which produces raster (pixel) output.
R with ggplot2 renders true vectors, giving you:
- Infinite scalability for any print size
- Small file sizes
- Editable in Adobe Illustrator/Inkscape
- Publication-quality output

CUSTOMIZATION:
--------------
Edit the STYLE list in generate_map.R to easily customize:
- Point size, color, and transparency
- Legend position, size, and max items shown
- Background and text colors
- Scale bar styling
- Output dimensions and DPI

The script is well-documented and uses tidyverse conventions for
easy modification.

CITATION:
---------
${citationText}

SOURCE:
-------
https://fr4nzz.github.io/ithomiini_maps/

Generated: ${new Date().toISOString()}
Version: ${shortHash}
═══════════════════════════════════════════════════════════════════════════
`
}

/**
 * Generate standalone HTML file that renders exact same map as web app
 * @param {Object} geoJSON - GeoJSON data with colors
 * @param {Object} viewConfig - Map view configuration
 * @param {Object} legendConfig - Legend configuration
 * @param {string} colorBy - Color-by field name
 * @returns {string} HTML content
 */
const generateMapHTML = (geoJSON, viewConfig, legendConfig, colorBy) => {
  const isItalic = colorBy === 'species' || colorBy === 'subspecies' || colorBy === 'genus' || colorBy === 'scientific_name'
  const legendItems = legendConfig.items || []

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Wings Atlas</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"><\/script>
  <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #map { width: 100vw; height: 100vh; }

    /* Legend - matches web app exactly */
    .legend {
      position: absolute;
      bottom: 40px;
      left: 20px;
      background: rgba(37, 37, 64, 0.95);
      border: 1px solid #3d3d5c;
      border-radius: 8px;
      padding: 12px;
      max-height: 60vh;
      overflow-y: auto;
      min-width: 180px;
      z-index: 1000;
    }
    .legend-title {
      color: #888888;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
    }
    .legend-color {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .legend-label {
      color: #e0e0e0;
      font-size: 12px;
      ${isItalic ? 'font-style: italic;' : ''}
    }

    /* Scale bar */
    .maplibregl-ctrl-scale {
      background: rgba(37, 37, 64, 0.9) !important;
      color: #e0e0e0 !important;
      border-color: #e0e0e0 !important;
      font-size: 11px !important;
    }

    /* Hide attribution for cleaner export */
    .maplibregl-ctrl-attrib { display: none !important; }
  </style>
</head>
<body>
  <div id="map"></div>

  <div class="legend">
    <div class="legend-title">${legendConfig.title || colorBy}</div>
    ${legendItems.map(item => `
    <div class="legend-item">
      <div class="legend-color" style="background: ${item.color}"></div>
      <span class="legend-label">${item.label}</span>
    </div>
    `).join('')}
  </div>

  <script>
    // GeoJSON data embedded
    const geoData = ${JSON.stringify(geoJSON)};

    // View config
    const config = ${JSON.stringify(viewConfig)};

    // Initialize map
    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '© CartoDB © OpenStreetMap'
          }
        },
        layers: [{
          id: 'carto-dark-layer',
          type: 'raster',
          source: 'carto-dark',
          minzoom: 0,
          maxzoom: 22
        }]
      },
      center: [config.center.lng, config.center.lat],
      zoom: config.zoom,
      preserveDrawingBuffer: true // Required for canvas export
    });

    // Add scale bar
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      // Add data source
      map.addSource('points', {
        type: 'geojson',
        data: geoData
      });

      // Add points layer with exact colors from web app
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'display_color'],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.3)'
        }
      });

      // Fit to bounds
      map.fitBounds([
        [config.bounds.west, config.bounds.south],
        [config.bounds.east, config.bounds.north]
      ], { padding: 20, duration: 0 });
    });
  <\/script>
</body>
</html>`
}

export { generateReadme, generateMapHTML }
