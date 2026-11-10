# Genus table for the identifier head (genus to family, subfamily, tribe)

The head trainers (`scripts/training/train_head_hier.py`, the BoA trainer in WingsClassificator, local and untracked)
read `data/specimen_classifier/training/genus_taxonomy_norm.json` (git-ignored; the same bytes as
`$META_DIR/taxonomy.json` on Sanger, sha256 1f791a74...). That table, built on 18 Jun 2026, files 22 Ithomiini genera
under 8 old tribes of a subfamily "Ithomiinae", puts the moth genus *Macrosoma* (Hedylidae) under tribe Ithomiini, and
lacks *Athyrtis*, *Epityches* and *Leucothyris*. The head's "Ithomiini" flag (`tribe == "Ithomiini"`) therefore holds
182 species: 170 of the 356 Ithomiini species plus 12 *Macrosoma* moths (WingsClassificator
`reports/model_autoresearch_20261109/taxonomic/TRIBE_FLAG_BUG.md`).

This folder regenerates it from the lab taxonomy. Nothing here is read by the maps site or by any live service.

| file | what |
|---|---|
| `build_genus_taxonomy.py` | the builder: rules and checks in its docstring |
| `genus_taxonomy_norm.lab_20261110.json` | `--scope all`: every genus the lab taxonomy has takes the lab's values (1,191 genera; 320 old entries change) |
| `genus_taxonomy_norm.ithomiini_only_20261110.json` | `--scope ithomiini`: only the 46 Ithomiini genera, *Leucothyris*, *Macrosoma* and the placeholder "Unknown" change (765 genera; 42 old entries change) |

Both tables pass the tribe audit with 0 mismatches (WingsClassificator
`reports/model_autoresearch_20261109/taxonomic/tribe_fix/`): on the data_v1 head metadata rewritten from either table,
the flag selects exactly the 356 reference species, *Macrosoma* is out, and no Ithomiini genus has an UNKNOWN tribe.

Ithomiini genera become Nymphalidae / **Danainae** / Ithomiini (the lab's treatment, Wahlberg et al. 2009), so any
code that tests `subfamily == "Ithomiinae"` (e.g. `scripts/training/build_sex_labels.py:151-152`) must test
`tribe == "Ithomiini"` before a table from here is used.

Rebuild:

```
python3 -I scripts/genus_taxonomy/build_genus_taxonomy.py \
  --lab <WingsClassificator>/reports/taxonomy_v07sep26_proposal/Taxonomy_v07Sep26.csv \
  --lab-check <WingsClassificator>/reports/taxonomy_v07sep26_proposal/Original_Taxonomy_v18Jun25.csv \
  --old data/specimen_classifier/training/genus_taxonomy_norm.json \
  --out <new folder>/genus_taxonomy_norm.json --diff <new folder>/diff.json --scope all
```

Applying a table (not done; it changes the next head's tribe and subfamily ranks): copy the chosen file over
`data/specimen_classifier/training/genus_taxonomy_norm.json`, `data/feat/genus_taxonomy_norm.json` and the Sanger
`$META_DIR/taxonomy.json`, keeping the old file beside it with its sha256, and note the new sha256 in the head notes.
