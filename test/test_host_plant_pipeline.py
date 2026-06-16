import unittest
import json
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.host_plants.host_plant_pipeline import (
    apply_confidence_audit,
    build_association_outputs,
    canonical_host_taxon,
    confidence_allows_default_download,
    confidence_is_excluded,
    attach_multimedia_to_occurrences,
    process_download_api_occurrences,
    resolve_taxon,
    selected_taxa_for_download_request,
    select_taxa_for_occurrence_download,
    taxon_key_map,
    normalize_host_id_level,
    normalize_evidence_level,
    apply_source_level_audit,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class HostPlantPipelineTests(unittest.TestCase):

    def test_anteparra_pdf_evidence_is_curated_for_mechanitis_polymnia_sessiliflorum(self):
        supplement_path = PROJECT_ROOT / "scripts" / "host_plants" / "host_plant_literature_supplement.json"
        supplement = json.loads(supplement_path.read_text(encoding="utf-8"))

        matching_records = [
            record
            for record in supplement["records"]
            if record.get("butterfly_taxon") == "Mechanitis polymnia"
            and record.get("host_plant_species") == "Solanum sessiliflorum"
            and record.get("doi_or_url") == "https://doi.org/10.32911/as.2011.v4.n1.530"
        ]

        self.assertEqual(len(matching_records), 1)
        record = matching_records[0]
        self.assertEqual(record["confidence"], "high")
        self.assertEqual(record["evidence_level"], "direct")
        self.assertIn("field-collected eggs and larvae", record["evidence_type"])
        self.assertIn("Tingo Maria", record["source_refs"])

    def test_host_id_and_evidence_fields_are_normalized(self):
        records = [
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_species": "Prestonia coalita",
                "host_plant_genus": "Prestonia",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "species",
                "confidence": "high",
                "evidence_type": "larvae feeding observed in field",
                "evidence_basis": "Direct juvenile-stage evidence.",
            },
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_genus": "Markea",
                "host_plant_family": "Solanaceae",
                "host_taxon_rank": "genus_spp",
                "confidence": "low",
                "evidence_type": "catalogue record",
            },
        ]

        associations, taxa = build_association_outputs(records)

        by_name = {association["host_taxon_name"]: association for association in associations}
        self.assertEqual(by_name["Prestonia coalita"]["host_id_level"], "species")
        self.assertEqual(by_name["Prestonia coalita"]["evidence_level"], "direct")
        self.assertEqual(by_name["Prestonia coalita"]["evidence_detail"], "Direct juvenile-stage evidence.")
        self.assertEqual(by_name["Markea"]["host_id_level"], "genus")
        self.assertEqual(by_name["Markea"]["evidence_level"], "literature")
        taxa_by_name = {taxon["canonical_name"]: taxon for taxon in taxa}
        self.assertEqual(taxa_by_name["Markea"]["host_id_level_counts"], {"genus": 1})
        self.assertEqual(taxa_by_name["Prestonia coalita"]["evidence_counts"], {"direct": 1})

    def test_source_level_audit_can_override_new_evidence_fields(self):
        records = [{
            "butterfly_taxon": "Aeria elara",
            "host_plant_family": "Apocynaceae",
            "host_taxon_rank": "family",
            "confidence": "low",
            "evidence_type": "catalogue row",
        }]

        apply_source_level_audit(records, {1: {
            "evidence_level": "needs_check",
            "evidence_detail": "Family-only Beccaloni fallback; check primary refs.",
            "host_id_level": "family",
        }})
        associations, _taxa = build_association_outputs(records)

        self.assertEqual(associations[0]["host_id_level"], "family")
        self.assertEqual(associations[0]["evidence_level"], "needs_check")
        self.assertIn("Family-only", associations[0]["evidence_detail"])

    def test_source_level_audit_overrides_source_url(self):
        # A Beccaloni-mediated row whose display citation would otherwise map to
        # the Beccaloni PDF can be repointed to the cited primary source.
        records = [{
            "butterfly_taxon": "Ceratinia tutia",
            "host_plant_species": "Solanum aphyodendron",
            "host_plant_genus": "Solanum",
            "host_plant_family": "Solanaceae",
            "host_taxon_rank": "species",
            "confidence": "high",
            "source_citation": "Beccaloni et al. 2008",
            "doi_or_url": "https://www.cabidigitallibrary.org/doi/full/10.5555/20093181648",
        }]

        apply_source_level_audit(records, {1: {
            "evidence_level": "direct",
            "source_url_override": "https://doi.org/10.17533/udea.acbi.14326",
        }})
        associations, _taxa = build_association_outputs(records)

        self.assertEqual(associations[0]["evidence_level"], "direct")
        self.assertEqual(
            associations[0]["doi_or_url"],
            "https://doi.org/10.17533/udea.acbi.14326",
        )

    def test_normalization_helpers_map_rank_and_source_text(self):
        self.assertEqual(normalize_host_id_level("genus_spp"), "genus")
        self.assertEqual(normalize_host_id_level("unidentified_species"), "family")
        self.assertEqual(normalize_evidence_level("eggs observed on plant"), "direct")
        self.assertEqual(normalize_evidence_level("Beccaloni catalogue citation"), "literature")
        self.assertEqual(normalize_evidence_level("unresolved needs check"), "needs_check")
    def test_excludes_records_marked_exclude_or_erroneous(self):
        records = [
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_species": "Prestonia coalita",
                "host_plant_genus": "Prestonia",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "species",
                "confidence": "medium",
                "source_citation": "Source",
            },
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_species": "Solanum badrecord",
                "host_plant_genus": "Solanum",
                "host_plant_family": "Solanaceae",
                "host_taxon_rank": "species",
                "confidence": "exclude",
                "caveats": "Erroneous host record.",
            },
        ]

        associations, taxa = build_association_outputs(records)

        self.assertEqual(len(associations), 1)
        self.assertEqual(associations[0]["host_taxon_name"], "Prestonia coalita")
        self.assertEqual([taxon["canonical_name"] for taxon in taxa], ["Prestonia coalita"])

    def test_low_confidence_association_is_kept_but_not_default_download_target(self):
        records = [
            {
                "butterfly_taxon": "Callithomia alexirrhoe",
                "host_plant_genus": "Solanum",
                "host_plant_family": "Solanaceae",
                "host_taxon_rank": "genus_spp",
                "confidence": "low",
                "evidence_type": "dubious catalogue row",
                "source_citation": "Source",
            }
        ]

        associations, taxa = build_association_outputs(records)

        self.assertEqual(len(associations), 1)
        self.assertEqual(associations[0]["confidence"], "low")
        self.assertFalse(associations[0]["use_for_default_download"])
        self.assertFalse(taxa[0]["use_for_default_download"])

    def test_deduplicates_taxa_by_name_rank_and_family(self):
        records = [
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_species": "Prestonia coalita",
                "host_plant_genus": "Prestonia",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "species",
                "confidence": "medium",
            },
            {
                "butterfly_taxon": "Aeria olena",
                "host_plant_species": "Prestonia coalita",
                "host_plant_genus": "Prestonia",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "species",
                "confidence": "high",
            },
        ]

        associations, taxa = build_association_outputs(records)

        self.assertEqual(len(associations), 2)
        self.assertEqual(len(taxa), 1)
        self.assertEqual(taxa[0]["association_count"], 2)
        self.assertEqual(taxa[0]["confidence_counts"], {"medium": 1, "high": 1})

    def test_family_level_records_do_not_become_species_targets(self):
        taxon = canonical_host_taxon({
            "host_plant_name_verbatim": "Unidentified species",
            "host_plant_family": "Apocynaceae",
            "host_taxon_rank": "unidentified_species",
        })

        self.assertEqual(taxon["canonical_name"], "Apocynaceae")
        self.assertEqual(taxon["rank"], "family")
        self.assertFalse(taxon["resolvable_to_gbif"])

    def test_uses_host_plant_species_value_without_pipeline_name_correction(self):
        taxon = canonical_host_taxon({
            "host_plant_species": "Solanum stramonifolium",
            "host_plant_genus": "Solanum",
            "host_plant_family": "Solanaceae",
            "host_taxon_rank": "species",
        })

        self.assertEqual(taxon["canonical_name"], "Solanum stramonifolium")
        self.assertEqual(taxon["slug"], "species_solanum_stramonifolium")

    def test_confidence_helpers_are_case_insensitive(self):
        self.assertTrue(confidence_is_excluded("Exclude"))
        self.assertTrue(confidence_allows_default_download("HIGH"))
        self.assertFalse(confidence_allows_default_download("low"))

    def test_confidence_audit_overrides_records_before_association_build(self):
        records = [
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_species": "Prestonia coalita",
                "host_plant_genus": "Prestonia",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "species",
                "confidence": "medium",
            }
        ]
        apply_confidence_audit(records, {
            1: {
                "curated_confidence": "high",
                "curation_action": "upgrade",
                "evidence_basis": "Direct juvenile-stage evidence.",
                "citation_for_ui": "Brown & Freitas 1994",
            }
        })

        associations, taxa = build_association_outputs(records)

        self.assertEqual(associations[0]["confidence"], "high")
        self.assertEqual(associations[0]["confidence_bucket"], "high")
        self.assertEqual(associations[0]["curation_action"], "upgrade")
        self.assertEqual(associations[0]["citation_for_ui"], "Brown & Freitas 1994")
        self.assertEqual(
            associations[0]["doi_or_url"],
            "https://journals.flvc.org/troplep/article/download/89949/86313",
        )
        self.assertEqual(taxa[0]["confidence_counts"], {"high": 1})

    def test_source_url_matches_beccaloni_display_citation(self):
        records = [
            {
                "butterfly_taxon": "Aeria elara",
                "host_plant_family": "Apocynaceae",
                "host_taxon_rank": "family",
                "confidence": "low",
                "citation_for_ui": "Beccaloni et al. 2008",
                "doi_or_url": "https://www.cabidigitallibrary.org/doi/full/10.5555/20093181648",
            }
        ]

        associations, _taxa = build_association_outputs(records)

        self.assertIn("researchgate.net", associations[0]["doi_or_url"])
        self.assertIn("Catalogue-of-the-Hostplants", associations[0]["doi_or_url"])

    def test_select_taxa_can_limit_to_species_rank(self):
        taxa = [
            {
                "canonical_name": "Prestonia coalita",
                "slug": "species_prestonia_coalita",
                "rank": "species",
                "resolvable_to_gbif": True,
                "use_for_default_download": True,
            },
            {
                "canonical_name": "Solanum",
                "slug": "genus_solanum",
                "rank": "genus",
                "resolvable_to_gbif": True,
                "use_for_default_download": True,
            },
        ]

        selected = select_taxa_for_occurrence_download(
            taxa,
            taxon_filters=[],
            rank_filters=["species"],
            max_taxa=None,
            include_low_confidence=False,
        )

        self.assertEqual([taxon["slug"] for taxon in selected], ["species_prestonia_coalita"])

    def test_taxon_key_map_uses_slugs_for_download_cache_matching(self):
        taxa = [
            {"slug": "species_prestonia_coalita", "gbif_taxon_key": 5536637},
            {"slug": "unresolved", "gbif_taxon_key": None},
        ]

        self.assertEqual(taxon_key_map(taxa), {"species_prestonia_coalita": 5536637})

    def test_species_resolution_rejects_higher_rank_gbif_match(self):
        taxon = {
            "canonical_name": "Solanum stramoniifolium",
            "rank": "species",
            "resolvable_to_gbif": True,
        }

        class MockResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "usageKey": 2928997,
                    "rank": "GENUS",
                    "kingdom": "Plantae",
                    "scientificName": "Solanum L.",
                    "canonicalName": "Solanum",
                    "matchType": "HIGHERRANK",
                    "confidence": 99,
                }

        with patch(
            "scripts.host_plants.host_plant_pipeline.requests.get",
            return_value=MockResponse(),
        ):
            resolution = resolve_taxon(taxon, {"taxa": {}}, refresh=True)

        self.assertEqual(resolution["status"], "not_resolved")
        self.assertIn("refusing higher-rank occurrence layer", resolution["note"])

    def test_zero_download_limit_keeps_all_unique_coordinates(self):
        taxa = [{
            "slug": "species_prestonia_coalita",
            "canonical_name": "Prestonia coalita",
            "rank": "species",
            "species": "Prestonia coalita",
            "genus": "Prestonia",
            "gbif_taxon_key": 5536637,
        }]
        with TemporaryDirectory() as temp_dir:
            occurrence_path = Path(temp_dir) / "occurrence.txt"
            occurrence_path.write_text(
                "\t".join([
                    "taxonKey",
                    "species",
                    "genus",
                    "decimalLongitude",
                    "decimalLatitude",
                    "occurrenceStatus",
                    "gbifID",
                ])
                + "\n"
                + "5536637\tPrestonia coalita\tPrestonia\t-78.1\t-0.1\tPRESENT\t1\n"
                + "5536637\tPrestonia coalita\tPrestonia\t-78.2\t-0.2\tPRESENT\t2\n"
                + "5536637\tPrestonia coalita\tPrestonia\t-78.3\t-0.3\tPRESENT\t3\n",
                encoding="utf-8",
            )

            results = process_download_api_occurrences(
                Path(temp_dir),
                taxa,
                limit=0,
                download_info={"key": "test-download", "doi": "10.15468/test"},
            )

        records, meta = results["species_prestonia_coalita"]
        self.assertEqual(len(records), 3)
        self.assertIsNone(meta["limit"])

    def test_download_processing_excludes_high_coordinate_uncertainty(self):
        taxa = [{
            "slug": "species_prestonia_coalita",
            "canonical_name": "Prestonia coalita",
            "rank": "species",
            "species": "Prestonia coalita",
            "genus": "Prestonia",
            "gbif_taxon_key": 5536637,
        }]
        with TemporaryDirectory() as temp_dir:
            occurrence_path = Path(temp_dir) / "occurrence.txt"
            occurrence_path.write_text(
                "\t".join([
                    "taxonKey",
                    "species",
                    "genus",
                    "decimalLongitude",
                    "decimalLatitude",
                    "coordinateUncertaintyInMeters",
                    "occurrenceStatus",
                    "gbifID",
                ])
                + "\n"
                + "5536637\tPrestonia coalita\tPrestonia\t-78.1\t-0.1\t100000\tPRESENT\t1\n"
                + "5536637\tPrestonia coalita\tPrestonia\t-78.2\t-0.2\t100001\tPRESENT\t2\n",
                encoding="utf-8",
            )

            results = process_download_api_occurrences(
                Path(temp_dir),
                taxa,
                limit=0,
                download_info={"key": "test-download", "doi": "10.15468/test"},
            )

        records, _meta = results["species_prestonia_coalita"]
        self.assertEqual([record["gbifID"] for record in records], ["1"])

    def test_species_chip_does_not_receive_genus_only_rows(self):
        taxa = [
            {
                "slug": "species_solanum_crinitum",
                "canonical_name": "Solanum crinitum",
                "rank": "species",
                "species": "Solanum crinitum",
                "genus": "Solanum",
                "gbif_taxon_key": 2931012,
            },
            {
                "slug": "genus_solanum",
                "canonical_name": "Solanum",
                "rank": "genus",
                "genus": "Solanum",
                "gbif_taxon_key": 2928997,
            },
        ]
        with TemporaryDirectory() as temp_dir:
            occurrence_path = Path(temp_dir) / "occurrence.txt"
            occurrence_path.write_text(
                "taxonKey\tspecies\tgenus\tscientificName\tdecimalLongitude\tdecimalLatitude\toccurrenceStatus\tgbifID\n"
                "2928997\t\tSolanum\tSolanum L.\t-76.1\t-1.1\tPRESENT\tgenus-row\n"
                "2931012\tSolanum crinitum\tSolanum\tSolanum crinitum Lam.\t-76.2\t-1.2\tPRESENT\tspecies-row\n",
                encoding="utf-8",
            )

            results = process_download_api_occurrences(
                Path(temp_dir),
                taxa,
                limit=0,
                download_info={"key": "test-download", "doi": "10.15468/test"},
            )

        species_records, _ = results["species_solanum_crinitum"]
        genus_records, _ = results["genus_solanum"]
        self.assertEqual([record["gbifID"] for record in species_records], ["species-row"])
        self.assertEqual([record["gbifID"] for record in genus_records], ["genus-row", "species-row"])

    def test_species_download_is_suppressed_when_selected_genus_covers_it(self):
        taxa = [
            {
                "slug": "genus_solanum",
                "canonical_name": "Solanum",
                "rank": "genus",
                "genus": "Solanum",
                "gbif_taxon_key": 2928997,
            },
            {
                "slug": "species_solanum_crinitum",
                "canonical_name": "Solanum crinitum",
                "rank": "species",
                "genus": "Solanum",
                "gbif_taxon_key": 2931012,
            },
            {
                "slug": "species_jaltomata_procumbens",
                "canonical_name": "Solanum procumbens",
                "rank": "species",
                "genus": "Solanum",
                "gbif_taxon_key": 123,
                "gbif_resolution": {"genus": "Jaltomata"},
            },
        ]

        targets, suppressed = selected_taxa_for_download_request(taxa)

        self.assertEqual([taxon["slug"] for taxon in targets], ["genus_solanum", "species_jaltomata_procumbens"])
        self.assertEqual(suppressed, {"species_solanum_crinitum": "covered_by_genus:Solanum"})

    def test_multimedia_fallback_uses_same_species_image(self):
        results = {
            "species_solanum": ([
                {"gbifID": "1", "species": "Solanum testum"},
                {"gbifID": "2", "species": "Solanum testum"},
            ], {})
        }
        with TemporaryDirectory() as temp_dir:
            multimedia_path = Path(temp_dir) / "multimedia.txt"
            multimedia_path.write_text(
                "gbifID\ttype\tformat\tidentifier\treferences\tlicense\n"
                "2\tStillImage\timage/jpeg\thttps://example.test/plant.jpg\thttps://gbif.test/2\tCC_BY_4_0\n",
                encoding="utf-8",
            )

            attach_multimedia_to_occurrences(Path(temp_dir), results)

        records, _meta = results["species_solanum"]
        self.assertEqual(records[1]["media"][0]["url"], "https://example.test/plant.jpg")
        self.assertEqual(records[0]["fallback_media"]["url"], "https://example.test/plant.jpg")


if __name__ == "__main__":
    unittest.main()
