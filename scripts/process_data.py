"""
Ithomiini Maps - Data Processing Pipeline
==========================================
Merges data from multiple sources into a unified JSON format.

Sources:
  1. Local Excel (Dore et al.) - Published occurrence data (source of mimicry ring data)
  2. Google Sheets (Sanger) - Live collection/sequencing data
  3. GBIF API - External occurrence enrichment

Key Feature:
  - Mimicry ring lookup table built from Dore database
  - Applied to Sanger and GBIF records based on species/subspecies matching

Output:
  - public/data/map_points.json (for map rendering)
"""

import pandas as pd
import requests
import re
import os
import json
import sys
from pathlib import Path
from spatial_qc import GBIF_SOURCES, SANGER_SOURCE, compute_gbif_quality_flags, compute_spatial_qc

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

LOCAL_EXCEL_PATH = "Dore_Ithomiini_records.xlsx"
GOOGLE_SHEET_ID = "1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4"
SHEET_GIDS = {
    "Collection_data": "900206579",
    "Photo_links": "439406691",
    "Taxonomy_v18Jun25": "1251116294"
}
OUTPUT_DIR = "public/data"

# GBIF Configuration
USE_GBIF_BULK_DOWNLOAD = True
GBIF_BULK_FILE = "public/data/gbif_occurrences.json"

# ══════════════════════════════════════════════════════════════════════════════
# MIMICRY RING LOOKUP TABLE
# ══════════════════════════════════════════════════════════════════════════════

# Global lookup table: (scientific_name, subspecies) -> (male_mimicry, female_mimicry)
MIMICRY_LOOKUP = {}
MIMICRY_PROVENANCE = {}


def build_mimicry_lookup(dore_df):
    """
    Build a lookup table from Dore database for mimicry rings.
    Creates mappings at two levels of specificity:
    1. Full match: (scientific_name, subspecies) -> mimicry
    2. Species-only fallback only when all known subspecies share a ring
    """
    global MIMICRY_LOOKUP, MIMICRY_PROVENANCE
    
    print(">> Building Mimicry Ring Lookup Table...")

    MIMICRY_LOOKUP = {}
    MIMICRY_PROVENANCE = {}
    species_subspecies_rings = {}
    species_display_names = {}
    
    for _, row in dore_df.iterrows():
        sci_name = f"{row['Genus']} {row['Species']}".strip()
        sci_name_lower = sci_name.lower()
        species_display_names.setdefault(sci_name_lower, sci_name)
        subspecies = row.get('Sub.species')
        male_mim = row.get('M.mimicry')
        female_mim = row.get('F.mimicry')
        
        # Clean subspecies
        if pd.isna(subspecies) or str(subspecies).strip() in ['nan', '', 'None']:
            subspecies = None
        else:
            subspecies = str(subspecies).strip()
        
        # Normalize mimicry values
        male_mim = normalize_mimicry(male_mim)
        female_mim = normalize_mimicry(female_mim)
        
        # Store with full key (species + subspecies)
        if subspecies:
            key = (sci_name_lower, subspecies.lower())
            if key not in MIMICRY_LOOKUP:
                MIMICRY_LOOKUP[key] = (male_mim, female_mim)
                MIMICRY_PROVENANCE[key] = {
                    'assignment_level': 'exact_subspecies',
                    'confidence': 'exact',
                    'source_taxon': f"{sci_name} {subspecies}",
                }
            species_subspecies_rings.setdefault(sci_name_lower, []).append(
                (subspecies, male_mim, female_mim)
            )

    for sci_name_lower, entries in species_subspecies_rings.items():
        male_mim = get_unanimous_subspecies_ring(entries, ring_index=1)
        female_mim = get_unanimous_subspecies_ring(entries, ring_index=2)
        if male_mim != 'Unknown' or female_mim != 'Unknown':
            key = (sci_name_lower, None)
            MIMICRY_LOOKUP[key] = (male_mim, female_mim)
            MIMICRY_PROVENANCE[key] = {
                'assignment_level': 'species_unambiguous_subspecies',
                'confidence': 'propagated_unambiguous',
                'source_taxon': species_display_names.get(sci_name_lower, sci_name_lower),
            }
    
    print(f"   Built lookup with {len(MIMICRY_LOOKUP)} unique entries")
    
    # Statistics
    unique_species = len(set(k[0] for k in MIMICRY_LOOKUP.keys()))
    unique_mimicry = len(set(v[0] for v in MIMICRY_LOOKUP.values() if v[0] != 'Unknown'))
    print(f"   Covers {unique_species} species, {unique_mimicry} mimicry rings")


def get_unanimous_subspecies_ring(entries, ring_index):
    """Return a shared non-Unknown ring only if every known subspecies agrees."""
    if not entries:
        return 'Unknown'

    rings = {entry[ring_index] for entry in entries}
    if len(rings) == 1:
        ring = next(iter(rings))
        if ring != 'Unknown':
            return ring
    return 'Unknown'


