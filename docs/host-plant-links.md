# Host plant layer in links

The Host Plant Filters are kept in the URL, so a link opens the map with the plant layer on. Changing the filters updates the URL; opening the URL restores them.

| Parameter | Meaning | Default |
|---|---|---|
| `hp_bf` | Butterfly species whose host plants are shown, comma separated (`Tithorea harmonia`). Its plants are chosen as the *Butterfly species* box chooses them. | none |
| `hp_taxa` | Plant taxa shown, comma separated: slugs (`species_mesechites_trifida`) or names (`Mesechites trifida`). Written only when the plants are not just those of `hp_bf` (a plant unticked or added by hand). | the plants of `hp_bf` |
| `hp_level` | Host ID levels: `species`, `genus`, `family`. | `species` |
| `hp_evidence` | Evidence: `direct` (Observed), `literature` (Reported), `needs_check`. | `direct,literature` |
| `hp_conf` | Read only, for links written by hand: `high` = `direct`; `medium` = `direct,literature`; `low` = all three. `hp_evidence` wins when both are given. | |
| `hp_opacity` | Layer opacity in percent (15 to 100). | 85 |

The layer is on when the link names `hp_bf` or `hp_taxa`.

**Country and box.** The country filter (`country`) and a drawn box also limit the plant records. Plant records carry coordinates only, so each is placed in a country with Natural Earth 1:50m outlines (`public/data/country_boundaries.json`, built by `scripts/build_country_boundaries.mjs`); a record within about 5 km of a coast and in no outline counts in the nearest country. Records within a few km of a border can fall on the wrong side.

Example: Ecuador with *Tithorea harmonia*'s records and host plants:

```
https://rapidspeciation.github.io/ithomiini_maps/?sp=Tithorea%20harmonia&source=Sanger%20Institute,GBIF%20(UNAM),GBIF%20(Other%20Institutions),iNaturalist&country=Ecuador&hp_bf=Tithorea%20harmonia&map_view=-78.40000,-1.50000,6.50
```

Plant records are GBIF occurrences of the plant: they show where it grows, not that the butterfly uses it there.
