#!/usr/bin/env python3
"""Regenerate the identifier head's genus table (genus -> family, subfamily, tribe) from the lab taxonomy.

The table the head trainers read (data/specimen_classifier/training/genus_taxonomy_norm.json, untracked; the same bytes
as $META_DIR/taxonomy.json on Sanger) was built on 18 Jun 2026 from an older classification: Ithomiinae as a subfamily
split into 8 tribes for 22 genera, "Ithomiini" for 19 others, the moth genus Macrosoma (Hedylidae) under Ithomiini, and
Athyrtis, Epityches and Leucothyris missing. See WingsClassificator
reports/model_autoresearch_20261109/taxonomic/TRIBE_FLAG_BUG.md.

Rules (10 Nov 2026):
  1. Every genus in the lab taxonomy (Taxonomy_v07Sep26.csv, the Butterflies of America check of Taxonomy_v18Jun25)
     takes the lab's family, subfamily and tribe: the most frequent triple over the genus's rows, the tribe without its
     ", Subtribe ..." part, "NA" read as empty. Genus names are kept only if they are one capitalised word.
  2. A genus of the old table the lab taxonomy lacks keeps its old values, except the placeholder genus "Unknown", whose
     values are emptied (it was filed under Ithomiini).
  3. Synonyms the head keeps as genera take their senior genus's values: Leucothyris -> Oleria.
  With --scope ithomiini, rule 1 applies only to the reference genera and Macrosoma (every other genus keeps its old
  values and no genus is added): the smallest fix, for a choice between the two.
  4. Checks (the script stops on any failure): the 46 Ithomiini genera of the frozen reference plus Leucothyris are
     Nymphalidae / Danainae / Ithomiini; no other genus has tribe Ithomiini; Macrosoma is not Nymphalidae; the second
     lab file (Original_Taxonomy_v18Jun25.csv) gives the same triple for every genus both files have, apart from
     genera named in KNOWN_V18_DIFFERENCES.

usage:
  build_genus_taxonomy.py --lab Taxonomy_v07Sep26.csv --lab-check Original_Taxonomy_v18Jun25.csv \
      --old genus_taxonomy_norm.json --out <new folder>/genus_taxonomy_norm.json [--diff <new folder>/diff.json]
      [--scope all|ithomiini]
"""
import argparse, csv, hashlib, json, re, sys
from collections import Counter, defaultdict

