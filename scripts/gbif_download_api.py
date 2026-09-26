#!/usr/bin/env python3
"""
GBIF Ithomiini Download API Script
===================================
Downloads ALL Ithomiini occurrences from GBIF using the async Download API.

This provides:
- Complete, citable datasets with DOI
- Research-grade quality filters
- Separation of iNaturalist records as distinct source
- Proper observation URLs for each record

Usage:
    python scripts/gbif_download_api.py           # Normal run (uses cache if recent)
    python scripts/gbif_download_api.py --force   # Force new download
    python scripts/gbif_download_api.py --keys-only  # Just get taxon keys

Output:
    public/data/gbif_occurrences.json  - Occurrence data
    public/data/gbif_citation.json     - Citation/DOI info
    public/data/gbif_taxon_keys.json   - Cached taxon keys
"""

import requests
import json
import sys
import time
import zipfile
import csv
import re
import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from country_utils import standardize_country
from verbatim_subspecies import parse_verbatim_subspecies

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

PROJECT_ROOT = Path(__file__).parent.parent
CREDENTIALS_FILE = PROJECT_ROOT / "gbif_credentials.env"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data"
TEMP_DIR = PROJECT_ROOT / "temp_gbif_download"

OUTPUT_FILE = OUTPUT_DIR / "gbif_occurrences.json"
CITATION_FILE = OUTPUT_DIR / "gbif_citation.json"
TAXON_KEYS_FILE = OUTPUT_DIR / "gbif_taxon_keys.json"
TAXON_KEY_VALIDATION_FILE = OUTPUT_DIR / "gbif_taxon_key_validation.json"
TAXONOMY_CACHE_FILE = OUTPUT_DIR / "gbif_taxonomy_cache.json"

# Cache duration - skip new download if data is less than this old
CACHE_HOURS = 24

# Polling interval for download status
POLL_INTERVAL_SECONDS = 30
MAX_POLL_ATTEMPTS = 120  # 60 minutes max wait

# iNaturalist Research-grade dataset key
INATURALIST_DATASET_KEY = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"

# UNAM institution codes (major Mexican museum collections)
UNAM_INSTITUTION_CODES = {'MZFC-FC-UNAM', 'IBUNAM', 'FC-UNAM', 'FESZ-UNAM'}

# All Ithomiini genera (from Dore et al. database)
ITHOMIINI_GENERA = [
    'Aeria', 'Athesis', 'Athyrtis', 'Brevioleria', 'Callithomia', 'Ceratinia',
    'Dircenna', 'Elzunia', 'Episcada', 'Epityches', 'Eutresis', 'Forbestra',
    'Godyris', 'Greta', 'Haenschia', 'Heterosais', 'Hyalenna', 'Hyalyris',
    'Hypoleria', 'Hypomenitis', 'Hyposcada', 'Hypothyris', 'Ithomia',
    'Mcclungia', 'Mechanitis', 'Megoleria', 'Melinaea', 'Methona',
    'Napeogenes', 'Oleria', 'Ollantaya', 'Olyras', 'Pachacutia', 'Pagyris',
    'Paititia', 'Patricia', 'Placidina', 'Pseudoscada', 'Pteronymia', 'Sais',
    'Scada', 'Thyridia', 'Tithorea', 'Veladyris', 'Velamysta'
]


# ═══════════════════════════════════════════════════════════════════
# CREDENTIALS
# ═══════════════════════════════════════════════════════════════════

