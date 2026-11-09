import csv
import unittest
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import gbif_download_api


class GbifDownloadApiTests(unittest.TestCase):
    def test_validate_genus_match_rejects_higher_rank_and_wrong_family(self):
        ok, reason = gbif_download_api._validate_genus_match(
            "Mechanitis",
            {
                "matchType": "HIGHERRANK",
                "rank": "FAMILY",
                "canonicalName": "Nymphalidae",
                "order": "Lepidoptera",
                "family": "Nymphalidae",
            },
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "matched_higher_rank")

        ok, reason = gbif_download_api._validate_genus_match(
            "Charis",
            {
                "matchType": "EXACT",
                "rank": "GENUS",
                "canonicalName": "Charis",
                "order": "Coleoptera",
                "family": "Cerambycidae",
            },
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "wrong_order:Coleoptera")

        # Dismorphia (Pieridae) mimics ithomiines: a Lepidoptera genus outside Nymphalidae is rejected too.
        ok, reason = gbif_download_api._validate_genus_match(
            "Dismorphia",
            {
                "matchType": "EXACT",
                "rank": "GENUS",
                "canonicalName": "Dismorphia",
                "order": "Lepidoptera",
                "family": "Pieridae",
            },
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "wrong_family:Pieridae")

    def test_get_genus_taxon_key_requires_exact_canonical_name(self):
        class MockResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "usageKey": 1920474,
                    "matchType": "FUZZY",
                    "rank": "GENUS",
                    "canonicalName": "Patia",
                    "order": "Lepidoptera",
                    "family": "Pieridae",
                }

        with patch("scripts.gbif_download_api.requests.get", return_value=MockResponse()):
            key, validation = gbif_download_api.get_genus_taxon_key(
                "Patricia",
                expected_family=None,
            )

        self.assertIsNone(key)
        self.assertEqual(validation["reason"], "wrong_name:Patia")

    def test_cached_taxon_keys_are_pruned_to_configured_genera(self):
        genera, validation = gbif_download_api.validate_cached_taxon_keys(
            {"Mechanitis": 1902433, "Charis": 8416631},
            ["Mechanitis"],
        )

        self.assertEqual(genera, {"Mechanitis": 1902433})
        self.assertIn(
            {
                "query": "Charis",
                "usageKey": 8416631,
                "accepted": False,
                "reason": "not_in_configured_download_list",
            },
            validation,
        )



class OccurrenceImportTests(unittest.TestCase):
    def test_import_keeps_each_records_sex_and_collection_date(self):
        # The map's sex filter and date range read these two Darwin Core fields straight from the import.
        columns = ['gbifID', 'decimalLatitude', 'decimalLongitude', 'genus', 'specificEpithet',
                   'scientificName', 'sex', 'eventDate']
        rows = [
            ['11', '-1', '-77', 'Ithomia', 'salapia', 'Ithomia salapia Hewitson, 1852', 'FEMALE', '2019-03-14'],
            ['12', '-1', '-77', 'Ithomia', 'salapia', 'Ithomia salapia Hewitson, 1852', 'MALE', '1997-11-07/1997-11-10'],
            ['13', '-1', '-77', 'Ithomia', 'salapia', 'Ithomia salapia Hewitson, 1852', '', ''],
        ]
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'occurrence.txt'
            with open(path, 'w', encoding='utf-8', newline='') as handle:
                writer = csv.writer(handle, delimiter='\t')
                writer.writerow(columns)
                writer.writerows(rows)
            records, _ = gbif_download_api.process_occurrence_file(path)

        by_id = {record['id']: record for record in records}
        self.assertEqual((by_id['11']['sex'], by_id['11']['collection_date']), ('FEMALE', '2019-03-14'))
        self.assertEqual((by_id['12']['sex'], by_id['12']['collection_date']), ('MALE', '1997-11-07/1997-11-10'))
        # A blank cell stays without a sex or date (None or empty), never another record's value.
        self.assertIn(by_id['13']['sex'], (None, ''))
        self.assertIn(by_id['13']['collection_date'], (None, ''))


if __name__ == "__main__":
    unittest.main()
