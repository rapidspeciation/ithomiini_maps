# Ithomiini Distribution Maps

Interactive mapping tool for Ithomiini butterfly research. Visualize specimen distributions, sequencing status, and mimicry patterns across South America.

## 🔗 [Live Application](https://rapidspeciation.github.io/ithomiini_maps/)

## Features

### 🗺️ Interactive Map
- **Multiple Base Layers**: Dark, Light, Satellite (Esri), Terrain, Streets
- **Clustered Points**: Efficient rendering of 30,000+ records
- **Dynamic Filtering**: Real-time map updates as filters change
- **Shareable URLs**: Filter state encoded in URL for easy sharing
- **Point Popups**: Click to view specimen details and images
- **High-Resolution Export**: Export maps at 300 DPI for publications

### 🖼️ Image Gallery
- **Full-Screen Viewer**: Browse specimen images in gallery mode
- **Zoom & Pan**: Detailed examination of wing patterns
- **Keyboard Navigation**: Arrow keys and shortcuts for quick browsing
- **Touch Support**: Pinch-to-zoom on mobile devices
- **Thumbnail Strip**: Quick preview of all images

### 🦋 Visual Mimicry Selector
- **Wing Pattern Icons**: Visual representation of mimicry rings
- **Color-Coded Display**: Distinctive colors for each ring
- **Search Filter**: Find mimicry rings by name
- **Record Counts**: See how many specimens per ring

