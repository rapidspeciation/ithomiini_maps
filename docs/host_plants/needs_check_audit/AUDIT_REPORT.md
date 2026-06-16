# Needs-Check Host-Plant Association Audit

> **Status: applied 2026-06-15, revised 2026-06-16.** Applied through the pipeline via
> `scripts/host_plants/hostplant_source_level_audit_20260615.csv` (wired as the default
> `--source-level-audit`). **Final result: 152 of 198 records upgraded — `needs_check` 198 → 46**
> (literature 495, direct 322 across the whole database). No records were deleted.
>
> A second pass on 2026-06-16 corrected two systematic mistakes in the original audit:
> 1. **Heliconiini are in scope.** This database covers both Ithomiini and Heliconiini. The original
>    "atypical/out-of-scope" flags on Heliconius/Dryas-on-Passifloraceae were wrong; those pairings are
>    correct biology. All 14 such `needs_check` rows were re-rated `literature` (Benson et al. 1976 /
>    Lamas 1985), and the bad flags were scrubbed from the verdicts.
> 2. **Captive-rearing records are high-value, not `needs_check`.** A confirmed captive host is core to
>    this database's purpose. Captive records are now `literature`, or `direct` when an actual rearing/
>    oviposition is reported (e.g. assoc_0185, Eutresis on *Juanulloa*, Brown & Freitas 1994 captive
>    oviposition → `direct`). `needs_check` is reserved for untraceable sources or doubtful biology.
>
> The 46 still flagged are listed in `needs_check_review_shortlist.csv` (3 are biologically doubtful
> Datura records; 2 cite untraceable sources). Separately, 29 source links were corrected: 17 Beccaloni
> rows moved off the CABI paywall to the free ResearchGate PDF, and 12 Muriel/Hill rows repointed from
> the catalogue PDF to their real primary-source DOIs.

## 1. Summary

This audit reviewed the 198 host-plant association references in the Ithomiini Maps database that were carrying a `needs_check` status, grouped by the primary publication each record cites. The goal was to decide, for every record, whether the cited evidence justifies promotion to catalogue-level `literature`, occasional `direct` (reared/observed) status, or whether the record should remain `needs_check`.

The method had three layers:

1. **Reference-centric verification.** Each distinct cited publication was checked for whether it is a real, locatable Neotropical host-plant source, its source type (primary rearing, field observation, compilation/catalogue, taxonomic list), and how strongly it was verified (full text checked, metadata located, or domain knowledge only).
2. **Taxonomic plausibility.** Each butterfly-host pairing was tested against known Ithomiini host-clade biology (most Ithomiini on Solanaceae; Tithoreina/Aeria/Tithorea on Apocynaceae; Methona/Placidina on Brunfelsia), flagging atypical genera and out-of-scope Heliconiinae records.
3. **Adversarial re-check.** Every first-pass verdict was re-examined to attack over-promotion, especially Beccaloni "dubious"-marked rows, personal-communication-only sources, captive-rearing records, and boilerplate metadata mismatches.

### Headline counts (recommended evidence level)

| Recommended level | Records |
|---|---|
| direct | 8 |
| literature | 125 |
| needs_check (kept) | 65 |
| reject | 0 |
| **Total** | **198** |

No record was recommended for outright rejection. The dominant outcome is promotion from `needs_check` to catalogue-level `literature`, reflecting that most rows trace to real, authoritative but compilation-mediated sources (chiefly Beccaloni et al. 2008 and Drummond & Brown 1987). A minority hold direct status where a genuine primary rearing/field study (Muriel et al. 2011, Hill 2006, Hill et al. 2012) underlies the record.

## 2. Recommendations at a glance