def load_credentials():
    """Load GBIF credentials from environment variables or env file."""
    import os

    credentials = {}
    required = ['GBIF_USERNAME', 'GBIF_PASSWORD', 'GBIF_EMAIL']

    # First try environment variables (used by GitHub Actions secrets)
    if all(os.environ.get(k) for k in required):
        for key in required:
            credentials[key] = os.environ[key]
        return credentials

    # Fall back to credentials file (local development)
    if not CREDENTIALS_FILE.exists():
        print("ERROR: No GBIF credentials found.")
        print("Set GBIF_USERNAME, GBIF_PASSWORD, GBIF_EMAIL environment variables,")
        print(f"or create {CREDENTIALS_FILE} with:")
        print("  GBIF_USERNAME=your_username")
        print("  GBIF_PASSWORD=your_password")
        print("  GBIF_EMAIL=your_email")
        sys.exit(1)

    with open(CREDENTIALS_FILE, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                credentials[key.strip()] = value.strip()

    for key in required:
        if key not in credentials:
            print(f"ERROR: Missing {key} in credentials file")
            sys.exit(1)

    return credentials


# ═══════════════════════════════════════════════════════════════════
# TAXON KEY LOOKUP
# ═══════════════════════════════════════════════════════════════════

def _validate_genus_match(genus_name, data, *, expected_family='Nymphalidae'):
    """Return (ok, reason) for a GBIF genus match response."""
    if not data or data.get('matchType') == 'NONE':
        return False, 'no_match'
    if data.get('matchType') == 'HIGHERRANK':
        return False, 'matched_higher_rank'
    if data.get('rank') != 'GENUS':
        return False, f"wrong_rank:{data.get('rank') or 'unknown'}"
    if (data.get('canonicalName') or '').lower() != genus_name.lower():
        return False, f"wrong_name:{data.get('canonicalName') or 'unknown'}"
    if data.get('order') != 'Lepidoptera':
        return False, f"wrong_order:{data.get('order') or 'unknown'}"
    if expected_family and data.get('family') != expected_family:
        return False, f"wrong_family:{data.get('family') or 'unknown'}"
    return True, 'accepted'


def get_genus_taxon_key(genus_name, *, expected_family='Nymphalidae'):
    """Look up and strictly validate the GBIF taxon key for a genus."""
    try:
        match_url = "https://api.gbif.org/v1/species/match"
        params = {
            'name': genus_name,
            'rank': 'GENUS',
            'kingdom': 'Animalia',
            'class': 'Insecta',
            'order': 'Lepidoptera',
            'family': 'Nymphalidae'
        }
        response = requests.get(match_url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        ok, reason = _validate_genus_match(genus_name, data, expected_family=expected_family)
        validation = {
            'query': genus_name,
            'accepted': ok,
            'reason': reason,
            'usageKey': data.get('usageKey'),
            'matchType': data.get('matchType'),
            'rank': data.get('rank'),
            'canonicalName': data.get('canonicalName'),
            'scientificName': data.get('scientificName'),
            'family': data.get('family'),
            'order': data.get('order'),
            'class': data.get('class'),
        }
        return (data.get('usageKey') if ok else None), validation
    except Exception as e:
        print(f"    Error looking up {genus_name}: {e}")
        return None, {
            'query': genus_name,
            'accepted': False,
            'reason': f"lookup_error:{e}",
        }


def validate_cached_taxon_keys(cached_genera, configured_genera):
    """Keep only taxon keys for currently configured genera."""
    configured = set(configured_genera)
    validation = []
    pruned = {}
    for genus in configured_genera:
        key = cached_genera.get(genus)
        if key:
            pruned[genus] = key
            validation.append({
                'query': genus,
                'usageKey': key,
                'accepted': True,
                'reason': 'cached_configured_genus',
            })
        else:
            validation.append({
                'query': genus,
                'accepted': False,
                'reason': 'missing_from_cache',
            })
    for genus, key in sorted(cached_genera.items()):
        if genus not in configured:
            validation.append({
                'query': genus,
                'usageKey': key,
                'accepted': False,
                'reason': 'not_in_configured_download_list',
            })
    return pruned, validation


def get_all_taxon_keys(use_cache=True):
    """Get taxon keys for all Ithomiini genera."""
    # Try to load from cache
    if use_cache and TAXON_KEYS_FILE.exists():
        try:
            with open(TAXON_KEYS_FILE, 'r') as f:
                cached = json.load(f)
            if cached.get('genera') and len(cached['genera']) > 0:
                genera, validation = validate_cached_taxon_keys(cached['genera'], ITHOMIINI_GENERA)
                missing = [row for row in validation if row['reason'] == 'missing_from_cache']
                extras = [row for row in validation if row['reason'] == 'not_in_configured_download_list']
                if not missing:
                    if extras or len(genera) != len(cached['genera']):
                        cache_data = {
                            'created': cached.get('created') or datetime.now().isoformat(),
                            'genera': genera,
                        }
                        with open(TAXON_KEYS_FILE, 'w') as f:
                            json.dump(cache_data, f, indent=2)
                    with open(TAXON_KEY_VALIDATION_FILE, 'w') as f:
                        json.dump({
                            'generated': datetime.now().isoformat(),
                            'source': 'cache',
                            'validation': validation,
                        }, f, indent=2)
                    print(f"Loaded {len(genera)} configured taxon keys from cache")
                    if extras:
                        print(f"Pruned {len(extras)} stale cached taxon key(s) not in configured list")
                    return genera
                print(f"Cache missing {len(missing)} configured genera; refreshing taxon keys")
        except Exception as e:
            print(f"Cache load failed: {e}")

    print(f"Looking up taxon keys for {len(ITHOMIINI_GENERA)} genera...")
    genera_keys = {}
    validation = []

    for i, genus in enumerate(ITHOMIINI_GENERA, 1):
        print(f"  [{i}/{len(ITHOMIINI_GENERA)}] {genus}...", end=" ")
        key, validation_row = get_genus_taxon_key(genus)
        validation.append(validation_row)
        if key:
            genera_keys[genus] = key
            print(f"key={key}")
        else:
            print(f"skipped ({validation_row.get('reason', 'not found')})")
        time.sleep(0.2)  # Be polite

    # Save to cache
    cache_data = {
        'created': datetime.now().isoformat(),
        'genera': genera_keys
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(TAXON_KEYS_FILE, 'w') as f:
        json.dump(cache_data, f, indent=2)
    with open(TAXON_KEY_VALIDATION_FILE, 'w') as f:
        json.dump({
            'generated': datetime.now().isoformat(),
            'source': 'gbif_species_match',
            'validation': validation,
        }, f, indent=2)

    print(f"\nFound {len(genera_keys)} genera with taxon keys")
    return genera_keys


# ═══════════════════════════════════════════════════════════════════
# DOWNLOAD API
# ═══════════════════════════════════════════════════════════════════

def find_recent_download(credentials, taxon_keys, max_age_hours=24):
    """Check GBIF account for a recent completed download with matching taxon keys.

    Returns download info dict if found, None otherwise.
    """
    print("\nChecking for recent completed downloads on GBIF account...", flush=True)
    username = credentials['GBIF_USERNAME']
    url = f"https://api.gbif.org/v1/occurrence/download/user/{username}"

    try:
        response = requests.get(
            url,
            params={"limit": 10, "offset": 0},
            auth=(username, credentials['GBIF_PASSWORD']),
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        current_keys = set(str(v) for v in taxon_keys.values())

        for dl in data.get('results', []):
            status = dl.get('status')
            if status != 'SUCCEEDED':
                continue

            # Check age
            created = dl.get('created')
            if created:
                try:
                    # GBIF returns ISO format like "2026-03-12T13:25:00.000+00:00"
                    created_str = created.split('.')[0]  # strip milliseconds
                    dt = datetime.strptime(created_str, '%Y-%m-%dT%H:%M:%S')
                    age_hours = (datetime.utcnow() - dt).total_seconds() / 3600
                    if age_hours > max_age_hours:
                        continue
                except Exception:
                    continue

            # Check if taxon keys match
            predicate = dl.get('request', {}).get('predicate', {})
            dl_keys = _extract_taxon_keys_from_predicate(predicate)
            if dl_keys and dl_keys == current_keys:
                dl_key = dl.get('key')
                print(f"  Found matching download: {dl_key} ({age_hours:.1f}h old)", flush=True)
                return dl

        print("  No matching recent download found", flush=True)
        return None

    except Exception as e:
        print(f"  Could not check recent downloads: {e}", flush=True)
        return None


def _extract_taxon_keys_from_predicate(predicate):
    """Extract TAXON_KEY values from a GBIF download predicate."""
    if not predicate:
        return None

    pred_type = predicate.get('type', '')

    if pred_type == 'in' and predicate.get('key') == 'TAXON_KEY':
        return set(str(v) for v in predicate.get('values', []))

    # Recurse into compound predicates
    for sub in predicate.get('predicates', []):
        result = _extract_taxon_keys_from_predicate(sub)
        if result:
            return result

    # Check nested predicate (e.g. "not" type)
    nested = predicate.get('predicate')
    if nested:
        return _extract_taxon_keys_from_predicate(nested)

    return None


def submit_download_request(credentials, taxon_keys):
    """Submit async download request to GBIF."""
    print("\nSubmitting download request to GBIF...")

    # Build predicate
    predicate = {
        "type": "and",
        "predicates": [
            # Taxon filter - all Ithomiini genera
            {
                "type": "in",
                "key": "TAXON_KEY",
                "values": list(taxon_keys.values())
            },
            # Quality filters
            {"type": "equals", "key": "HAS_COORDINATE", "value": "true"},
            {"type": "equals", "key": "HAS_GEOSPATIAL_ISSUE", "value": "false"},
            {"type": "equals", "key": "OCCURRENCE_STATUS", "value": "PRESENT"},
            # Exclude fossils and living specimens
            {
                "type": "not",
                "predicate": {
                    "type": "in",
                    "key": "BASIS_OF_RECORD",
                    "values": ["FOSSIL_SPECIMEN", "LIVING_SPECIMEN"]
                }
            }
        ]
    }

    request_body = {
        "creator": credentials['GBIF_USERNAME'],
        "notificationAddresses": [credentials['GBIF_EMAIL']],
        "sendNotification": True,
        "format": "DWCA",
        "predicate": predicate
    }

    url = "https://api.gbif.org/v1/occurrence/download/request"

    try:
        response = requests.post(
            url,
            json=request_body,
            auth=(credentials['GBIF_USERNAME'], credentials['GBIF_PASSWORD']),
            headers={'Content-Type': 'application/json'},
            timeout=60
        )
        response.raise_for_status()

        download_key = response.text.strip()
        print(f"Download request submitted: {download_key}")
        return download_key

    except requests.exceptions.HTTPError as e:
        print(f"ERROR: Failed to submit download request")
        print(f"Status: {e.response.status_code}")
        print(f"Response: {e.response.text}")
        # TODO: ideally raise an exception instead of sys.exit() in a utility function
        sys.exit(1)


def wait_for_download(download_key, credentials):
    """Poll until download is ready."""
    print(f"\nWaiting for download to complete...")
    url = f"https://api.gbif.org/v1/occurrence/download/{download_key}"

    for attempt in range(MAX_POLL_ATTEMPTS):
        try:
            response = requests.get(
                url,
                auth=(credentials['GBIF_USERNAME'], credentials['GBIF_PASSWORD']),
                timeout=30
            )
            response.raise_for_status()
            data = response.json()

            status = data.get('status')

            if status == 'SUCCEEDED':
                print(f"  [{attempt+1}] Status: {status} - Download ready!", flush=True)
                return data
            elif status in ['FAILED', 'KILLED', 'CANCELLED']:
                print(f"  [{attempt+1}] Status: {status} - ERROR!", flush=True)
                sys.exit(1)
            else:
                print(f"  [{attempt+1}] Status: {status} (waiting {POLL_INTERVAL_SECONDS}s...)", flush=True)
                time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as e:
            print(f"\n  Error checking status: {e}")
            time.sleep(POLL_INTERVAL_SECONDS)

    print("\nERROR: Timed out waiting for download")
    # TODO: ideally raise an exception instead of sys.exit() in a utility function
    sys.exit(1)


def download_and_extract(download_info):
    """Download and extract the ZIP file (DWCA format)."""
    download_link = download_info.get('downloadLink')
    if not download_link:
        print("ERROR: No download link in response")
        # TODO: ideally raise an exception instead of sys.exit() in a utility function
        sys.exit(1)

    print(f"\nDownloading from: {download_link}")

    # Create temp directory
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    extract_dir = TEMP_DIR / "extracted"
    occurrence_file = extract_dir / "occurrence.txt"
    if occurrence_file.exists():
        print(f"  Reusing existing extracted download: {extract_dir}")
        return extract_dir

    zip_path = TEMP_DIR / "gbif_download.zip"

    # Download with progress, reusing an already-complete local ZIP when available.
    should_download = True
    if zip_path.exists():
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                bad_member = zf.testzip()
            if bad_member is None:
                print(f"  Reusing existing validated download: {zip_path}")
                should_download = False
            else:
                print(f"  Existing ZIP failed validation at {bad_member}; downloading again")
        except zipfile.BadZipFile:
            print("  Existing ZIP is incomplete or invalid; downloading again")

    if should_download:
        try:
            response = requests.get(download_link, stream=True, timeout=600)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0

            with open(zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0 and downloaded % (1024 * 1024) < 8192:
                        pct = downloaded * 100 / total_size
                        print(f"  Downloaded: {downloaded/1024/1024:.0f} MB / {total_size/1024/1024:.0f} MB ({pct:.0f}%)", flush=True)

            print(f"\n  Download complete: {zip_path}")

        except Exception as e:
            print(f"\nERROR downloading: {e}")
            # TODO: ideally raise an exception instead of sys.exit() in a utility function
            sys.exit(1)

    # Extract
    print("  Extracting...")
    extract_dir = TEMP_DIR / "extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(extract_dir)

    # Delete the zip immediately to free disk space
    zip_path.unlink()
    print(f"  Deleted zip to free space")

    # DWCA format contains occurrence.txt and multimedia.txt
    occurrence_file = extract_dir / "occurrence.txt"
    multimedia_file = extract_dir / "multimedia.txt"

    if not occurrence_file.exists():
        print("ERROR: occurrence.txt not found in download")
        # TODO: ideally raise an exception instead of sys.exit() in a utility function
        sys.exit(1)

    print(f"  Occurrence file: {occurrence_file.name}")
    if multimedia_file.exists():
        print(f"  Multimedia file: {multimedia_file.name}")
    else:
        print("  No multimedia file found (some records may lack images)")

    return extract_dir


# ═══════════════════════════════════════════════════════════════════
# DATA PROCESSING
# ═══════════════════════════════════════════════════════════════════

def clean_scientific_name(name):
    """Remove author citations from scientific names."""
    if not name:
        return None

    name = str(name).strip()

    # Skip BOLD sequence IDs
    if name.startswith('BOLD:') or re.match(r'^[A-Z]{2,}\d+', name):
        return None

    # Remove author citations
    name = re.sub(r'\s*\([A-Z][a-zA-Z&\s\.\-]+,?\s*\d{4}\)', '', name)
    name = re.sub(r'\s+[A-Z][a-zA-Z&\s\.\-]+,\s*\d{4}$', '', name)
    name = re.sub(r'\s+[A-Z][a-zA-Z]+\s+\d{4}$', '', name)

    name = ' '.join(name.split())

    parts = name.split()
    if len(parts) < 2:
        return None

    if not (parts[0][0].isupper() and parts[1][0].islower()):
        return None

    return name


def load_multimedia_lookup(extract_dir):
    """
    Load multimedia.txt and create lookup: gbifID -> image_url.
    Returns dict mapping gbifID to first StillImage URL.
    """
    multimedia_path = extract_dir / "multimedia.txt"

    if not multimedia_path.exists():
        print("  No multimedia.txt found - images will not be available")
        return {}

    print("  Loading multimedia data...")
    lookup = {}
    count = 0

    with open(multimedia_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')

        for row in reader:
            count += 1
            gbif_id = row.get('gbifID')
            media_type = row.get('type', '')
            identifier = row.get('identifier', '')

            # Only keep StillImage, skip audio/video
            if gbif_id and 'StillImage' in media_type and identifier:
                # Keep first image per gbifID
                if gbif_id not in lookup:
                    lookup[gbif_id] = identifier

    print(f"  Processed {count:,} multimedia records")
    print(f"  Found images for {len(lookup):,} occurrences")
    return lookup


def _is_inaturalist_record(record):
    """Check whether a record originates from iNaturalist.

    Centralised helper used by get_observation_url() and get_source() so the
    detection logic is defined in exactly one place.
    """
    dataset_key = record.get('datasetKey', '') or ''
    institution = record.get('institutionCode', '') or ''
    occurrence_id = record.get('occurrenceID', '') or ''

    return (
        dataset_key == INATURALIST_DATASET_KEY or
        institution.lower() == 'inaturalist' or
        'inaturalist.org' in occurrence_id.lower()
    )


def get_observation_url(record):
    """Build the observation URL for a record."""
    gbif_id = record.get('gbifID', '')
    occurrence_id = record.get('occurrenceID', '') or ''
    references = record.get('references', '') or ''

    if _is_inaturalist_record(record):
        # Try to extract iNaturalist observation ID
        if occurrence_id.startswith('https://www.inaturalist.org/observations/'):
            return occurrence_id

        # Try to extract ID from URL
        match = re.search(r'inaturalist\.org/observations/(\d+)', occurrence_id)
        if match:
            return f"https://www.inaturalist.org/observations/{match.group(1)}"

        # Check if it's just a number
        if occurrence_id.isdigit():
            return f"https://www.inaturalist.org/observations/{occurrence_id}"

        # Try URN format: urn:catalog:iNaturalist:Observation:12345
        match = re.search(r':(\d+)$', occurrence_id)
        if match:
            return f"https://www.inaturalist.org/observations/{match.group(1)}"

    # Fallback to references if it's a URL
    if references and references.startswith('http'):
        return references

    # Default to GBIF occurrence page
    return f"https://www.gbif.org/occurrence/{gbif_id}"


def _is_unam_record(record):
    """Check whether a record originates from a UNAM institution."""
    institution = record.get('institutionCode', '') or ''
    return institution in UNAM_INSTITUTION_CODES


def get_source(record):
    """Determine the data source for a record.

    Returns one of: 'iNaturalist', 'GBIF (UNAM)', 'GBIF (Other Coverage)'
    """
    if _is_inaturalist_record(record):
        return 'iNaturalist'
    if _is_unam_record(record):
        return 'GBIF (UNAM)'
    return 'GBIF (Other Institutions)'


def get_collection_location(record):
    """
    Get collection location with priority:
    locality > verbatimLocality > municipality > county > stateProvince
    """
    for field in ['locality', 'verbatimLocality', 'municipality', 'county', 'stateProvince']:
        value = record.get(field)
        if value and str(value).strip() and str(value).strip().lower() not in ['na', 'nan', 'none', '']:
            return str(value).strip()
    return None


def process_occurrence_file(occurrence_path, multimedia_lookup=None):
    """Process the DWCA occurrence.txt file into our format."""
    print(f"\nProcessing {occurrence_path}...")

    if multimedia_lookup is None:
        multimedia_lookup = {}

    records = []
    skipped = 0
    source_counts = defaultdict(int)
    with_images = 0

    # DWCA uses tab-separated values
    with open(occurrence_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')

        for row in reader:
            # Skip records without coordinates
            lat = row.get('decimalLatitude')
            lng = row.get('decimalLongitude')

            if not lat or not lng:
                skipped += 1
                continue

            try:
                lat = float(lat)
                lng = float(lng)
            except (ValueError, TypeError):
                skipped += 1
                continue

            # Extract taxonomy
            genus = row.get('genus', '') or ''
            species_epithet = row.get('specificEpithet', '') or ''
            subspecies = row.get('infraspecificEpithet') or None

            # Build scientific name
            if genus and species_epithet:
                scientific_name = f"{genus} {species_epithet}"
            else:
                scientific_name = clean_scientific_name(row.get('species') or row.get('scientificName'))
                if scientific_name:
                    parts = scientific_name.split()
                    genus = parts[0] if parts else ''
                    species_epithet = parts[1] if len(parts) > 1 else ''

            if not scientific_name:
                skipped += 1
                continue

            # Clean subspecies
            if subspecies:
                subspecies = str(subspecies).strip()
                if subspecies.upper() in ['ACCEPTED', 'SYNONYM', 'DOUBTFUL', 'UNKNOWN', 'NA', 'NAN', '']:
                    subspecies = None
            subspecies_source = 'gbif_interpreted' if subspecies else None

            # The GBIF backbone lacks many Ithomiini subspecies, so those records
            # are interpreted at species level. Recover the subspecies the
            # publisher reported, anchored to the interpreted genus and species.
            if not subspecies and genus and species_epithet:
                for field in ('scientificName', 'verbatimScientificName'):
                    subspecies = parse_verbatim_subspecies(row.get(field), f"{genus} {species_epithet}")
                    if subspecies:
                        subspecies_source = 'verbatim_name'
                        break

            # Determine source and build URL
            source = get_source(row)
            observation_url = get_observation_url(row)
            source_counts[source] += 1

            # Get location
            collection_location = get_collection_location(row)

            # Get image URL from multimedia lookup
            gbif_id = str(row.get('gbifID', ''))
            image_url = multimedia_lookup.get(gbif_id)
            if image_url:
                with_images += 1

            record = {
                'id': gbif_id,
                'scientific_name': scientific_name,
                'genus': genus or 'Unknown',
                'species': species_epithet or 'sp.',
                'subspecies': subspecies,
                'subspecies_source': subspecies_source,
                'family': row.get('family', 'Nymphalidae'),
                'tribe': 'Ithomiini',
                'lat': lat,
                'lng': lng,
                'country': standardize_country(row.get('country') or row.get('countryCode')),
                'collection_location': collection_location,
                'state_province': row.get('stateProvince'),
                'collection_date': row.get('eventDate'),
                'source': source,
                'observation_url': observation_url,
                'basis_of_record': row.get('basisOfRecord'),
                'image_url': image_url,
                'mimicry_ring': 'Unknown',  # Will be filled by process_data.py
                'sex': row.get('sex'),  # Darwin Core sex field
                'dataset_name': row.get('datasetName'),
                'institution_code': row.get('institutionCode'),
                'coordinate_uncertainty': row.get('coordinateUncertaintyInMeters'),
            }

            records.append(record)

    print(f"  Processed: {len(records):,} records")
    recovered = sum(1 for record in records if record['subspecies_source'] == 'verbatim_name')
    print(f"  Subspecies recovered from original names: {recovered:,}")
    print(f"  Skipped: {skipped:,} (missing coordinates or invalid)")
    print(f"  With images: {with_images:,}")
    print(f"  Sources: iNaturalist={source_counts['iNaturalist']:,}, GBIF={source_counts['GBIF']:,}")

    return records, source_counts


def save_citation(download_info, source_counts, total_records):
    """Save citation information."""
    doi = download_info.get('doi')
    download_key = download_info.get('key')
    created = download_info.get('created')

    # Format date
    if created:
        try:
            dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
            date_str = dt.strftime('%Y-%m-%d')
        except Exception:
            date_str = datetime.now().strftime('%Y-%m-%d')
    else:
        date_str = datetime.now().strftime('%Y-%m-%d')

    citation = {
        'doi': doi,
        'doi_url': f"https://doi.org/{doi}" if doi else None,
        'download_key': download_key,
        'download_date': date_str,
        'total_records': total_records,
        'citation_text': f"GBIF Occurrence Download https://doi.org/{doi} accessed via GBIF.org on {date_str}",
        'dataset_breakdown': {
            'iNaturalist': source_counts.get('iNaturalist', 0),
            'Other GBIF': source_counts.get('GBIF', 0)
        },
        'filters_applied': 'Ithomiini genera, coordinates present, no geospatial issues, present occurrences, excludes fossils/living specimens'
    }

    with open(CITATION_FILE, 'w') as f:
        json.dump(citation, f, indent=2)

    print(f"\nCitation saved to {CITATION_FILE}")
    print(f"  DOI: {doi}")
    print(f"  Citation: {citation['citation_text']}")


def should_use_cache(taxon_keys):
    """Check if we should use cached data instead of new download.

    Reuses cache if:
    1. The output file and citation exist
    2. The download is less than CACHE_HOURS old
    3. The taxon keys (query) haven't changed
    """
    if not CITATION_FILE.exists() or not OUTPUT_FILE.exists():
        return False

    try:
        with open(CITATION_FILE, 'r') as f:
            citation = json.load(f)

        download_date = citation.get('download_date')
        if not download_date:
            return False

        dt = datetime.strptime(download_date, '%Y-%m-%d')
        age = datetime.now() - dt
        age_hours = age.total_seconds() / 3600

        if age_hours >= CACHE_HOURS:
            print(f"Cache is {age_hours:.1f}h old, exceeds {CACHE_HOURS}h threshold")
            return False

        # Check if the query (taxon keys) changed
        if TAXON_KEYS_FILE.exists():
            with open(TAXON_KEYS_FILE, 'r') as f:
                cached_keys_data = json.load(f)
            cached_keys = set(str(v) for v in cached_keys_data.get('genera', {}).values())
            current_keys = set(str(v) for v in taxon_keys.values())
            if cached_keys != current_keys:
                print(f"Taxon keys changed ({len(cached_keys)} -> {len(current_keys)}), downloading fresh data")
                return False

        print(f"Cache is {age_hours:.1f}h old (threshold: {CACHE_HOURS}h), query unchanged - reusing cached data")
        return True

    except Exception as e:
        print(f"Error checking cache: {e}")
        return False


def enrich_taxonomy_cache(occurrence_path):
    """
    Extract taxonomy data from DWCA occurrence.txt and merge into the
    taxonomy cache. The DWCA contains pre-resolved taxonomy from GBIF
    (taxonKey, acceptedTaxonKey, taxonomicStatus, etc.), so we can
    populate the cache without making API calls.

    Updates metadata with 'bulk_enriched_at' date for the GBIF download
    portion. Names resolved via API fallback retain their own date.
    """
    print("\n>> Enriching taxonomy cache from GBIF download...")

    # Load existing cache or start fresh
    cache = None
    if TAXONOMY_CACHE_FILE.exists():
        try:
            with open(TAXONOMY_CACHE_FILE) as f:
                cache = json.load(f)
            print(f"   Loaded existing cache: {len(cache.get('species', {}))} species, "
                  f"{len(cache.get('subspecies', {}))} subspecies, "
                  f"{len(cache.get('synonyms', {}))} synonyms")
        except Exception as e:
            print(f"   Warning: Could not load existing cache: {e}")

    if cache is None:
        cache = {
            "metadata": {},
            "species": {},
            "subspecies": {},
            "synonyms": {},
            "species_by_key": {},
            "children": {},
        }

    species = cache.setdefault("species", {})
    subspecies = cache.setdefault("subspecies", {})
    synonyms = cache.setdefault("synonyms", {})
    species_by_key = cache.setdefault("species_by_key", {})
    children = cache.setdefault("children", {})

    added_species = 0
    added_subspecies = 0
    added_synonyms = 0
    seen = set()

    with open(occurrence_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')

        for row in reader:
            # DWCA taxonomy fields
            taxon_key = row.get('taxonKey') or row.get('speciesKey')
            accepted_key = row.get('acceptedTaxonKey')
            accepted_name = row.get('acceptedScientificName', '')
            taxonomic_status = row.get('taxonomicStatus', '')
            taxon_rank = row.get('taxonRank', '')
            genus = row.get('genus', '') or ''
            species_epithet = row.get('specificEpithet', '') or ''
            infraspecific = row.get('infraspecificEpithet', '') or ''
            scientific_name_raw = row.get('scientificName', '')
            species_name = row.get('species', '')

            if not genus or not species_epithet:
                continue

            canonical = f"{genus} {species_epithet}"
            canonical_lower = canonical.lower()

            # Build trinomial if subspecies present
            trinomial = None
            trinomial_lower = None
            if infraspecific and infraspecific.strip():
                infraspecific = infraspecific.strip()
                trinomial = f"{genus} {species_epithet} {infraspecific}"
                trinomial_lower = trinomial.lower()

            # Clean accepted name (remove author citation)
            if accepted_name:
                accepted_name = re.sub(r'\s*\([A-Z][a-zA-Z&\s.\-]+,?\s*\d{4}\)', '', accepted_name)
                accepted_name = re.sub(r'\s+[A-Z][a-zA-Z&\s.\-]+,\s*\d{4}$', '', accepted_name)
                accepted_name = ' '.join(accepted_name.split())

            is_synonym = taxonomic_status in ('SYNONYM', 'HETEROTYPIC_SYNONYM',
                                               'HOMOTYPIC_SYNONYM', 'PROPARTE_SYNONYM')

            # ── Species-level entry ──
            if canonical_lower not in seen:
                seen.add(canonical_lower)

                entry = {
                    "key": int(taxon_key) if taxon_key and taxon_key.isdigit() else None,
                    "canonicalName": canonical,
                    "scientificName": scientific_name_raw,
                    "status": taxonomic_status or "ACCEPTED",
                    "acceptedKey": int(accepted_key) if accepted_key and accepted_key.isdigit() else None,
                    "acceptedName": accepted_name or "",
                    "rank": "SPECIES",
                    "genus": genus,
                }

                if is_synonym:
                    if canonical_lower not in synonyms:
                        synonyms[canonical_lower] = entry
                        added_synonyms += 1
                elif canonical_lower not in species:
                    species[canonical_lower] = entry
                    if entry["key"]:
                        species_by_key[str(entry["key"])] = entry
                    added_species += 1

            # ── Subspecies-level entry ──
            if trinomial_lower and trinomial_lower not in seen:
                seen.add(trinomial_lower)

                ssp_entry = {
                    "key": int(taxon_key) if taxon_key and taxon_key.isdigit() else None,
                    "canonicalName": trinomial,
                    "scientificName": scientific_name_raw,
                    "status": taxonomic_status or "ACCEPTED",
                    "acceptedKey": int(accepted_key) if accepted_key and accepted_key.isdigit() else None,
                    "acceptedName": accepted_name or "",
                    "rank": "SUBSPECIES",
                    "genus": genus,
                }

                if is_synonym:
                    if trinomial_lower not in synonyms:
                        synonyms[trinomial_lower] = ssp_entry
                        added_synonyms += 1
                elif trinomial_lower not in subspecies:
                    subspecies[trinomial_lower] = ssp_entry
                    added_subspecies += 1
                    # Track parent-child relationship
                    parent = species.get(canonical_lower)
                    if parent and parent.get("key"):
                        pkey = str(parent["key"])
                        existing_children = children.get(pkey, [])
                        if trinomial not in existing_children:
                            children.setdefault(pkey, []).append(trinomial)

    # Update metadata
    now_utc = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    meta = cache.setdefault("metadata", {})
    meta["bulk_enriched_at"] = now_utc
    meta["total_species"] = len(species)
    meta["total_subspecies"] = len(subspecies)
    meta["total_synonyms"] = len(synonyms)

    # Save
    with open(TAXONOMY_CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2, default=str)

    print(f"   Added from GBIF download: {added_species} species, "
          f"{added_subspecies} subspecies, {added_synonyms} synonyms")
    print(f"   Cache totals: {len(species)} species, "
          f"{len(subspecies)} subspecies, {len(synonyms)} synonyms")
    print(f"   Bulk enriched at: {now_utc}")
    print(f"   Saved to {TAXONOMY_CACHE_FILE}")


def cleanup_temp():
    """Clean up temporary files."""
    import shutil
    if TEMP_DIR.exists():
        try:
            shutil.rmtree(TEMP_DIR)
            print("Cleaned up temporary files")
        except PermissionError:
            print(f"Note: Could not delete temp directory (files may be locked): {TEMP_DIR}")
            print("You can manually delete this folder later.")


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Download Ithomiini occurrences from GBIF')
    parser.add_argument('--force', action='store_true', help='Force new download, ignore cache')
    parser.add_argument('--keys-only', action='store_true', help='Only get taxon keys, do not download')
    parser.add_argument('--download-key', help='Reprocess an existing, completed GBIF download (no credentials needed)')
    args = parser.parse_args()

    print("=" * 70)
    print("GBIF ITHOMIINI DOWNLOAD (Download API)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # Get taxon keys
    taxon_keys = get_all_taxon_keys(use_cache=True)

    if not taxon_keys:
        print("ERROR: No taxon keys found")
        sys.exit(1)

    if args.keys_only:
        print("\n--keys-only specified, exiting")
        return

    if args.download_key:
        # Published downloads are public: reprocess one reproducibly.
        response = requests.get(f"https://api.gbif.org/v1/occurrence/download/{args.download_key}", timeout=60)
        response.raise_for_status()
        download_info = response.json()
        if download_info.get('status') != 'SUCCEEDED':
            print(f"ERROR: download {args.download_key} is {download_info.get('status')}")
            sys.exit(1)
    else:
        # Load credentials only for actual occurrence downloads.
        credentials = load_credentials()
        print(f"Credentials loaded for: {credentials['GBIF_USERNAME']}")

        # Check cache (needs taxon_keys to verify query hasn't changed)
        if not args.force:
            if should_use_cache(taxon_keys):
                print("\nUsing cached data. Use --force to download fresh data.")
                return

        # Check for a recent completed download on GBIF account (e.g. from a timed-out run)
        download_info = find_recent_download(credentials, taxon_keys)

        if not download_info:
            # Submit new download request
            download_key = submit_download_request(credentials, taxon_keys)

            # Wait for completion
            download_info = wait_for_download(download_key, credentials)

    # Download and extract
    extract_dir = download_and_extract(download_info)

    # Load multimedia lookup for image URLs
    multimedia_lookup = load_multimedia_lookup(extract_dir)

    # Process occurrence data
    occurrence_file = extract_dir / "occurrence.txt"
    records, source_counts = process_occurrence_file(occurrence_file, multimedia_lookup)

    if not records:
        print("ERROR: No records processed")
        sys.exit(1)

    # Enrich taxonomy cache from DWCA data
    enrich_taxonomy_cache(occurrence_file)

    # Clean up extracted files now to free disk space
    cleanup_temp()

    # Save occurrences
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)

    file_size = OUTPUT_FILE.stat().st_size / (1024 * 1024)
    print(f"\nSaved {len(records):,} records to {OUTPUT_FILE}")
    print(f"File size: {file_size:.2f} MB")

    # Save citation
    save_citation(download_info, source_counts, len(records))

    # Statistics
    print("\n" + "=" * 70)
    print("DOWNLOAD STATISTICS")
    print("=" * 70)

    # By source
    print(f"\nBy Source:")
    print(f"  iNaturalist: {source_counts['iNaturalist']:,}")
    print(f"  Other GBIF: {source_counts['GBIF']:,}")

    # By basis of record
    basis_counts = {}
    for r in records:
        basis = r.get('basis_of_record', 'Unknown')
        basis_counts[basis] = basis_counts.get(basis, 0) + 1

    print(f"\nBy Basis of Record:")
    for k, v in sorted(basis_counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v:,}")

    # Unique species
    species_set = set(r['scientific_name'] for r in records if r['scientific_name'])
    print(f"\nUnique species: {len(species_set):,}")

    # With subspecies
    with_subsp = sum(1 for r in records if r.get('subspecies'))
    print(f"Records with subspecies: {with_subsp:,}")

    # Location coverage
    with_location = sum(1 for r in records if r.get('collection_location'))
    print(f"Records with location: {with_location:,} ({with_location/len(records)*100:.1f}%)")

    # Image coverage
    with_images = sum(1 for r in records if r.get('image_url'))
    print(f"Records with images: {with_images:,} ({with_images/len(records)*100:.1f}%)")

    # Cleanup
    cleanup_temp()

    print("\n" + "=" * 70)
    print("DOWNLOAD COMPLETE")
    print("=" * 70)
    print("\nNext steps:")
    print("1. Run `python scripts/process_data.py` to merge with other sources")
    print("2. iNaturalist records will be filterable as separate source")
    print("3. DOI citation available in gbif_citation.json")


if __name__ == "__main__":
    main()
