# Field sites and locality labels

**Taxon selection.** Selected subspecies narrow only the species they belong to. With M. polymnia, M. lysimnia and I. salapia selected, choosing *derasa* keeps every Mechanitis record and only I. salapia *derasa*. The Subsp. dropdown groups options by species. Without a species selection, subspecies apply to all records; the OR combinator keeps its global meaning. Links use the ordinary `sp` and `ssp` parameters.

**Locality labels.** Names of recorded collection localities appear on the map (Field sites panel → Show location names), chosen by one of two rules:
- *Busiest in view* (default): only the sites with the most records in view are named, about eight on a laptop screen (one per 250,000 px² of map, 3–12), next to their marker. Zooming in names smaller sites.
- *By records*: every site with at least the minimum number of records (default 10) is named where it fits, using longer leaders when needed.

Each label has a thin leader to its recorded coordinate; labels avoid each other and the markers. Cluster labels name the busiest named locality plus the number of other sites (`Suchipakari +3 sites`). Label colours follow the basemap: light text on dark and satellite maps, dark text on light maps.

**Field sites panel.** Opened from the right-edge tab. Lists the sites in the current map view (turn off *In view* for all filtered sites) with per-target record counts, CSV export of the listed sites and a Google Maps link per recorded coordinate. The eye button shows whether a site is named on the map: clicking it hides a named site, or always names one that is not (always-named sites use longer leaders when needed). Links keep both choices (`site_shortlist`, `site_hidden`) and the label rule (`site_labels`, `site_min`). Site identity combines normalized locality, country and a ~5 km geohash cell, so a locality can split at a cell boundary and similar spellings are not merged. Counts are available records, not abundance or collecting success.

**Site markers.** Points and clusters draw one marker per collection site (records within about 11 m), not one per record. Marker size grows with the logarithm of unique individuals (1 → 1×, 10 → 1.35×, 100 → 1.7×, capped at 1.8×) and fills are 75% opaque; *Map settings → Size markers by individuals* turns this off. In point view, sites closer on screen than about one marker width (20 px at the default point size) merge into one marker with a double border, sized by their summed individuals (capped at 2.2×) and split again when zooming in (up to zoom 16); its label reads `Ikiam +2 sites` and clicking it lists the sites. This uses MapLibre clustering on the site source, with per-colour-group record counts summed as cluster properties. The hovered marker is drawn on top with a ring. Clicking a site with several species opens a species overview sorted by individuals; choosing a species shows the specimen view, with *All species* to return. Clusters open the same overview with their sites listed.

**Colour.** Colours come from the data, not from how many legend rows fit (`src/utils/colorPlan.js`):
- the map opens coloured by species; filtering to one species, or choosing subspecies in the Subsp. filter, colours by subspecies. The legend title (`Species | Subsp.`) switches level in one click, and a level chosen there or in the legend toolbar holds until Reset. Records whose subspecies is the species name or undecided (`travella/derasa`, `ssp.?`) count as unknown and are not coloured;
- up to 10 colour groups (values of *Colour by*, with a collapsed species counting as one group): each gets a palette colour, assigned by record count so the largest groups get the most distinct colours;
- more than 10: the 10 most abundant are coloured and the rest are grey, summarised in the legend as "Other · N species";
- placeholder names ("Unknown", "Unknown species") are never coloured.

Sites with several colour groups are pies in legend order. To stay readable at marker size, a pie shows at most four coloured slices of at least 10% of the site's records; the rest join the grey "Other" slice. Cluster markers show individuals, with composition rings. Collapsing a species in the legend recolours its records with one species colour without changing the selection. Heatmap weights are log-compressed per location so single records stay visible and stacked records do not saturate the map.

**R export.** `data.geojson` holds the displayed site markers (individuals, species, colour or pie slices, size factor, projected position) and `records.geojson` every filtered record. Merged markers are exported as drawn (`display_site_count` > 1, with an inner border). `generate_map.R` draws pies with `draw_pie()` and scales each marker by `display_size_factor`; `palette_overrides` also applies to pie slices.

Run `node scripts/benchmark-locality-labels.mjs` against a running preview to measure label placement cost.

## Link parameters for the picture, and export mode

`style=<basemap key>` (for example `light`, `terrain`), `color_by=<subspecies|species|genus|status|mimicry|source>` and
`bbox=w,s,e,n` (degrees) are read from the link and kept in it when the app rewrites the address. `bbox` only frames
the map (MapLibre `fitBounds`, padding 32 px, maximum zoom 12, no animation, and no automatic fit to the data
afterwards); it never filters. Moving the map by hand removes `bbox`. Unknown values are ignored.

`export=1` turns on a fixed export mode (never stored): export preview at 4:3, a 760 x 570 CSS px frame, a 1600 x 1200
PNG, legend, scale bar and credits on, a title strip composed from the active filters (taxon · sex · country; no text
from the link), and a legend row "Unknown subspecies · N" for records whose subspecies is the species name or
undecided. The viewport must be large enough for the 760 x 570 frame beside the sidebar (for example 1280 x 720).

In export mode `window.ithomiiniMapsExport()` (no arguments) waits for the data, style, framing and site labels,
then runs the same capture as the Export Image button and returns, instead of downloading:

```
{ version: 1, png_base64, width: 1600, height: 1200,
  params: { applied: {name: value}, ignored: [names] },
  basemap, color_by, title,
  view: { bbox: [w, s, e, n], center: [lng, lat], zoom, frame: {width, height}, fit: {padding: 32, max_zoom: 12},
          bbox_requested },
  records: [{ source, id, sex, country, year, date, subspecies, lng, lat }],   // whole filtered set, map fields
  legend: { unit: 'records', rows: [{ label, records, unknown }], truncated },
  sites: [{ marker: 'site'|'merged'|'cluster', lng, lat, center_in_view, records, merged_sites,
            label, labels, members: [{ key, locality, record_ids: ['source|id'] }] }],
  unmatched_labels }
```

`records` is the whole filtered set (also outside the frame); `view` is the camera actually drawn; `sites` are the
markers MapLibre drew, read when the map was settled for the capture, with the labels drawn for them (`label` is null
when none is drawn) and the localities merged into each marker. `year` follows the app's date rule (two-digit years
above 25 are left undated). Use a fresh browser profile: stored legend settings (hidden items, counts off) would
change the picture.
