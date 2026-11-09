import sys
import unittest
from pathlib import Path

import pandas as pd

# process_data imports its neighbours (spatial_qc) by plain name, as when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import process_data


class MimicryLookupTests(unittest.TestCase):
    def setUp(self):
        process_data.MIMICRY_LOOKUP.clear()

    def test_species_fallback_requires_all_subspecies_to_share_ring_for_sex(self):
        dore_df = pd.DataFrame([
            {
                "Genus": "Testus",
                "Species": "mixed",
                "Sub.species": "alpha",
                "M.mimicry": "orange",
                "F.mimicry": "blue",
            },
            {
                "Genus": "Testus",
                "Species": "mixed",
                "Sub.species": "beta",
                "M.mimicry": "orange",
                "F.mimicry": "green",
            },
        ])

        process_data.build_mimicry_lookup(dore_df)

        self.assertEqual(
            process_data.get_mimicry_for_row({
                "scientific_name": "Testus mixed",
                "subspecies": "alpha",
                "sex": "female",
            }),
            "Blue",
        )
        self.assertEqual(
            process_data.get_mimicry_for_row({
                "scientific_name": "Testus mixed",
                "subspecies": None,
                "sex": "male",
            }),
            "Orange",
        )
        self.assertEqual(
            process_data.get_mimicry_for_row({
                "scientific_name": "Testus mixed",
                "subspecies": None,
                "sex": "female",
            }),
            "Unknown",
        )

        assignment = process_data.lookup_mimicry_assignment(
            "Testus mixed",
            subspecies=None,
            sex="male",
        )
        self.assertEqual(assignment["assignment_level"], "species_unambiguous_subspecies")
        self.assertEqual(assignment["confidence"], "propagated_unambiguous")
        self.assertEqual(assignment["source_taxon"], "Testus mixed")


class SyntheticIdTests(unittest.TestCase):
    def _sheet(self):
        return pd.DataFrame([
            {"CAM_ID": "CAM000001", "FieldMark_ID": "A1", "SPECIES": "Testus one", "Collection_date": "1-Jan-22"},
            {"CAM_ID": "not given", "FieldMark_ID": "A2", "SPECIES": "Testus two", "Collection_date": "2-Jan-22"},
            {"CAM_ID": None, "FieldMark_ID": None, "SPECIES": "Testus two", "Collection_date": "3-Jan-22"},
            {"CAM_ID": None, "FieldMark_ID": None, "SPECIES": "Testus two", "Collection_date": "3-Jan-22"},
            {"CAM_ID": "Unknown", "FieldMark_ID": "A5", "SPECIES": "Testus three", "Collection_date": "4-Jan-22"},
        ])

    def test_real_ids_kept_and_missing_ids_are_unique_synthetic(self):
        df = self._sheet()
        ids, n = process_data.fill_synthetic_ids(
            process_data.clean_id(df["CAM_ID"]), df, "SANGER", ["FieldMark_ID", "SPECIES", "Collection_date"])
        self.assertEqual(n, 4)
        self.assertEqual(ids.iloc[0], "CAM000001")
        synthetic = list(ids.iloc[1:])
        self.assertEqual(len(set(synthetic)), 4)
        for value in synthetic:
            self.assertTrue(value.startswith("NOID-SANGER-"))
            self.assertNotIn("CAM", value)
        # Identical rows are told apart in sheet order.
        self.assertEqual(ids.iloc[3], ids.iloc[2] + "-2")

    def test_synthetic_id_does_not_depend_on_row_position(self):
        df = self._sheet()
        cols = ["FieldMark_ID", "SPECIES", "Collection_date"]
        ids, _ = process_data.fill_synthetic_ids(process_data.clean_id(df["CAM_ID"]), df, "SANGER", cols)
        shuffled = df.iloc[[4, 0, 1]].reset_index(drop=True)
        ids2, _ = process_data.fill_synthetic_ids(process_data.clean_id(shuffled["CAM_ID"]), shuffled, "SANGER", cols)
        self.assertEqual(ids2.iloc[0], ids.iloc[4])
        self.assertEqual(ids2.iloc[2], ids.iloc[1])

    def test_placeholder_detection(self):
        for value in [None, float("nan"), "", " NOT GIVEN ", "unknown", "NA", "N/A", "TO BE ASSIGNED"]:
            self.assertTrue(process_data.is_placeholder_id(value), value)
        for value in ["CAM071479", "ME22_100", "DORE_12", "4123456789"]:
            self.assertFalse(process_data.is_placeholder_id(value), value)


if __name__ == "__main__":
    unittest.main()