| Action | Count | Notes |
|---|---|---|
| Upgrade to `literature` | 125 | Catalogue-mediated real primaries; taxonomically typical pairings |
| Confirm `direct` | 8 | Real primary rearing/field records (Muriel 2011, Hill 2006, Hill et al. 2012) |
| Keep `needs_check` | 65 | Beccaloni dubious markers, atypical hosts, untraceable/dubious sources, captive-only, snippet-only |
| Reject | 0 | No record was biologically or bibliographically refuted outright |
| Flagged: Heliconiinae (Dryas, Heliconius) on Passifloraceae | 29 | NOT out of scope. The database intentionally includes Heliconiini; these pairings are correct biology (Passifloraceae is the canonical heliconiine host). The audit's "atypical" flag was a false positive from an Ithomiini-only assumption and should be ignored. Records kept and evidence-rated normally. |
| Flagged: atypical host genus for the butterfly | 11 | Datura, Brunfelsia-on-Mechanitis, Jaltomata, Schultesianthus, Solandra, Capsicum, etc. |
| Flagged: spurious/parsing-artifact citation | 4 | "Isabel 1830", "Ac/Am, Drummond & Brown 1987" |
| Flagged: untraceable/dubious source | 4 | Varga 1997 (x2), Andrews 1983, Young 1979 DOI mismatch |

## 3. Reference verification table

