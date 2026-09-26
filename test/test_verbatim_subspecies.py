import csv
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import gbif_download_api
from scripts.verbatim_subspecies import parse_verbatim_subspecies


class VerbatimSubspeciesTests(unittest.TestCase):
    def test_reads_subspecies_from_published_names(self):
        cases = {
            "Ithomia salapia derasa Hewitson, 1855": "derasa",
            "ithomia salapia derasa": "derasa",
            "Ithomia salapia ssp. aquinia": "aquinia",
            "Ithomia salapia subsp. travella": "travella",
            "Ithomia salapia salapia": "salapia",
            "Tithorea harmonia megara (Godart, 1819)": "megara",
            "Olyras crathis weeksi - a rare species!": "weeksi",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                genus, species = name.split()[:2]
                self.assertEqual(parse_verbatim_subspecies(name, f"{genus} {species}"), expected)

    def test_rejects_authors_qualifiers_and_other_species(self):
        cases = [
            ("Ithomia salapia Hewitson, 1853", "Ithomia salapia"),
            ("Ithomia salapia Hewitson 1853", "Ithomia salapia"),
            ("Ithomia salapia (Hewitson, 1853)", "Ithomia salapia"),
            ("Ithomia salapia \xa0", "Ithomia salapia"),
            ("Oleria agarista v IN", "Oleria agarista"),
            ("Mechanitis polymnia cf. casabranca", "Mechanitis polymnia"),
            ("Mechanitis polymnia f. casabranca", "Mechanitis polymnia"),
            ("Pteronymia sp.nov. RM-2004", "Pteronymia sp.nov."),
            ("Ithomia agnosia derasa", "Ithomia salapia"),
            (None, "Ithomia salapia"),
        ]
        for name, binomial in cases:
            with self.subTest(name=name):
                self.assertIsNone(parse_verbatim_subspecies(name, binomial))


class OccurrenceSubspeciesTests(unittest.TestCase):
    def test_falls_back_to_verbatim_name_when_backbone_lacks_the_subspecies(self):
        columns = ['gbifID', 'decimalLatitude', 'decimalLongitude', 'genus', 'specificEpithet',
                   'infraspecificEpithet', 'scientificName', 'verbatimScientificName']
        rows = [
            ['1', '-1', '-77', 'Ithomia', 'salapia', 'travella', 'Ithomia salapia travella Haensch, 1903', ''],
            ['2', '-1', '-77', 'Ithomia', 'salapia', '', 'Ithomia salapia Hewitson, 1852', 'Ithomia salapia derasa'],
            ['3', '-1', '-77', 'Ithomia', 'salapia', '', 'Ithomia salapia Hewitson, 1852', 'Ithomia salapia Hewitson, 1853'],
        ]
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'occurrence.txt'
            with open(path, 'w', encoding='utf-8', newline='') as handle:
                writer = csv.writer(handle, delimiter='\t')
                writer.writerow(columns)
                writer.writerows(rows)
            records, _ = gbif_download_api.process_occurrence_file(path)

        by_id = {record['id']: record for record in records}
        self.assertEqual((by_id['1']['subspecies'], by_id['1']['subspecies_source']), ('travella', 'gbif_interpreted'))
        self.assertEqual((by_id['2']['subspecies'], by_id['2']['subspecies_source']), ('derasa', 'verbatim_name'))
        self.assertEqual((by_id['3']['subspecies'], by_id['3']['subspecies_source']), (None, None))


if __name__ == '__main__':
    unittest.main()