def lookup_mimicry(scientific_name, subspecies=None):
    """
    Look up mimicry ring for a given species/subspecies.
    Returns (male_mimicry, female_mimicry) tuple.
    
    Matching priority:
    1. Exact match (species + subspecies)
    2. Species-only fallback
    3. Return ('Unknown', 'Unknown') if no match
    """
    if not scientific_name:
        return ('Unknown', 'Unknown')
    
    sci_name_lower = scientific_name.lower().strip()
    
    # Try exact match first (species + subspecies)
    if subspecies:
        ssp_lower = str(subspecies).lower().strip()
        key = (sci_name_lower, ssp_lower)
        if key in MIMICRY_LOOKUP:
            return MIMICRY_LOOKUP[key]
    
    # Fallback to species-only match
    species_key = (sci_name_lower, None)
    if species_key in MIMICRY_LOOKUP:
        return MIMICRY_LOOKUP[species_key]
    
    return ('Unknown', 'Unknown')


def lookup_mimicry_assignment(scientific_name, subspecies=None, sex=None):
    """Look up the ring plus provenance for a species/subspecies/sex assignment."""
    if not scientific_name:
        return {
            'mimicry_ring': 'Unknown',
            'assignment_level': 'unassigned',
            'confidence': 'unknown',
            'source_taxon': None,
        }

    sci_name_lower = scientific_name.lower().strip()
    sex_normalized = normalize_sex(sex)
    ring_index = 1 if sex_normalized == 'female' else 0

    if subspecies:
        ssp_lower = str(subspecies).lower().strip()
        key = (sci_name_lower, ssp_lower)
        if key in MIMICRY_LOOKUP:
            ring = MIMICRY_LOOKUP[key][ring_index]
            provenance = MIMICRY_PROVENANCE.get(key, {})
            return {
                'mimicry_ring': ring,
                'assignment_level': provenance.get('assignment_level', 'exact_subspecies'),
                'confidence': provenance.get('confidence', 'exact'),
                'source_taxon': provenance.get('source_taxon'),
            }

    species_key = (sci_name_lower, None)
    if species_key in MIMICRY_LOOKUP:
        ring = MIMICRY_LOOKUP[species_key][ring_index]
        if ring != 'Unknown':
            provenance = MIMICRY_PROVENANCE.get(species_key, {})
            return {
                'mimicry_ring': ring,
                'assignment_level': provenance.get(
                    'assignment_level',
                    'species_unambiguous_subspecies',
                ),
                'confidence': provenance.get('confidence', 'propagated_unambiguous'),
                'source_taxon': provenance.get('source_taxon'),
            }

    return {
        'mimicry_ring': 'Unknown',
        'assignment_level': 'unassigned',
        'confidence': 'unknown',
        'source_taxon': None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def clean_str(x):
    """Clean a string value: strip whitespace, return None for NaN/empty/NA values."""
    if pd.notna(x) and str(x).strip() not in ['nan', '', 'NA']:
        return str(x).strip()
    return None


def clean_id(series):
    """Normalizes IDs: removes spaces, uppercase, handles NaNs."""
    s = series.astype(str).str.upper().str.strip()
    s = s.replace({'NAN': '', 'NONE': '', 'NA': ''})
    return s


def normalize_mimicry(value):
    """Convert mimicry ring to Title Case for consistency."""
    if pd.isna(value) or value in ['', 'nan', 'NAN', 'Unknown', 'UNKNOWN']:
        return 'Unknown'
    return str(value).strip().title()


def normalize_sex(value):
    """
    Normalize sex values to standard format: 'male', 'female', or None.
    Handles variations like 'male ?', 'female_?', 'Male', 'FEMALE', etc.
    """
    if pd.isna(value) or value in ['', 'nan', 'NAN', 'NA', 'NOT_COLLECTED', 'Unknown', 'UNKNOWN']:
        return None

    value_lower = str(value).lower().strip()

    # Check for female (check first to avoid 'female' matching 'male')
    if 'female' in value_lower or value_lower == 'f':
        return 'female'
    # Check for male
    elif 'male' in value_lower or value_lower == 'm':
        return 'male'
    # Hermaphrodite (rare but included in Darwin Core)
    elif 'hermaphrodite' in value_lower:
        return 'hermaphrodite'
    else:
        return None


def get_google_export_url(gid):
    """Generate CSV export URL for a Google Sheet tab."""
    return f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/export?format=csv&gid={gid}"


def determine_sequencing_status(row):
    """
    Determine sequencing status based on Sanger tube/rack data and ToLID.
    Returns: 'Sequenced', 'Tissue at Sanger', 'Tissue Available', or 'Preserved Specimen'

    - Sequenced: has an actual ToLID (Tree of Life ID), meaning sequencing was completed.
    - Tissue at Sanger: tube is in a rack at Sanger (submitted to TOL pipeline) but not yet sequenced.
    - Tissue Available: tissue has been collected but not yet sent to Sanger.
    - Preserved Specimen: no tissue collected yet.
    """
    tolid = str(row.get('ToLID', ''))
    has_tolid = tolid not in ('', 'nan', 'Not in STS') and len(tolid) > 0 and 'NOT_FOUND' not in tolid

    rack_1 = str(row.get('Tube_1_rack', ''))
    has_rack = 'Not in TOL' not in rack_1 and len(rack_1) > 5

    if has_tolid:
        return "Sequenced"

    if has_rack:
        return "Tissue at Sanger"

    tissue_1 = str(row.get('Tube_1_tissue', ''))
    if 'NOT_COLLECTED' not in tissue_1 and tissue_1 not in ['nan', '']:
        return "Tissue Available"

    return "Preserved Specimen"


def get_mimicry_for_row(row):
    """Look up the relevant mimicry ring for a DataFrame row using Dore data."""
    sci_name = row.get('scientific_name', '')
    subspecies = row.get('subspecies')
    sex = row.get('sex')
    return lookup_mimicry_assignment(sci_name, subspecies, sex)['mimicry_ring']


def get_mimicry_assignment_for_row(row):
    """Look up mimicry ring and assignment provenance for a DataFrame row."""
    sci_name = row.get('scientific_name', '')
    subspecies = row.get('subspecies')
    sex = row.get('sex')
    return lookup_mimicry_assignment(sci_name, subspecies, sex)


# ══════════════════════════════════════════════════════════════════════════════
# DATA LOADERS
# ══════════════════════════════════════════════════════════════════════════════

def load_local_data():
    """Load and process the Dore et al. Excel dataset."""
    print(">> Loading Local Excel Data (Dore et al.)...")
    
    try:
        df = pd.read_excel(LOCAL_EXCEL_PATH)
        print(f"   Loaded {len(df)} records from Excel")
        
        # Build scientific name from Genus + Species
        df['scientific_name'] = df['Genus'].astype(str) + ' ' + df['Species'].astype(str)
        
        # Extract taxonomy components
        df['genus'] = df['Genus'].astype(str).str.strip()
        df['species'] = df['Species'].astype(str).str.strip()  # Just the epithet
        df['subspecies'] = df['Sub.species'].apply(clean_str)
        
        # All Ithomiini are in Nymphalidae family
        df['family'] = 'Nymphalidae'
        df['tribe'] = 'Ithomiini'
        
        # Coordinates
        df['lat'] = pd.to_numeric(df['Latitude'], errors='coerce')
        df['lng'] = pd.to_numeric(df['Longitude'], errors='coerce')
        
        # Mimicry ring (use male mimicry, normalize to Title Case)
        # Dore is the SOURCE of mimicry data
        df['mimicry_ring'] = df['M.mimicry'].apply(normalize_mimicry)
        df['mimicry_ring_female'] = df['F.mimicry'].apply(normalize_mimicry)
        df['mimicry_assignment_level'] = 'dore_record'
        df['mimicry_assignment_confidence'] = 'source'
        df['mimicry_source_taxon'] = (
            df['scientific_name']
            + df['subspecies'].apply(lambda ssp: f" {ssp}" if ssp else "")
        )
        
        # Metadata
        df['source'] = "Dore et al. (2022)"
        df['sequencing_status'] = "Published"
        df['image_url'] = None
        df['country'] = df['Country']
        
        # Generate ID
        df['id'] = 'DORE_' + df['ID_obs'].astype(str)

        # Collection location and observation date
        # Dore database may have location and date columns
        if 'Locality' in df.columns:
            df['collection_location'] = df['Locality'].apply(clean_str)
        else:
            df['collection_location'] = None

        # Try various date column names
        date_col = None
        for col_name in ['Date', 'Collection_date', 'Year', 'Event_date']:
            if col_name in df.columns:
                date_col = col_name
                break

        if date_col:
            df['observation_date'] = df[date_col].apply(clean_str)
        else:
            df['observation_date'] = None

        # Sex field - check if Dore has individual sex data
        if 'Sex' in df.columns:
            df['sex'] = df['Sex'].apply(normalize_sex)
        else:
            # Dore database has M.mimicry/F.mimicry (species-level), not individual sex
            df['sex'] = None

        # Published dataset — no coordinate uncertainty metadata
        df['coordinate_uncertainty'] = None

        # Select final columns
        result = df[[
            'id', 'scientific_name', 'genus', 'species', 'subspecies',
            'family', 'tribe', 'lat', 'lng', 'mimicry_ring',
            'mimicry_assignment_level', 'mimicry_assignment_confidence',
            'mimicry_source_taxon',
            'sequencing_status', 'source', 'image_url', 'country',
            'collection_location', 'observation_date', 'sex',
            'coordinate_uncertainty'
        ]].copy()
        
        # Drop rows without coordinates
        result = result.dropna(subset=['lat', 'lng'])
        print(f"   Output: {len(result)} records with coordinates")
        
        # Build mimicry lookup from this data BEFORE returning
        build_mimicry_lookup(df)
        
        return result
        
    except FileNotFoundError:
        print(f"   WARNING: File not found: {LOCAL_EXCEL_PATH}")
        return pd.DataFrame()
    except Exception as e:
        print(f"   ERROR loading local excel: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def load_sanger_data():
    """Load and process the Sanger Institute Google Sheets data."""
    print(">> Loading Sanger (Google Sheets) Data...")
    
    try:
        # Download sheets
        df_col = pd.read_csv(get_google_export_url(SHEET_GIDS["Collection_data"]), dtype=str)
        df_photo = pd.read_csv(get_google_export_url(SHEET_GIDS["Photo_links"]), dtype=str)
        print(f"   Downloaded {len(df_col)} collection records, {len(df_photo)} photo links")
        
        # ── ID Selection (prioritize CAM_ID, fallback to CAM_ID_insectary) ──
        if 'CAM_ID' in df_col.columns:
            target_id = df_col['CAM_ID'].copy()
            if 'CAM_ID_insectary' in df_col.columns:
                target_id = target_id.fillna(df_col['CAM_ID_insectary'])
        else:
            target_id = df_col.iloc[:, 0]
            
        df_col['clean_id'] = clean_id(target_id)
        
        # ── Photo Matching ──
        # Filter out RAW files
        mask_raw = df_photo['Name'].str.contains(r'\.(?:ORF|CR2|NEF|ARW)$', case=False, regex=True, na=False)
        df_photo = df_photo[~mask_raw].copy()
        
        # Extract CAM_ID from filename
        extracted_ids = df_photo['Name'].str.extract(r'(CAM\d+)', flags=re.IGNORECASE)[0]
        df_photo['clean_id'] = clean_id(extracted_ids)
        
        # Create proxy URLs via wsrv.nl
        df_photo['google_id'] = df_photo['URL'].str.extract(r'file/d/(.*?)/view', expand=False)
        df_photo['proxy_url'] = "https://wsrv.nl/?url=https://drive.google.com/uc?id=" + df_photo['google_id'] + "&w=400&output=webp"
        
        # Group photos by CAM_ID (take first photo)
        photo_map = df_photo.groupby('clean_id')['proxy_url'].first()
        
        # ── Process Collection Data ──
        df_col['sequencing_status'] = df_col.apply(determine_sequencing_status, axis=1)
        df_col['image_url'] = df_col['clean_id'].map(photo_map)
        
        # Taxonomy fields (from Google Sheets columns)
        df_col['family'] = df_col.get(' Family', df_col.get('Family', pd.Series(['Nymphalidae'] * len(df_col))))
        df_col['family'] = df_col['family'].fillna('Nymphalidae').replace({'': 'Nymphalidae'})
        
        df_col['tribe'] = df_col.get('Tribe', pd.Series(['Ithomiini'] * len(df_col)))
        df_col['tribe'] = df_col['tribe'].fillna('Ithomiini').replace({'': 'Ithomiini'})
        
        df_col['genus'] = df_col.get('Genus', pd.Series(['Unknown'] * len(df_col)))
        df_col['genus'] = df_col['genus'].fillna('Unknown')
        
        # Scientific name (full binomial from SPECIES column)
        df_col['scientific_name'] = df_col.get('SPECIES', pd.Series(['Unknown species'] * len(df_col)))
        df_col['scientific_name'] = df_col['scientific_name'].fillna('Unknown species')
        
        # Extract species epithet from scientific name
        df_col['species'] = df_col['scientific_name'].apply(
            lambda x: str(x).split()[1] if pd.notna(x) and len(str(x).split()) > 1 else 'sp.'
        )
        
        # Subspecies
        df_col['subspecies'] = df_col.get('Subspecies_Form', pd.Series([None] * len(df_col)))
        df_col['subspecies'] = df_col['subspecies'].apply(clean_str)

        # Sex from Sanger data (normalize before mimicry lookup)
        if 'Sex' in df_col.columns:
            df_col['sex'] = df_col['Sex'].apply(normalize_sex)
            sex_counts = df_col['sex'].value_counts(dropna=False)
            print(f"   Sex distribution: {sex_counts.to_dict()}")
        else:
            df_col['sex'] = None
            print("   No Sex column found in Sanger data")
        
        # Coordinates (try multiple column names)
        if 'DECIMAL_LATITUDE' in df_col.columns:
            df_col['lat'] = pd.to_numeric(df_col['DECIMAL_LATITUDE'], errors='coerce')
            df_col['lng'] = pd.to_numeric(df_col['DECIMAL_LONGITUDE'], errors='coerce')
        elif 'Latitude' in df_col.columns:
            df_col['lat'] = pd.to_numeric(df_col['Latitude'], errors='coerce')
            df_col['lng'] = pd.to_numeric(df_col['Longitude'], errors='coerce')
        else:
            df_col['lat'] = None
            df_col['lng'] = None
        
        # ═══════════════════════════════════════════════════════════════════
        # MIMICRY RING LOOKUP (from Dore database)
        # ═══════════════════════════════════════════════════════════════════
        print("   Applying mimicry ring lookup from Dore database...")

        mimicry_assignments = df_col.apply(
            lambda row: pd.Series(get_mimicry_assignment_for_row(row)),
            axis=1,
        )
        df_col['mimicry_ring'] = mimicry_assignments['mimicry_ring']
        df_col['mimicry_assignment_level'] = mimicry_assignments['assignment_level']
        df_col['mimicry_assignment_confidence'] = mimicry_assignments['confidence']
        df_col['mimicry_source_taxon'] = mimicry_assignments['source_taxon']
        
        matched = (df_col['mimicry_ring'] != 'Unknown').sum()
        print(f"   Mimicry ring matched for {matched}/{len(df_col)} records")
        
        # Metadata
        df_col['source'] = 'Sanger Institute'
        df_col['country'] = df_col.get('Country', pd.Series([None] * len(df_col)))
        df_col['id'] = df_col['clean_id']

        # Collection location from Sanger data
        if 'Collection_location' in df_col.columns:
            df_col['collection_location'] = df_col['Collection_location'].apply(clean_str)
        elif 'Locality' in df_col.columns:
            df_col['collection_location'] = df_col['Locality'].apply(clean_str)
        else:
            df_col['collection_location'] = None

        # Observation date from Sanger data
        if 'Collection_date' in df_col.columns:
            df_col['observation_date'] = df_col['Collection_date'].apply(clean_str)
        elif 'Date' in df_col.columns:
            df_col['observation_date'] = df_col['Date'].apply(clean_str)
        else:
            df_col['observation_date'] = None

        # Sanger Google Sheets data has no coordinate uncertainty
        df_col['coordinate_uncertainty'] = None

        # Select final columns
        result = df_col[[
            'id', 'scientific_name', 'genus', 'species', 'subspecies',
            'family', 'tribe', 'lat', 'lng', 'mimicry_ring',
            'mimicry_assignment_level', 'mimicry_assignment_confidence',
            'mimicry_source_taxon',
            'sequencing_status', 'source', 'image_url', 'country',
            'collection_location', 'observation_date', 'sex',
            'coordinate_uncertainty'
        ]].copy()
        
        # Drop rows without coordinates or with empty IDs
        result = result.dropna(subset=['lat', 'lng'])
        result = result[result['id'] != '']
        
        print(f"   Output: {len(result)} records with coordinates")
        return result
        
    except Exception as e:
        print(f"   ERROR loading Sanger data: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def load_gbif_bulk_download():
    """
    Load pre-downloaded GBIF data from gbif_download.py.
    Applies mimicry ring lookup from Dore database.
    Maps basisOfRecord to user-friendly sequencing_status.
    """
    gbif_path = Path(GBIF_BULK_FILE)
    
    if not gbif_path.exists():
        print(f">> GBIF bulk download not found: {gbif_path}")
        print("   Run `python scripts/gbif_download.py` first to download GBIF data.")
        return pd.DataFrame()
    
    print(f">> Loading GBIF bulk download: {gbif_path}")
    
    try:
        with open(gbif_path, encoding='utf-8') as f:
            records = json.load(f)
        
        df = pd.DataFrame(records)
        print(f"   Loaded {len(df):,} GBIF records")
        
        # ═══════════════════════════════════════════════════════════════════
        # MAP BASIS OF RECORD TO STATUS
        # ═══════════════════════════════════════════════════════════════════
        # GBIF basisOfRecord values:
        # - HUMAN_OBSERVATION: iNaturalist/citizen science (like "Research Grade")
        # - PRESERVED_SPECIMEN: Museum specimens
        # - MACHINE_OBSERVATION: Camera trap, etc.
        # - OCCURRENCE: Generic occurrence
        
        status_map = {
            'HUMAN_OBSERVATION': 'Observation',
            'PRESERVED_SPECIMEN': 'Museum Specimen',
            'MACHINE_OBSERVATION': 'Observation',
            'OCCURRENCE': 'GBIF Record',
            'MATERIAL_SAMPLE': 'Museum Specimen',
            'LIVING_SPECIMEN': 'Living Specimen',
        }
        
        if 'basis_of_record' in df.columns:
            df['sequencing_status'] = df['basis_of_record'].map(status_map).fillna('GBIF Record')
        else:
            df['sequencing_status'] = 'GBIF Record'
        
        # ═══════════════════════════════════════════════════════════════════
        # CLEAN SPECIES NAMES (remove any remaining author citations)
        # ═══════════════════════════════════════════════════════════════════
        def clean_species_name(name):
            if not name or pd.isna(name):
                return None
            name = str(name).strip()
            # Remove author citations
            name = re.sub(r'\s*\([A-Z][a-zA-Z&\s\.\-]+,?\s*\d{4}\)', '', name)
            name = re.sub(r'\s+[A-Z][a-zA-Z&\s\.\-]+,\s*\d{4}$', '', name)
            name = ' '.join(name.split())
            return name if name else None
        
        df['scientific_name'] = df['scientific_name'].apply(clean_species_name)
        
        # Remove rows with invalid species names
        df = df[df['scientific_name'].notna()]
        print(f"   After cleaning species names: {len(df):,} records")
        
        # ═══════════════════════════════════════════════════════════════════
        # CLEAN SUBSPECIES (remove taxonomic status values)
        # ═══════════════════════════════════════════════════════════════════
        def clean_subspecies(ssp):
            if not ssp or pd.isna(ssp):
                return None
            ssp = str(ssp).strip()
            # Remove if it's a taxonomic status
            if ssp.upper() in ['ACCEPTED', 'SYNONYM', 'DOUBTFUL', 'UNKNOWN', 'NA', 'NONE', '']:
                return None
            return ssp
        
        df['subspecies'] = df['subspecies'].apply(clean_subspecies)
        
        # Ensure required columns exist
        required_cols = ['id', 'scientific_name', 'genus', 'species', 'subspecies',
                        'family', 'tribe', 'lat', 'lng', 'mimicry_ring',
                        'mimicry_assignment_level', 'mimicry_assignment_confidence',
                        'mimicry_source_taxon',
                        'sequencing_status', 'source', 'image_url', 'country',
                        'collection_location', 'observation_date', 'observation_url', 'sex',
                        'institution_code', 'coordinate_uncertainty', 'subspecies_source']

        nullable_cols = {'subspecies', 'image_url', 'collection_location',
                         'observation_date', 'observation_url', 'sex', 'institution_code',
                         'coordinate_uncertainty', 'mimicry_source_taxon', 'subspecies_source'}
        for col in required_cols:
            if col not in df.columns:
                df[col] = None if col in nullable_cols else 'Unknown'

        # Preserve source field from download (iNaturalist or GBIF)
        # If source is not set, default to GBIF
        if 'source' in df.columns:
            df['source'] = df['source'].apply(lambda x: clean_str(x) or 'GBIF')
        else:
            df['source'] = 'GBIF'

        # Convert coordinate uncertainty to numeric (meters)
        if 'coordinate_uncertainty' in df.columns:
            df['coordinate_uncertainty'] = pd.to_numeric(df['coordinate_uncertainty'], errors='coerce')
        else:
            df['coordinate_uncertainty'] = None

        # Process GBIF collection_location (already set by gbif_download.py with fallbacks)
        # Only use locality as fallback if collection_location is not already set
        if 'collection_location' in df.columns:
            df['collection_location'] = df['collection_location'].apply(clean_str)
        elif 'locality' in df.columns:
            df['collection_location'] = df['locality'].apply(clean_str)
        # Handle observation_date from various source columns
        if 'observation_date' not in df.columns or df['observation_date'].isna().all():
            for date_col in ['collection_date', 'event_date']:
                if date_col in df.columns:
                    df['observation_date'] = df[date_col].apply(clean_str)
                    break

        # Clean observation_url
        if 'observation_url' in df.columns:
            df['observation_url'] = df['observation_url'].apply(clean_str)

        # ═══════════════════════════════════════════════════════════════════
        # SEX FIELD (from Darwin Core)
        # ═══════════════════════════════════════════════════════════════════
        if 'sex' in df.columns:
            df['sex'] = df['sex'].apply(normalize_sex)
            sex_counts = df['sex'].value_counts(dropna=False)
            print(f"   Sex distribution: {dict(sex_counts)}")
        else:
            df['sex'] = None
            print("   No sex column found in GBIF data")

        # ═══════════════════════════════════════════════════════════════════
        # MIMICRY RING LOOKUP (from Dore database)
        # ═══════════════════════════════════════════════════════════════════
        print("   Applying mimicry ring lookup from Dore database...")

        mimicry_assignments = df.apply(
            lambda row: pd.Series(get_mimicry_assignment_for_row(row)),
            axis=1,
        )
        df['mimicry_ring'] = mimicry_assignments['mimicry_ring']
        df['mimicry_assignment_level'] = mimicry_assignments['assignment_level']
        df['mimicry_assignment_confidence'] = mimicry_assignments['confidence']
        df['mimicry_source_taxon'] = mimicry_assignments['source_taxon']
        
        matched = (df['mimicry_ring'] != 'Unknown').sum()
        print(f"   Mimicry ring matched for {matched:,}/{len(df):,} records")
        
        return df[required_cols]
        
    except Exception as e:
        print(f"   ERROR loading GBIF data: {e}")
        return pd.DataFrame()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def download_sanger_taxonomy():
    """Download the Sanger taxonomy reference sheet for use by the curation pipeline."""
    print("\n>> Downloading Sanger taxonomy reference sheet...")
    taxonomy_output = os.path.join(OUTPUT_DIR, "sanger_taxonomy.csv")
    try:
        url = get_google_export_url(SHEET_GIDS["Taxonomy_v18Jun25"])
        df = pd.read_csv(url, dtype=str)
        df.to_csv(taxonomy_output, index=False)
        species_count = (df['taxon_rank'] == 'species').sum() if 'taxon_rank' in df.columns else '?'
        print(f"   Saved {len(df)} rows ({species_count} species) to {taxonomy_output}")
    except Exception as e:
        print(f"   WARNING: Failed to download taxonomy sheet: {e}")
        print(f"   Curation will proceed without Sanger taxonomy reference.")


def main():
    print("=" * 70)
    print("ITHOMIINI MAPS - DATA PROCESSING PIPELINE")
    print("=" * 70)
    
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 1: Load Dore data FIRST (builds mimicry lookup table)
    # ═══════════════════════════════════════════════════════════════════════
    df_local = load_local_data()
    
    if df_local.empty:
        print("\nWARNING: Dore data not loaded - mimicry lookup will be empty!")
        print("   Other data sources will have 'Unknown' mimicry rings.")
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 2: Load other sources (uses mimicry lookup)
    # ═══════════════════════════════════════════════════════════════════════
    df_sanger = load_sanger_data()

    # Download Sanger taxonomy reference sheet
    download_sanger_taxonomy()

    # Merge local and sanger
    all_dfs = [df for df in [df_local, df_sanger] if not df.empty]
    
    if not all_dfs:
        print("\nERROR: No data loaded from any source!")
        sys.exit(1)
    
    df_merged = pd.concat(all_dfs, ignore_index=True)
    print(f"\n>> Merged dataset: {len(df_merged):,} records")
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 3: GBIF Data (uses mimicry lookup)
    # ═══════════════════════════════════════════════════════════════════════
    if USE_GBIF_BULK_DOWNLOAD:
        df_gbif = load_gbif_bulk_download()
        if not df_gbif.empty:
            df_merged = pd.concat([df_merged, df_gbif], ignore_index=True)
            print(f">> After GBIF bulk merge: {len(df_merged):,} records")
    
    # ═══════════════════════════════════════════════════════════════════════
    # FINAL CLEANING
    # ═══════════════════════════════════════════════════════════════════════

    # Standardize country names (ISO 2-letter codes -> full names)
    sys.path.insert(0, str(Path(__file__).parent))
    from country_utils import standardize_country
    df_merged['country'] = df_merged['country'].apply(standardize_country)

    # Ensure all string fields are properly typed
    str_cols = ['id', 'scientific_name', 'genus', 'species', 'family', 'tribe',
                'mimicry_ring', 'sequencing_status', 'source', 'country']
    for col in str_cols:
        if col in df_merged.columns:
            df_merged[col] = df_merged[col].fillna('Unknown').astype(str)

    # Handle subspecies (can be null)
    df_merged['subspecies'] = df_merged['subspecies'].apply(
        lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
    )

    # Handle image_url (can be null)
    df_merged['image_url'] = df_merged['image_url'].apply(
        lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
    )

    # Handle collection_location (can be null)
    if 'collection_location' not in df_merged.columns:
        df_merged['collection_location'] = None
    else:
        df_merged['collection_location'] = df_merged['collection_location'].apply(
            lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
        )

    # Handle observation_date (can be null)
    if 'observation_date' not in df_merged.columns:
        df_merged['observation_date'] = None
    else:
        df_merged['observation_date'] = df_merged['observation_date'].apply(
            lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
        )

    # Handle observation_url (can be null)
    if 'observation_url' not in df_merged.columns:
        df_merged['observation_url'] = None
    else:
        df_merged['observation_url'] = df_merged['observation_url'].apply(
            lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
        )

    # Handle sex (can be null)
    if 'sex' not in df_merged.columns:
        df_merged['sex'] = None
    else:
        df_merged['sex'] = df_merged['sex'].apply(
            lambda x: x if pd.notna(x) and x not in ['None', 'nan', ''] else None
        )

    # ═══════════════════════════════════════════════════════════════════════
    # OUTPUT STATISTICS
    # ═══════════════════════════════════════════════════════════════════════

    print("\n" + "=" * 70)
    print("OUTPUT STATISTICS")
    print("=" * 70)
    print(f"Total Records: {len(df_merged):,}")
    print(f"Unique Species: {df_merged['scientific_name'].nunique():,}")
    print(f"Unique Genera: {df_merged['genus'].nunique()}")
    print(f"Unique Mimicry Rings: {df_merged['mimicry_ring'].nunique()}")
    print(f"Records with Known Mimicry: {(df_merged['mimicry_ring'] != 'Unknown').sum():,}")
    print(f"Records with Images: {df_merged['image_url'].notna().sum():,}")

    print("\nBy Source:")
    print(df_merged['source'].value_counts().to_string())

    print("\nBy Sequencing Status:")
    print(df_merged['sequencing_status'].value_counts().to_string())

    # Sanger-specific breakdown for manuscript
    sanger = df_merged[df_merged['source'] == 'Sanger Institute']
    print(f"\n--- Sanger Institute Sequencing Breakdown (for manuscript) ---")
    print(f"Total Sanger specimens: {len(sanger)}")
    for status in ['Sequenced', 'Tissue at Sanger', 'Tissue Available', 'Preserved Specimen']:
        count = (sanger['sequencing_status'] == status).sum()
        pct = 100 * count / len(sanger) if len(sanger) > 0 else 0
        print(f"  {status}: {count} ({pct:.1f}%)")

    print("\nBy Sex:")
    sex_counts = df_merged['sex'].value_counts(dropna=False)
    print(sex_counts.to_string())
    male_count = (df_merged['sex'] == 'male').sum()
    female_count = (df_merged['sex'] == 'female').sum()
    unknown_count = df_merged['sex'].isna().sum()
    print(f"  Summary: {male_count:,} male, {female_count:,} female, {unknown_count:,} unknown")

    print("\nTop 10 Mimicry Rings:")
    mim_counts = df_merged[df_merged['mimicry_ring'] != 'Unknown']['mimicry_ring'].value_counts().head(10)
    print(mim_counts.to_string())
    
    # ═══════════════════════════════════════════════════════════════════════
    # SOURCE-SPECIFIC COORDINATE QUALITY HANDLING
    # ═══════════════════════════════════════════════════════════════════════

    initial_count = len(df_merged)
    env_root = Path(__file__).parent.parent / 'sdm' / 'data' / 'env_variables'
    quality = compute_gbif_quality_flags(df_merged)
    spatial = compute_spatial_qc(df_merged, env_root=env_root)

    high_uncert = quality['high_uncertainty']
    bad_locality = quality['no_specific_locality']
    out_of_bbox = spatial['outside_bbox']
    in_ocean = spatial['in_ocean']
    df_merged['spatial_check'] = spatial['spatial_check']

    gbif_mask = df_merged['source'].isin(GBIF_SOURCES)
    sanger_mask = df_merged['source'] == SANGER_SOURCE
    gbif_flagged = gbif_mask & (high_uncert | bad_locality | out_of_bbox | in_ocean)

    print(f"\n>> Source-specific coordinate quality checks ({spatial['ocean_mask_label']})")
    print(f"   Total records before QC: {initial_count:,}")
    print(f"   GBIF-family records checked for removal: {gbif_mask.sum():,}")
    print(f"     High uncertainty (>100km): {(gbif_mask & high_uncert).sum():,}")
    print(f"     No-specific-locality placeholders: {(gbif_mask & bad_locality).sum():,}")
    print(f"     Outside Neotropical bbox: {(gbif_mask & out_of_bbox).sum():,}")
    print(f"     Ocean points: {(gbif_mask & in_ocean).sum():,}")
    print(f"     Removed from GBIF-family sources: {gbif_flagged.sum():,}")
    print(f"   Sanger records flagged, not removed: {(sanger_mask & (out_of_bbox | in_ocean)).sum():,}")
    print(f"   Dore records preserved regardless of spatial flags")

    df_merged = df_merged[~gbif_flagged].copy()
    removed = initial_count - len(df_merged)
    print(f">> Coordinate quality result: {initial_count:,} → {len(df_merged):,} ({removed:,} removed)")

    # ═══════════════════════════════════════════════════════════════════════
    # SAVE OUTPUT
    # ═══════════════════════════════════════════════════════════════════════

    output_path = os.path.join(OUTPUT_DIR, "map_points.json")
    
    # Convert to list of dicts for JSON
    records = df_merged.to_dict(orient='records')

    # Replace float NaN with None so json.dump writes null (NaN is not valid JSON)
    import math
    for rec in records:
        for k, v in rec.items():
            if isinstance(v, float) and math.isnan(v):
                rec[k] = None

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)
    
    print(f"\n>> Saved to: {output_path}")
    print(f">> File size: {os.path.getsize(output_path) / 1024:.1f} KB")
    print("\nDone!")


if __name__ == "__main__":
    main()
