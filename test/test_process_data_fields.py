"""Field cleaning in scripts/process_data.py: sex, specimen ids and synthetic ids for rows without a CAM ID.

Expected values come from what the lab and Darwin Core mean by each value, not from re-running the code's rules.
"""
import re
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# process_data imports its neighbours (spatial_qc) by plain name, as when run as a script.
sys.path.insert(0, str(ROOT / "scripts"))

from scripts import process_data  # noqa: E402

# ── normalize_sex ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    # Collection sheet spellings
    ("female", "female"),
    ("male", "male"),
    ("F", "female"),
    ("M", "male"),
    ("f", "female"),
    ("m", "male"),
    ("Female ", "female"),
    (" F", "female"),
    (" Male", "male"),
    # Darwin Core / GBIF vocabulary (upper case)
    ("FEMALE", "female"),
    ("MALE", "male"),
    ("HERMAPHRODITE", "hermaphrodite"),
    # Uncertain calls written in the sheet still count as that sex on the map
    ("female ?", "female"),
    ("female_?", "female"),
    ("male ?", "male"),
])
def test_normalize_sex_reads_each_spelling_of_a_known_sex(raw, expected):
    assert process_data.normalize_sex(raw) == expected


@pytest.mark.parametrize("raw", [
    "", None, float("nan"), "nan", "NA", "NOT_COLLECTED", "Unknown", "UNKNOWN", "unknown", "?", "x",
])
def test_normalize_sex_leaves_blank_and_unknown_values_without_a_sex(raw):
    assert process_data.normalize_sex(raw) is None


def test_females_and_males_of_one_column_keep_their_own_sex():
    # One column as the pipeline sees it (df['Sex'].apply(normalize_sex)): no female may become male.
    sheet = pd.Series(["female", "Male", "F", "m", "FEMALE", None, "Female "])
    sexes = [None if pd.isna(v) else v for v in sheet.apply(process_data.normalize_sex)]
    assert sexes == ["female", "male", "female", "male", "female", None, "female"]


# ── clean_id ─────────────────────────────────────────────────────────────────

def test_clean_id_matches_a_photo_name_to_its_record_whatever_the_case_and_padding():
    record_ids = process_data.clean_id(pd.Series([" CAM071479 ", "cam000123", "CAM000124"]))
    photo_ids = process_data.clean_id(pd.Series(["cam071479", "CAM000123", " Cam000124"]))
    assert list(record_ids) == ["CAM071479", "CAM000123", "CAM000124"]
    assert list(photo_ids) == list(record_ids)


def test_clean_id_turns_missing_values_into_blank_not_text():
    # A photo without a CAM number in its name, or an empty sheet cell, must not become the id "NAN" or "NONE".
    # pandas 2 gives '' and pandas 3 keeps the missing value; both count as "no id" downstream.
    ids = process_data.clean_id(pd.Series([None, float("nan"), "NA", "na", "nan", "None"]))
    assert ["" if pd.isna(v) else v for v in ids] == ["", "", "", "", "", ""]


def test_clean_id_keeps_other_id_kinds_and_placeholders_as_text():
    ids = process_data.clean_id(pd.Series(["me22_100", "DORE_12", 4123456789, "not given", "N/A"]))
    assert list(ids) == ["ME22_100", "DORE_12", "4123456789", "NOT GIVEN", "N/A"]


# ── fill_synthetic_ids ───────────────────────────────────────────────────────

KEYS = ["FieldMark_ID", "SPECIES", "Sex", "Collection_date", "Collection_location"]
SYNTHETIC = re.compile(r"^NOID-SANGER-[0-9A-F]{10}$")


def _rows(*rows):
    return pd.DataFrame([dict(zip(["CAM_ID", *KEYS], row)) for row in rows])


def _fill(df, tag="SANGER", keys=KEYS):
    return process_data.fill_synthetic_ids(process_data.clean_id(df["CAM_ID"]), df, tag, keys)


def test_identical_placeholder_rows_get_distinct_ids_numbered_in_sheet_order():
    # Three specimens caught together and written identically, none with a CAM ID.
    same = (None, None, "Mechanitis polymnia", "female", "3-Jan-22", "Mashpi")
    df = _rows(same, ("NOT GIVEN",) + same[1:], ("unknown",) + same[1:])
    ids, n = _fill(df)
    base = ids.iloc[0]
    assert SYNTHETIC.match(base)
    assert list(ids) == [base, f"{base}-2", f"{base}-3"]
    assert n == 3


def test_numbering_follows_each_group_when_identical_rows_are_interleaved():
    a = (None, None, "Mechanitis polymnia", "female", "3-Jan-22", "Mashpi")
    b = (None, None, "Mechanitis polymnia", "male", "3-Jan-22", "Mashpi")
    ids, _ = _fill(_rows(a, b, a, b, a))
    assert ids.iloc[0] != ids.iloc[1]
    assert list(ids) == [ids.iloc[0], ids.iloc[1], f"{ids.iloc[0]}-2", f"{ids.iloc[1]}-2", f"{ids.iloc[0]}-3"]


def test_real_cam_ids_are_kept_even_when_repeated():
    row = ("CAM071479", "A1", "Ithomia salapia", "male", "1-Jan-22", "Mindo")
    ids, n = _fill(_rows(row, row))
    assert list(ids) == ["CAM071479", "CAM071479"]
    assert n == 0


def test_synthetic_ids_are_the_same_on_every_rerun_and_after_rows_are_added():
    # Shared links and the photo review keep a record's id, so a data refresh must not renumber it.
    rows = [
        (None, "A2", "Ithomia salapia", "male", "1-Jan-22", "Mindo"),
        ("TBA", None, "Oleria onega", "female", "2-Jan-22", "Mashpi"),
    ]
    first, _ = _fill(_rows(*rows))
    again, _ = _fill(_rows(*rows))
    grown, _ = _fill(_rows(("CAM000001", "A0", "Ithomia salapia", "female", "1-Jan-22", "Mindo"), *rows))
    assert list(again) == list(first)
    assert list(grown.iloc[1:]) == list(first)
    # Recorded once on 8 Nov 2026: a change to the hashing would silently give every record without a
    # CAM ID a new id at the next data refresh.
    assert first.iloc[0] == "NOID-SANGER-B2A533664D"


def test_rows_that_differ_in_any_key_get_different_ids_and_the_source_is_named():
    base = (None, "A2", "Ithomia salapia", "male", "1-Jan-22", "Mindo")
    other_place = base[:5] + ("Mashpi",)
    ids, _ = _fill(_rows(base, other_place))
    assert SYNTHETIC.match(ids.iloc[0]) and SYNTHETIC.match(ids.iloc[1])
    assert ids.iloc[0] != ids.iloc[1]
    gbif, _ = _fill(_rows(base), tag="GBIF")
    assert gbif.iloc[0].startswith("NOID-GBIF-")


def test_key_columns_missing_from_the_sheet_are_ignored():
    df = _rows((None, "A2", "Ithomia salapia", "male", "1-Jan-22", "Mindo"))
    with_extra, _ = _fill(df, keys=KEYS + ["Tube_1_id"])
    plain, _ = _fill(df)
    assert list(with_extra) == list(plain)