| Publication | Real? | Type | Verification | Note |
|---|---|---|---|---|
| Beccaloni et al. 2008 (catalogue, all variants) | confirmed | compilation/catalogue | domain knowledge | Authoritative Neotropical hostplant catalogue (Monografias Tercer Milenio vol. 8). Compilation, so literature ceiling unless an embedded real primary or rearing note applies. Embeds primaries and dubious markers. |
| Drummond & Brown 1987 | confirmed | compilation | domain knowledge | Foundational Ithomiine larval-foodplant compilation (Ann. Missouri Bot. Gard. 74:341-358). Reached via Beccaloni, so catalogue-mediated literature. |
| Lamas 1985 | likely real | taxonomic list | domain knowledge | Real faunistic Peruvian/Tambopata work, but rows here are broad bare "Neotropics: [Lamas 1985]" trails flagged unretrievable by project docs; many stay needs_check. |
| Costa 1999 | confirmed | reared | metadata located | Rev. Bras. Biol. 59(3):455-459, new larval host records (mostly Solanum). Real primary; rows have reared/first-record flags but were not re-verified, so literature. |
| Brown 1992a | confirmed | field observation | domain knowledge | K.S. Brown Jr., authoritative Brazilian Ithomiini foodplant source. Catalogue-embedded. |
| Hayward 1969 / 1931c / 1943 / 1960 | likely real | field obs/compilation | domain knowledge | K.J. Hayward, Argentine Lepidoptera foodplant literature. Catalogue-mediated. |
| Brown & Freitas 1994 | likely real | reared | domain knowledge | Authoritative Ithomiini biology source; catalogue-embedded primary. |
| Arruda & Arruda 1971 | likely real | field observation | domain knowledge | Brazil/Pernambuco regional source, offline; credible via catalogue provenance. |
| DeVries 1986 | likely real | field observation | domain knowledge | Costa Rican butterfly natural history; rows here carry Beccaloni dubious markers. |
| DeVries 1987 | confirmed | field observation | domain knowledge | Butterflies of Costa Rica Vol. I; real, catalogue-embedded. |
| Varga 1997 | unverifiable | unknown | domain knowledge | Not a recognized Neotropical Ithomiini source; attached to Beccaloni-dubious Argentine Brunfelsia rows. Treat as untraceable. |
| Hill 2006 | confirmed | reared | full text checked | J. Lepid. Soc. 60(4):203-210; vouchered rearing of Forbestra olivencia on S. monarchostemon. |
| Hall 1996 | confirmed | reared (captive) | metadata located | Trop. Lepid. 7(2):161-165; captive Greta oto on Cestrum. Captive, not wild host. |
| Fassl 1912 | likely real | field observation | domain knowledge | Historical Colombian Lepidoptera notes; catalogue-embedded oviposition record. |
| Isabel 1830 | not found | n/a (artifact) | domain knowledge | NOT a publication: parsing artifact from "Finca Santa Isabel, 1830 m". Real source is Muriel et al. 2011. |
| Young 1978a / 1978e / 1974c | likely real / confirmed | field obs/reared | domain/metadata | Allen M. Young Costa Rican Lepidoptera corpus. 1978e and 1974c rows carry Beccaloni dubious markers. |
| Young 1979 | likely real | field observation | metadata located | DOI resolves to a Wiley journal, but title/DOI/host appear mismatched for the S. rugosum claim; snippet-only basis. |
| Mueller 1886 | likely real | field observation | domain knowledge | Fritz Mueller, classic SC Brazil Ithomiini natural history. |
| Fonseca & Amante 1973 | likely real | compilation | domain knowledge | Brazilian agricultural-entomology host list; catalogue-embedded. |
| Almeida (d'Almeida) 1922 | likely real | field observation | domain knowledge | Brazilian Lepidoptera; heliconiine record on Passiflora. |
| Brown & Benson 1975a | confirmed | field observation | domain knowledge | Heliconius-Passiflora coevolution series; heliconiine source, not Ithomiini. |
| Lima 1928 | likely real | compilation | domain knowledge | Costa Lima, foundational Brazilian economic entomology; corroborating cite. |
| Vasconcellos-Neto 1991 | likely real | reared | domain knowledge | Ithomiine-Solanaceae feeding/oviposition study, Sao Paulo. |
| Guagliumi 1967 | likely real | compilation | domain knowledge | Venezuelan crop-pest insect fauna; agricultural source, dubious-flagged rows. |
| Andrews 1983 | unverifiable | field observation | domain knowledge | Untraceable embedded Costa Rica cite; cannot justify direct. |
| Otero & Marigo 1990 | likely real | field observation | domain knowledge | Semi-popular Brazilian butterfly natural history; possibly mis-pinned in metadata. |
| Freitas 1993 | confirmed | reared | metadata located | Placidina euryanassa on Brugmansia suaveolens; real primary, catalogue-mediated here. |
| Muriel et al. 2011 (via several rows) | confirmed | reared | domain knowledge | Actualidades Biologicas 33(95):275-285; field-collected immatures reared in Antioquia, Colombia. Underlies the direct records. |
| Hill et al. 2012 (via several rows) | confirmed | field observation | domain knowledge | Biol. J. Linn. Soc. 106:540-560; Mechanitis field host-use study, eastern Ecuador. |

## 4. Flagged / problematic records

No record was rejected. The records below carry data-integrity or plausibility concerns a curator should review.

### 4a. Non-Ithomiini Heliconiinae sitting in the Ithomiini database (Passifloraceae hosts)

These records are biologically correct (Heliconiinae feed on Passiflora) but the taxa do not belong in an Ithomiini host dataset. Several also carry Beccaloni dubious markers and remain `needs_check`; the rest are `literature` but should be excluded from Ithomiini overlays.

| id | butterfly | host | concern |
|---|---|---|---|
| assoc_0091 | Dryas iulia | Passiflora capsularis | Heliconiine, out of scope; Beccaloni-dubious |
| assoc_0117 | Dryas iulia | Passiflora quadrangularis | Heliconiine, out of scope; Beccaloni-dubious |
| assoc_0082 | Dryas iulia | Passiflora | Heliconiine; literature |
| assoc_0081 | Dryas iulia | Passiflora spp. | Heliconiine; literature |
| assoc_0080 | Dryas iulia | Passiflora sp. | Heliconiine; literature |
| assoc_0236 | Heliconius erato | Passiflora auriculata | Heliconiine, out of scope; Beccaloni-dubious |
| assoc_0244 | Heliconius erato | Passiflora coriacea | Heliconiine, out of scope; Beccaloni-dubious |
| assoc_0261 | Heliconius erato | Passiflora morifolia | Heliconiine, out of scope; Beccaloni-dubious |
| assoc_0231 | Heliconius erato | Passiflora sp. | Heliconiine contamination; literature |
| assoc_0232 | Heliconius erato | Passiflora spp. | Heliconiine; literature |
| assoc_0293, 0296, 0299, 0316, 0322, 0287 | Heliconius numata | Passiflora (various) | Heliconiine; literature (correct host) |
| assoc_0301, 0318, 0327 | Heliconius numata | Passiflora (bahiensis/oerstedii/vitifolia) | Heliconiine; Beccaloni-dubious, needs_check |
| assoc_0294 | Heliconius numata | Passiflora spp. | Heliconiine; Lamas-only, needs_check |
| assoc_0349 | Heliconius sara | Passiflora nr rhamnifolia | Heliconiine; literature |
| assoc_0339, 0346, 0353, 0355, 0356 | Heliconius sara | Passiflora (various) | Heliconiine; Beccaloni-dubious/captive, needs_check |
| assoc_0331, 0330 | Heliconius sara | Passiflora | Heliconiine; literature |
| assoc_0337 | Heliconius sara | Passiflora nr citrifolia | Heliconiine misfiled; literature |

### 4b. Atypical host genus for the cited butterfly

| id | butterfly | host | concern |
|---|---|---|---|
| assoc_0492 | Mechanitis lysimnia | Brunfelsia uniflora | Brunfelsia atypical for Mechanitis (Methona host); Beccaloni-dubious |
| assoc_0564 | Mechanitis polymnia | Brunfelsia grandiflora | Brunfelsia atypical for Mechanitis; Beccaloni-dubious |
| assoc_0573 | Mechanitis polymnia | Jaltomata procumbens | Jaltomata unusual for Mechanitis; single p.c.; Beccaloni-dubious |
| assoc_0538 | Mechanitis lysimnia | Solanum tuberosum | Cultivated potato, incidental/error; Beccaloni-dubious |
| assoc_0572 | Mechanitis polymnia | Datura stramonium | Datura atypical genus; Guagliumi agricultural source; Beccaloni-dubious |
| assoc_0660 | Methona themisto | Solanum sp. | Plain Solanum atypical for Methona; Beccaloni-dubious |
| assoc_0713, 0714 | Placidina euryanassa | Datura metel / stramonium | Placidina is a Brunfelsia specialist; Beccaloni-dubious |
| assoc_0712 | Placidina euryanassa | Cyphomandra betacea | Cultivated tree-tomato, host-shift implausible; Beccaloni-dubious |
| assoc_0186, 0700 | Eutresis / Olyras | Schultesianthus megalandrus | Unusual Solanaceae genus; Beccaloni-dubious |
| assoc_0701 | Olyras crathis | Solandra grandiflora | Unusual woody Solanaceae; Beccaloni-dubious |
| assoc_0748 | Pteronymia notilla | Capsicum sp. | Capsicum uncommon; documented hosts are Solanum/Cestrum; Beccaloni-dubious |

### 4c. Spurious or parsing-artifact citations

| id | butterfly | host | concern |
|---|---|---|---|
| assoc_0857 | Mechanitis polymnia | Solanum sp. cf. S. hayesii | "Isabel 1830" is a locality artifact; real source Muriel et al. 2011; literature |
| assoc_0852 | Pteronymia latilla | Solanum deflexiflorum | "Isabel 1830" locality artifact; real source Muriel et al. 2011; literature |
| assoc_0196 | Godyris zavaleta | Solanum sp. | "Ac, Drummond & Brown 1987" garbled prefix; real cite is D&B 1987; literature |
| assoc_0637 | Melinaea mneme | Markea coccinea | "Am, Drummond & Brown 1987" garbled prefix; Beccaloni-dubious; literature/low |

### 4d. Untraceable or mismatched sources

| id | butterfly | host | concern |
|---|---|---|---|
| assoc_0148 | Episcada hymenaea | Brunfelsia spp. | Varga 1997 untraceable; Beccaloni-dubious; needs_check |
| assoc_0715 | Pseudoscada erruca | Brunfelsia spp. | Varga 1997 untraceable; Beccaloni-dubious; needs_check |
| assoc_0623 | Melinaea lilis | Markea sp. | Andrews 1983 untraceable; literature/low |
| assoc_0839 | Mechanitis isthmia | Solanum rugosum | Young 1979 DOI/title/host mismatch, snippet-only; needs_check |

## 5. Records recommended for upgrade to `literature`

These trace to real authoritative sources via the Beccaloni catalogue (or directly to a real primary) and represent taxonomically typical pairings. Confidence is medium unless multiple concordant primaries support high, or genus-level/p.c./near-species qualifiers force low.

**Beccaloni et al. 2008 (embedded primaries / personal communications):** assoc_0006, 0021, 0026, 0194, 0463, 0567, 0577, 0633, 0641, 0653 (low), 0668, 0687, 0734, 0740, 0778, 0785, 0791, 0811, 0817, 0858 (high), 0437. Heliconiinae correct-host literature rows: assoc_0293, 0296, 0299, 0316, 0322, 0287, 0349.

**Drummond & Brown 1987 (catalogue-mediated):** assoc_0015, 0023, 0028, 0033, 0034, 0061, 0066, 0075, 0159, 0191, 0192, 0203, 0363, 0370, 0372, 0376, 0386, 0388, 0405, 0505, 0529 (high), 0548, 0549, 0554, 0578, 0579, 0580 (high), 0588 (high), 0608 (high), 0618 (high), 0670, 0679, 0685, 0686, 0691, 0723, 0732, 0744, 0756, 0781, 0783.

**Costa 1999 (real primary, reared/presumed flags, not re-verified):** assoc_0819, 0820, 0826, 0827, 0834 (high); assoc_0823 (medium, presumed feeding marks only).

**Brown 1992a:** assoc_0082 (high, heliconiine), 0142, 0465 (high), 0581 (high), 0792.

**Brown & Freitas 1994:** assoc_0185, 0359 (high), 0401 (high), 0726.

**Hayward 1969 / 1931c / 1943 / 1960:** assoc_0081 (high, heliconiine), 0654 (high), 0080 (high, heliconiine), 0231, 0232 (high).

**Arruda & Arruda 1971:** assoc_0331, 0503 (high).

**DeVries 1987:** assoc_0027, 0807 (high).

**Lamas 1985 (only those with corroboration or a real embedded primary):** assoc_0565 (low), 0620 (low), 0621 (low), 0631 (low), 0634 (medium, corroborated by McClure & Elias 2016), 0642 (low), 0647 (medium, corroborated by Hill & Tipan 2008), 0683 (low), 0688 (low), 0724 (low), 0784 (low), 0804 (low), 0808 (low).

**Single classic-source rows:** assoc_0016 (Mueller 1886), 0040 (Fonseca & Amante 1973), 0330 (Almeida 1922), 0337 (Brown & Benson 1975a), 0501 (Lima 1928, high), 0540 (Vasconcellos-Neto 1991), 0546 (Fassl 1912, high), 0870 (Fassl 1912), 0857 (Isabel/Muriel 2011), 0852 (Isabel/Muriel 2011), 0196 (Ac/D&B 1987), 0637 (Am/D&B 1987, low), 0658 (Otero & Marigo 1990, medium), 0711 (Freitas 1993, high), 0623 (Andrews 1983, low).

**Captive-only Hall 1996 rows downgraded to literature/low:** assoc_0214, 0218. Field-observation p.c. via Hill 2006: assoc_0846.

## 6. Records to keep as `needs_check`

The governing rules are: (a) a Beccaloni open-circle dubious marker stays `needs_check` absent an independent direct source; (b) untraceable/dubious primary sources cannot clear catalogue-level literature; (c) atypical host genera require corroboration; (d) captive-only and snippet-only bases are insufficient.

**Beccaloni-dubious Brunfelsia/Solanaceae (Solanaceae-correct but flagged):** assoc_0037, 0038, 0039, 0150, 0151, 0765 (Dircenna/Episcada/Pteronymia on Brunfelsia), 0165, 0169, 0186, 0462, 0498, 0700, 0701, 0712 (D&B rows flagged dubious).

**Beccaloni-dubious Heliconiinae rows:** assoc_0301, 0318, 0327, 0339, 0346, 0353, 0355, 0356.

**Atypical host genus + dubious:** assoc_0492, 0564, 0573, 0538, 0572, 0660, 0713, 0714.

**Napeogenes/other dubious-marked:** assoc_0672 (medium, two non-independent sources), 0375 (Young 1978e dubious), 0400, 0403, 0443 (DeVries 1986 dubious), 0636, 0677, 0678 (Lamas dubious), 0748 (Young 1974c dubious + atypical Capsicum).

**Untraceable Varga 1997:** assoc_0148, 0715.

**Young 1979 mismatched/snippet-only:** assoc_0839.

**Lamas-only untraceable trails (no corroboration, no embedded real primary):** assoc_0012, 0017, 0022, 0065, 0141, 0189, 0294, 0364, 0387, 0429, 0430, 0435, 0439, 0464, 0472, 0547.

**Hayward 1969 dubious:** assoc_0149, 0177.

**Arruda & Arruda dubious:** assoc_0660.

## 7. Confirmed `direct` records

Nine records rest on genuine primary rearing or field host-use studies, not catalogue echoes:

| id | butterfly | host | source |
|---|---|---|---|
| assoc_0853 | Ceratinia tutia | Solanum aphyodendron | Muriel et al. 2011 (reared) |
| assoc_0850 | Mechanitis menapis | Solanum atropurpureum | Muriel et al. 2011 (reared, new host record) |
| assoc_0856 | Mechanitis menapis | Solanum rudepannum | Muriel et al. 2011 (reared, corroborated Constantino 1996) |
| assoc_0865 | Mechanitis messenoides | Solanum cf. sessiliflorum | Hill et al. 2012 (field) |
| assoc_0866 | Mechanitis messenoides | Solanum cf. cacosmum | Hill et al. 2012 (field) |
| assoc_0867 | Mechanitis messenoides | naranjilla-like Solanum | Hill et al. 2012 (field) |
| assoc_0868 | Mechanitis messenoides | naranjilla-like Solanum seedling | Hill et al. 2012 (field) |
| assoc_0845 | Forbestra olivencia | Solanum monarchostemon | Hill 2006 (full text verified, vouchered rearing) |
| assoc_0858 | Hypoleria ocalea | Cestrum sp. | Muriel et al. 2011 (reared); held at literature/high pending metadata cleanup |

Note: assoc_0858 is treated as literature/high rather than direct only because its display metadata still points to Beccaloni and the primary was not independently re-verified; biologically it meets the direct bar.

## 8. Method limitations and caveats

1. **Catalogue-level ceiling.** Most records reach the database through Beccaloni et al. 2008, a peer-reviewed compilation. Compilation-mediated records can support `literature` at most, never `direct`, even when the embedded primary reports rearing, unless that primary was independently retrieved. Only Hill 2006 was full-text verified in this audit.
2. **Offline classic sources.** Many embedded primaries (Hayward, Mueller 1886, Fassl 1912, Lima 1928, Almeida 1922, Biezanko, Silva et al. 1968, Drummond & Brown 1987) are old or regional and were not retrieved. They are treated as real per domain rules, but a curator should confirm that the cited row actually reports feeding/oviposition before any upgrade to direct.
3. **Boilerplate metadata mismatches.** Numerous records carry evidence_basis/evidence_detail fields that cite "Drummond & Brown 1987" or "Costa 1999" or "Lamas-only" trails that do not match the actual source_refs. These are copy-paste artifacts. They were disregarded for the verdict but should be cleaned so stored confidence and source attribution are consistent.
4. **DOI/URL mismatches.** Several direct records (e.g. assoc_0853, 0845, 0857, 0852) have doi_or_url pointing to the Beccaloni catalogue rather than the real primary (Muriel et al. 2011 DOI 10.17533/udea.acbi.14326; Hill 2006). Links should be corrected.
5. **Non-Ithomiini contamination.** Around 30 rows are Heliconiinae (Dryas iulia, Heliconius erato/numata/sara). Their Passiflora hosts are biologically correct but these taxa do not belong in an Ithomiini host dataset and should be excluded from default Ithomiini overlays regardless of evidence level.
6. **Unverifiable sources.** Varga 1997, Andrews 1983, and the Young 1979 DOI target could not be confirmed; these rows should not be promoted until the primary text is located.
7. **Human curator checklist.** Priority manual checks: (a) retrieve Muriel et al. 2011 and Hill et al. 2012 to lock in the nine direct records and fix their links; (b) verify whether Beccaloni-dubious atypical rows (Datura, Brunfelsia-on-Mechanitis, Jaltomata, Capsicum) are true hosts or catalogue errors; (c) resolve the Lamas-only untraceable trails; (d) clean the boilerplate evidence_basis mismatches; (e) decide a global policy for excluding Heliconiinae taxa.
