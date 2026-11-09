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


class PlaceholderIdTests(unittest.TestCase):
    # Synthetic-id numbering and stability: test_process_data_fields.py.
    def test_placeholder_detection(self):
        for value in [None, float("nan"), "", " NOT GIVEN ", "unknown", "NA", "N/A", "TO BE ASSIGNED"]:
            self.assertTrue(process_data.is_placeholder_id(value), value)
        for value in ["CAM071479", "ME22_100", "DORE_12", "4123456789"]:
            self.assertFalse(process_data.is_placeholder_id(value), value)


if __name__ == "__main__":
    unittest.main()