# The frozen reference (WingsClassificator reports/model_autoresearch_20261109/taxonomic/audit/tribe_audit.py,
# REFERENCE_GENERA and REFERENCE_SYNONYMS, 9 Nov 2026).
REFERENCE_GENERA = frozenset("""
Aeria Aremfoxia Athesis Athyrtis Brevioleria Callithomia Ceratinia Dircenna Elzunia Episcada Epityches Eutresis
Forbestra Godyris Greta Haenschia Heterosais Hyalenna Hyalyris Hypoleria Hypomenitis Hyposcada Hypothyris Ithomia
Mcclungia Mechanitis Megoleria Melinaea Methona Napeogenes Oleria Ollantaya Olyras Pachacutia Pagyris Paititia
Patricia Placidina Pseudoscada Pteronymia Sais Scada Thyridia Tithorea Veladyris Velamysta
""".split())
SYNONYMS = {"Leucothyris": "Oleria"}
ITHOMIINI = {"family": "Nymphalidae", "subfamily": "Danainae", "tribe": "Ithomiini"}
PLACEHOLDERS = {"Unknown"}
# Genera where Original_Taxonomy_v18Jun25 and Taxonomy_v07Sep26 are allowed to differ (each with the reason).
KNOWN_V18_DIFFERENCES = {}
GENUS_NAME = re.compile(r"^[A-Z][a-z]+$")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def lab_table(path):
    """genus -> (family, subfamily, tribe), the most frequent triple; plus the genera with more than one triple."""
    seen = defaultdict(Counter)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            g = (r.get("genus") or "").strip()
            if not GENUS_NAME.match(g):
                continue
            clean = lambda v: "" if (v or "").strip() in ("", "NA") else v.strip()
            tribe = clean(r.get("tribe")).split(", Subtribe")[0].strip()
            seen[g][(clean(r.get("family")), clean(r.get("subfamily")), tribe)] += 1
    table, mixed = {}, {}
    for g, c in seen.items():
        (best, n), *rest = c.most_common()
        if rest and rest[0][1] == n:
            raise SystemExit(f"{path}: genus {g} has a tie between {best} and {rest[0][0]}")
        table[g] = dict(zip(("family", "subfamily", "tribe"), best))
        if rest:
            mixed[g] = {" / ".join(k): v for k, v in c.items()}
    return table, mixed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lab", required=True, help="Taxonomy_v07Sep26.csv")
    ap.add_argument("--lab-check", required=True, help="Original_Taxonomy_v18Jun25.csv")
    ap.add_argument("--old", required=True, help="the current genus_taxonomy_norm.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--diff")
    ap.add_argument("--scope", choices=("all", "ithomiini"), default="all")
    a = ap.parse_args()

    old = json.load(open(a.old))
    lab, lab_mixed = lab_table(a.lab)
    check, _ = lab_table(a.lab_check)
    if a.scope == "ithomiini":
        lab_all = lab
        lab = {g: v for g, v in lab.items() if g in REFERENCE_GENERA or g == "Macrosoma"}
        check = {g: v for g, v in check.items() if g in lab}
        lab_mixed = {g: v for g, v in lab_mixed.items() if g in lab}
        if "Macrosoma" not in lab_all:
            raise SystemExit("Macrosoma is not in the lab taxonomy")

    new, source = {}, {}
    for g in sorted(set(old) | set(lab)):
        if g in lab:
            new[g], source[g] = dict(lab[g]), "lab"
        elif g in PLACEHOLDERS:
            new[g], source[g] = {"family": "", "subfamily": "", "tribe": ""}, "placeholder_emptied"
        else:
            new[g], source[g] = {k: old[g].get(k, "") for k in ("family", "subfamily", "tribe")}, "old_table_kept"
    for syn, senior in SYNONYMS.items():
        new[syn], source[syn] = dict(new[senior]), f"synonym_of_{senior}"

    # ---- checks
    errors = []
    for g in sorted(REFERENCE_GENERA | set(SYNONYMS)):
        if new.get(g) != ITHOMIINI:
            errors.append(f"reference genus {g}: {new.get(g)}")
    for g, v in new.items():
        if v["tribe"] == "Ithomiini" and g not in REFERENCE_GENERA and g not in SYNONYMS:
            errors.append(f"non-reference genus {g} under Ithomiini: {v}")
    if new.get("Macrosoma", {}).get("family") == "Nymphalidae":
        errors.append(f"Macrosoma: {new.get('Macrosoma')}")
    v18_diff = {g: {"v07Sep26": lab[g], "v18Jun25": check[g]} for g in sorted(set(lab) & set(check))
                if lab[g] != check[g] and g not in KNOWN_V18_DIFFERENCES}
    if v18_diff:
        errors.append(f"lab files differ for {sorted(v18_diff)}")
    if errors:
        raise SystemExit("checks failed:\n  " + "\n  ".join(errors))

    with open(a.out, "w") as f:
        json.dump(new, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")

    changes = {g: {"old": {k: old[g].get(k, "") for k in ("family", "subfamily", "tribe")}, "new": new[g], "source": source[g]}
               for g in sorted(set(old) & set(new)) if any(old[g].get(k, "") != new[g][k] for k in ("family", "subfamily", "tribe"))}
    out = {
        "scope": a.scope,
        "inputs": {k: {"path": p, "sha256": sha(p)} for k, p in (("lab", a.lab), ("lab_check", a.lab_check), ("old", a.old))},
        "output": {"path": a.out, "sha256": sha(a.out), "genera": len(new)},
        "counts": {"old_genera": len(old), "new_genera": len(new), "added": len(set(new) - set(old)),
                   "removed": len(set(old) - set(new)), "changed": len(changes),
                   "source": dict(Counter(source.values()))},
        "changed": changes,
        "added": {g: dict(new[g], source=source[g]) for g in sorted(set(new) - set(old))},
        "old_table_kept": sorted(g for g, s in source.items() if s == "old_table_kept"),
        "lab_genera_with_minority_rows": lab_mixed,
    }
    if a.diff:
        json.dump(out, open(a.diff, "w"), indent=1, ensure_ascii=False)
    print(json.dumps(out["counts"], indent=1))


if __name__ == "__main__":
    sys.exit(main())
