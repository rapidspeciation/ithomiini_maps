# Field sites and locality labels

**Taxon selection.** Selected subspecies narrow only the species they belong to. With M. polymnia, M. lysimnia and I. salapia selected, choosing *derasa* keeps every Mechanitis record and only I. salapia *derasa*. The Subsp. dropdown groups options by species. Without a species selection, subspecies apply to all records; the OR combinator keeps its global meaning. Links use the ordinary `sp` and `ssp` parameters.

**Locality labels.** Names of recorded collection localities appear on the map (Field sites panel → Show location names), with a minimum record threshold. Shortlisted sites bypass the threshold. Each label has a thin leader to its recorded coordinate; labels avoid each other and the markers, and are omitted when crowded. Cluster labels name the busiest named locality plus the number of other sites (`Suchipakari +3 sites`). Label colours follow the basemap: light text on dark and satellite maps, dark text on light maps.

**Field sites panel.** Opened from the right-edge tab. Lists sites across the filtered records (not only the visible map) with per-target record counts, a shortlist, CSV export and a Google Maps link per recorded coordinate. Site identity combines normalized locality, country and a ~5 km geohash cell, so a locality can split at a cell boundary and similar spellings are not merged. Counts are available records, not abundance or collecting success.

**Site markers.** Points and clusters draw one marker per collection site (records within about 11 m), not one per record. Marker size grows with the logarithm of unique individuals (1 → 1×, 10 → 1.35×, 100 → 1.7×, capped at 1.8×) and fills are 75% opaque so overlapping sites stay readable; *Map settings → Size markers by individuals* turns this off. Clicking a site with several species opens a species overview sorted by individuals; choosing a species shows the specimen view, with *All species* to return. Clusters open the same overview with their sites listed.

**Colour.** Colours come from the data, not from how many legend rows fit (`src/utils/colorPlan.js`):
- up to 10 colour groups (values of *Colour by*, with a collapsed species counting as one group): each gets a palette colour, assigned by record count so the largest groups get the most distinct colours;
- more than 10, when the top 10 cover at least 60% of records: the top 10 are coloured and the rest are grey "Other";
- otherwise sites are coloured by individuals on a sequential ramp (dark basemaps: blue → pale yellow; light basemaps: pale orange → dark red), matching the size encoding.

The legend offers *Colour top 10* or *Colour by individuals per site* when there are more than 10 groups; the choice lasts for the session. Sites with several coloured groups are pies in legend order. Cluster markers show individuals, with composition rings in category mode. Collapsing a species in the legend recolours its records with one species colour without changing the selection. Heatmap weights are log-compressed per location so single records stay visible and stacked records do not saturate the map.

**R export.** `data.geojson` holds the displayed site markers (individuals, species, colour or pie slices, size factor, projected position) and `records.geojson` every filtered record. `generate_map.R` draws pies with `draw_pie()` and scales each marker by `display_size_factor`; `palette_overrides` also applies to pie slices.

Run `node scripts/benchmark-locality-labels.mjs` against a running preview to measure label placement cost.