### 🔬 Filter System
- **Taxonomic Cascade**: Family → Tribe → Genus → Species → Subspecies
- **Multi-Select Filters**: Select multiple species/subspecies at once (fuzzy search)
- **Sequencing Status**: Filter by Sequenced, Tissue Available, Preserved, Published, Observation, Museum Specimen
- **Mimicry Rings**: 44 unique mimicry patterns from Dore et al. (2022)
- **Mimicry Ring Propagation**: Automatically applied to Sanger and GBIF records based on species/subspecies matching
- **Date Range Filter**: Filter by collection/preservation date
- **CAMID Search**: Instant lookup by specimen ID
- **Records without a CAM ID**: specimens the collection sheet lists as "NOT GIVEN" or blank get a synthetic, unique key `NOID-SANGER-<hash>` (from the row's own sheet values, see `scripts/process_data.py`). The app shows them as "No ID"; the key stays in exports and tooltips. Real CAM IDs are never changed; a CAM ID on more than one sheet row is kept on each row and listed as a warning when the data is built.
- **Data Source**: Filter by Dore, Sanger Institute, or GBIF

### 📊 Data Table with Photos
- **Sortable Columns**: Click headers to sort by any field
- **Photo Thumbnails**: See specimen photo in each row
- **Species Photo Lookup**: If no photo for individual, shows photo from same species/subspecies
- **Photo Indicator**: Distinguishes own photo vs. reference photo from another individual
- **Pagination**: Navigate through large datasets efficiently
- **Column Visibility**: Toggle columns to customize your view

### 📥 Export & Citation
- **CSV Export**: Download filtered data as spreadsheet
- **GeoJSON Export**: Download for GIS/mapping applications
- **Map Image Export**: High-resolution PNG/JPEG for publications
- **Scientific Citation**: Auto-generated citation with version hash
- **BibTeX Format**: Ready-to-use citation for LaTeX documents
- **Reproducibility**: Version-controlled data with Git commit hash

### 📊 Data Sources
1. **Dore et al. (2022)**: 28,927 published occurrence records with mimicry data
2. **Sanger Institute**: Live collection/sequencing data with specimen photos
3. **GBIF**: External occurrence enrichment (includes iNaturalist data)

### 🌍 Species Distribution Models
- **148 species** modelled using MaxEnt + Random Forest + XGBoost ensemble
- **Tiered approach**: Algorithm selection based on sample size (MaxEnt-only for rare species, full ensemble for well-sampled species)
- **Interactive visualization**: Toggle predicted distributions on the map with suitability heatmaps, response curves, and confidence ratings
- **Full methodology**: See [`sdm/SDM_METHODS.md`](sdm/SDM_METHODS.md) for detailed pipeline documentation

## Tech Stack

- **Frontend**: Vue 3 (Composition API) + Vite
- **Mapping**: MapLibre GL JS
- **State Management**: Pinia
- **Data Processing**: Python (Pandas)
- **SDM Pipeline**: Python (elapid, scikit-learn, XGBoost, rasterio)
- **Hosting**: GitHub Pages
- **CI/CD**: GitHub Actions

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.9+

### Quick Start

```bash
# Clone the repository
git clone https://github.com/rapidspeciation/ithomiini_maps.git
cd ithomiini_maps

# Install JavaScript dependencies
npm install

# Start development server
npm run dev
```

### Full Setup (For All Features)

For enabling all features including database updates and premium map tiles, see the **[Setup Guide](SETUP.md)** which covers:

- **GitHub Personal Access Token** - Required for database update feature (with instructions for organization repos)
- **Cloudflare Worker** - Secure proxy for triggering GitHub Actions from the browser
- **Map Provider API Keys** - Optional: Stadia Maps and MapTiler for premium tile styles

### Data Processing

```bash
# Install Python dependencies
pip install -r scripts/requirements.txt

# Download GBIF data (run this first if you need GBIF records)
cd scripts
python gbif_download.py

# Run data processing pipeline
# (Requires Dore_Ithomiini_records.xlsx in scripts/ folder)
python process_data.py
```

### GBIF Data Download

The `gbif_download.py` script downloads ALL Ithomiini occurrences from GBIF:
- Properly parses species names (removes author citations)
- Extracts subspecies from `infraspecificEpithet` field
- Filters out BOLD sequence IDs and invalid entries
- Includes `basisOfRecord` for quality filtering (Research Grade equivalent)
- Downloads images where available

## Deployment

### Automatic Deployment (Recommended)
Push to `main` branch triggers automatic deployment via GitHub Actions.

### Manual Deployment
1. Build the application: `npm run build`
2. Deploy `dist/` folder to GitHub Pages

### GitHub Repository Settings Required:
1. **Settings → Pages → Source**: Select "GitHub Actions"
2. **Settings → Actions → General → Workflow permissions**: "Read and write"

## Project Structure

```
ithomiini_maps/
├── .github/workflows/
│   ├── deploy.yml          # Auto-deploy to GitHub Pages
│   └── update_data.yml     # Manual data refresh
├── public/data/
│   ├── map_points.json     # Processed occurrence data
│   └── gbif_occurrences.json  # Downloaded GBIF data (generated)
├── scripts/
│   ├── gbif_download.py    # Download all GBIF Ithomiini records
│   ├── process_data.py     # ETL pipeline with mimicry lookup
│   └── requirements.txt    # Python dependencies
├── src/
│   ├── components/
│   │   ├── DataTable.vue       # Sortable table with photo thumbnails
│   │   ├── DateFilter.vue      # Date range filter component
│   │   ├── ExportPanel.vue     # CSV/GeoJSON export & citations
│   │   ├── FilterSelect.vue    # Multi-select with fuzzy search
│   │   ├── ImageGallery.vue    # Full-screen image viewer
│   │   ├── MapEngine.vue       # MapLibre map component
│   │   ├── MapExport.vue       # High-res map image export
│   │   ├── MimicrySelector.vue # Visual mimicry ring picker
│   │   └── Sidebar.vue         # Filter controls & view toggle
│   ├── stores/
│   │   └── data.js         # Pinia state management with photo lookup
│   ├── App.vue             # Root component with modals
│   ├── main.js             # Entry point
│   └── style.css           # Global styles
├── index.html              # HTML template
├── package.json            # Node dependencies
└── vite.config.js          # Build configuration
```

## Data Schema

Each record in `map_points.json` contains:

```json
{
  "id": "CAM12345",
  "scientific_name": "Mechanitis menophilus",
  "genus": "Mechanitis",
  "species": "menophilus",
  "subspecies": "nevadensis",
  "family": "Nymphalidae",
  "tribe": "Ithomiini",
  "lat": -0.9234,
  "lng": -77.8123,
  "mimicry_ring": "Tiger",
  "sequencing_status": "Sequenced",
  "source": "Sanger Institute",
  "country": "Ecuador",
  "image_url": "https://wsrv.nl/?url=...",
  "date": "2023-05-15"
}
```

## Taxonomic Curation

All occurrence records pass through an automated taxonomic curation pipeline (`scripts/curation/`) that validates and corrects scientific names. Each curated record includes a `curation_basis` field indicating how the name was resolved:

| `curation_basis` | Meaning |
|---|---|
| **GBIF** | Exact match in the GBIF backbone taxonomy (cached) |
| **GBIF Synonym** | Name recognized as a synonym and resolved to its accepted name via GBIF |
| **GBIF API** | Resolved via a live query to the GBIF species match API (when not in cache) |
| **Ref. Taxonomy** | Verified against a compiled reference taxonomy (Butterflies of America / nymphalidae.net) |
| **Literature** | Corrected or verified based on specialist literature review |
| **Typo Detection** | Subspecies spelling auto-corrected (edit-distance detection confirmed by known subspecies list) |
| *(empty)* | Name could not be resolved (not found, API error, or higher-rank match only) |

Additional output fields:

- `curation_status` — outcome of the curation process (e.g. `verified`, `synonym_resolved`, `not_found`)
- `curated_name` — the final recommended scientific name after all corrections
- `scientific_name_original` — preserved when the name was changed by synonym resolution

## Credits

- **Project Lead**: Dr. Joana Meier (Wellcome Sanger Institute)
- **Development**: Franz Chandi
- **Data Sources**: 
  - Dore et al. (2022) - Published occurrence data
  - Sanger Institute - Sequencing data
  - GBIF - Global biodiversity data

## License

MIT License - See LICENSE file for details
