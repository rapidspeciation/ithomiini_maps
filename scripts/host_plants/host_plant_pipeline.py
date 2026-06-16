#!/usr/bin/env python3
"""Build conservative host-plant association and occurrence overlay data."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


csv.field_size_limit(sys.maxsize)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
DEFAULT_SEED_PATH = PROJECT_ROOT / "scripts" / "host_plants" / "ithomiini_hostplant_evidence_seed.json"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "public" / "data" / "host_plants"
DEFAULT_CACHE_PATH = PROJECT_ROOT / "scripts" / "host_plants" / "gbif_host_plant_taxa_cache.json"
DEFAULT_SUPPLEMENT_PATH = PROJECT_ROOT / "scripts" / "host_plants" / "host_plant_literature_supplement.json"
OCCURRENCE_DATASET_NAME = "host_plant_occurrences.json"
OCCURRENCE_CORE_DATASET_NAME = "host_plant_occurrence_core.json"
GALLERY_DATASET_NAME = "host_plant_gallery.json"
DEFAULT_CONFIDENCE_AUDIT_PATH = (
    PROJECT_ROOT
    / "scripts"
    / "host_plants"
    / "host_plant_confidence_reaudit_codex_20260521_taxon_level.csv"
)
DEFAULT_SOURCE_LEVEL_AUDIT_PATH = (
    PROJECT_ROOT / "scripts" / "host_plants" / "hostplant_source_level_audit_20260615.csv"
)
DEFAULT_RECORDS_TO_CHANGE_PATH = (
    PROJECT_ROOT / "scripts" / "host_plants" / "hostplant_records_to_change_20260523.csv"
)

GBIF_SPECIES_URL = "https://api.gbif.org/v1/species"
GBIF_SPECIES_MATCH_URL = f"{GBIF_SPECIES_URL}/match"
GBIF_PLANT_KINGDOM_KEY = 6
REQUEST_DELAY_SECONDS = 0.2
MAX_COORDINATE_UNCERTAINTY_METERS = 100_000
BECCALONI_2008_URL = (
    "https://www.researchgate.net/profile/George-Beccaloni-2/publication/"
    "262099000_Catalogue_of_the_Hostplants_of_the_Neotropical_Butterflies_"
    "Catalogo_de_las_Plantas_Huesped_de_las_Mariposas_Neotropicales/links/"
    "5cc0d98a92851c8d2202f3f1/Catalogue-of-the-Hostplants-of-the-Neotropical-"
    "Butterflies-Catalogo-de-las-Plantas-Huesped-de-las-Mariposas-Neotropicales.pdf"
)
BROWN_FREITAS_1994_URL = "https://journals.flvc.org/troplep/article/download/89949/86313"

SOURCE_URL_BY_CITATION = {
    "beccaloni et al. 2008": BECCALONI_2008_URL,
    "brown & freitas 1994": BROWN_FREITAS_1994_URL,
}

STUDY_EXTENT = {
    "min_lon": -120,
    "max_lon": -30,
    "min_lat": -60,
    "max_lat": 35,
}

RANK_ALIASES = {
    "species": "species",
    "near_species": "species",
    "genus": "genus",
    "genus_sp": "genus",
    "genus_spp": "genus",
    "probable_genus": "genus",
    "unidentified_species": "family",
    "unknown": "family",
}

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "unknown"


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clean_scientific_name(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    text = re.sub(r"\s*\([A-Z][a-zA-Z&\s.\-]+,?\s*\d{4}\)", "", text)
    text = re.sub(r"\s+[A-Z][a-zA-Z&\s.\-]+,\s*\d{4}$", "", text)
    text = re.sub(r"\s+[A-Z][a-zA-Z]+\s+\d{4}$", "", text)
    text = " ".join(text.split())
    parts = text.split()
    if len(parts) < 2:
        return text
    return f"{parts[0]} {parts[1]}"


def lower_name(value: Any) -> str | None:
    text = clean_scientific_name(value)
    return text.lower() if text else None


def normalize_confidence(value: Any) -> str:
    text = (clean_text(value) or "unknown").lower()
    if text in {"high", "medium", "low", "needs_check", "exclude"}:
        return text
    return "unknown"


def confidence_is_excluded(value: Any) -> bool:
    return normalize_confidence(value) == "exclude"


def confidence_allows_default_download(value: Any) -> bool:
    return normalize_confidence(value) in {"high", "medium"}


def confidence_bucket(value: Any) -> str:
    confidence = normalize_confidence(value)
    if confidence in {"high", "medium"}:
        return confidence
    if confidence in {"low", "needs_check"}:
        return "low"
    return "unknown"


def normalize_host_id_level(value: Any) -> str:
    text = (clean_text(value) or "unknown").lower()
    return RANK_ALIASES.get(text, text) if RANK_ALIASES.get(text, text) in {"species", "genus", "family"} else "family"


def normalize_evidence_level(*values: Any) -> str:
    explicit = (clean_text(values[0]) if values else None)
    if explicit:
        explicit_normalized = explicit.lower().replace("-", "_").replace(" ", "_")
        if explicit_normalized in {"direct", "literature", "needs_check"}:
            return explicit_normalized
    haystack = " ".join(str(value or "") for value in values).lower()
    if any(term in haystack for term in ("exclude", "erroneous", "unresolved", "needs check", "needs_check", "dubious", "audit")):
        return "needs_check"
    if any(term in haystack for term in ("egg", "larva", "larvae", "feeding", "oviposition", "rearing", "observed", "field observation", "direct")):
        return "direct"
    if any(term in haystack for term in ("literature", "catalogue", "catalog", "citation", "cited", "paper", "beccaloni", "brown", "expert", "captive", "lab")):
        return "literature"
    confidence = normalize_confidence(values[0] if values else None)
    if confidence == "high":
        return "direct"
    if confidence == "medium":
        return "literature"
    if confidence in {"low", "needs_check"}:
        return "needs_check"
    return "literature"


def evidence_detail_for_record(record: dict[str, Any]) -> str | None:
    return (
        clean_text(record.get("evidence_detail"))
        or clean_text(record.get("evidence_basis"))
        or clean_text(record.get("source_checked"))
        or clean_text(record.get("notes_for_web_app"))
        or clean_text(record.get("evidence_type"))
        or clean_text(record.get("source_refs"))
    )


def source_url_for_record(record: dict[str, Any]) -> str | None:
    """Prefer a URL that matches the source label shown in the app."""
    override = clean_text(record.get("source_url_override"))
    if override:
        return override
    display_source = (
        clean_text(record.get("citation_for_ui"))
        or clean_text(record.get("source_checked"))
        or clean_text(record.get("source_citation"))
        or clean_text(record.get("source_refs"))
    )
    source_key = display_source.lower() if display_source else ""
    for citation, url in SOURCE_URL_BY_CITATION.items():
        if citation in source_key:
            return url
    return clean_text(record.get("doi_or_url"))


def record_marked_erroneous(record: dict[str, Any]) -> bool:
    haystack = " ".join(
        str(record.get(field, ""))
        for field in ("confidence", "evidence_type", "caveats", "host_plant_name_verbatim")
    ).lower()
    return "erroneous" in haystack or "misidentification" in haystack


def canonical_host_taxon(record: dict[str, Any]) -> dict[str, Any]:
    raw_rank = clean_text(record.get("host_taxon_rank")) or "unknown"
    rank = RANK_ALIASES.get(raw_rank.lower(), raw_rank.lower())
    family = clean_text(record.get("host_plant_family"))
    genus = clean_text(record.get("host_plant_genus"))
    species = clean_text(record.get("host_plant_species"))

    if rank == "species" and species:
        canonical_name = species
    elif rank == "genus" and genus:
        canonical_name = genus
    elif family:
        canonical_name = family
        rank = "family"
    elif genus:
        canonical_name = genus
        rank = "genus"
    else:
        canonical_name = clean_text(record.get("host_plant_name_verbatim")) or "Unknown host plant"
        rank = "unknown"

    return {
        "canonical_name": canonical_name,
        "rank": rank,
        "family": family,
        "genus": genus,
        "species": species,
        "slug": slugify(f"{rank}-{canonical_name}"),
        "resolvable_to_gbif": rank in {"species", "genus"},
    }


def load_confidence_audit(path: Path | None) -> dict[int, dict[str, str]]:
    if not path or not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return {
            int(row["row_id"]): row
            for row in reader
            if clean_text(row.get("row_id")) and str(row["row_id"]).isdigit()
        }


def apply_confidence_audit(
    records: list[dict[str, Any]],
    audit_rows: dict[int, dict[str, str]],
) -> None:
    if not audit_rows:
        return
    rows_by_taxon_key: dict[tuple[str, str, str], list[dict[str, str]]] = {}
    for row in audit_rows.values():
        key = (
            (clean_text(row.get("butterfly_taxon")) or "").lower(),
            (clean_text(row.get("host_taxon_name")) or "").lower(),
            (clean_text(row.get("host_taxon_rank")) or "").lower(),
        )
        rows_by_taxon_key.setdefault(key, []).append(row)

    for index, record in enumerate(records, 1):
        taxon = canonical_host_taxon(record)
        key = (
            (clean_text(record.get("butterfly_taxon")) or "").lower(),
            taxon["canonical_name"].lower(),
            taxon["rank"].lower(),
        )
        rows = rows_by_taxon_key.get(key)
        row = rows.pop(0) if rows else audit_rows.get(index)
        if not row:
            continue
        curated_confidence = normalize_confidence(row.get("curated_confidence"))
        if curated_confidence != "unknown":
            record["confidence"] = curated_confidence
        record["curated_confidence"] = row.get("curated_confidence")
        record["curated_confidence_bucket"] = confidence_bucket(row.get("curated_confidence"))
        record["curation_action"] = clean_text(row.get("curation_action"))
        record["evidence_basis"] = clean_text(row.get("evidence_basis"))
        record["source_checked"] = clean_text(row.get("source_checked"))
        record["citation_for_ui"] = clean_text(row.get("citation_for_ui"))
        record["notes_for_web_app"] = clean_text(row.get("notes_for_web_app"))


def load_source_level_audit(path: Path | None) -> dict[int, dict[str, str]]:
    return load_confidence_audit(path)


def apply_source_level_audit(
    records: list[dict[str, Any]],
    audit_rows: dict[int, dict[str, str]],
) -> None:
    if not audit_rows:
        return
    for index, record in enumerate(records, 1):
        row = audit_rows.get(index)
        if not row:
            continue
        if clean_text(row.get("host_id_level")):
            record["host_id_level"] = normalize_host_id_level(row.get("host_id_level"))
        if clean_text(row.get("evidence_level")):
            record["evidence_level"] = normalize_evidence_level(row.get("evidence_level"))
        if clean_text(row.get("source_url_override")):
            record["source_url_override"] = clean_text(row.get("source_url_override"))
        detail = (
            clean_text(row.get("evidence_detail"))
            or clean_text(row.get("source_level_detail"))
            or clean_text(row.get("evidence_basis"))
            or clean_text(row.get("notes_for_web_app"))
        )
        if detail:
            record["evidence_detail"] = detail


def build_association_outputs(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    associations = []
    taxa_by_key: dict[tuple[str, str, str | None], dict[str, Any]] = {}

    for index, record in enumerate(records):
        if confidence_is_excluded(record.get("confidence")) or record_marked_erroneous(record):
            continue

        taxon = canonical_host_taxon(record)
        confidence = normalize_confidence(record.get("confidence"))
        host_id_level = normalize_host_id_level(record.get("host_id_level") or taxon["rank"])
        evidence_level = normalize_evidence_level(
            record.get("evidence_level"),
            record.get("evidence_type"),
            record.get("evidence_basis"),
            record.get("source_checked"),
            record.get("notes_for_web_app"),
            record.get("confidence"),
        )
        evidence_detail = evidence_detail_for_record(record)
        default_download_override = record.get("use_for_default_download")
        if isinstance(default_download_override, str):
            default_download_override = default_download_override.strip().lower() in {"1", "true", "yes", "y"}
        use_for_default_download = (
            bool(default_download_override)
            if default_download_override is not None
            else (taxon["resolvable_to_gbif"] and confidence_allows_default_download(confidence))
        )
        taxon_key = (taxon["canonical_name"].lower(), taxon["rank"], taxon["family"])

        association = {
            "id": f"assoc_{index + 1:04d}",
            "butterfly_taxon": clean_text(record.get("butterfly_taxon")),
            "butterfly_rank_used": clean_text(record.get("butterfly_rank_used")),
            "host_taxon_name": taxon["canonical_name"],
            "host_taxon_rank": taxon["rank"],
            "host_taxon_slug": taxon["slug"],
            "host_plant_family": taxon["family"],
            "host_plant_genus": taxon["genus"],
            "host_plant_species": taxon["species"],
            "host_plant_name_verbatim": clean_text(record.get("host_plant_name_verbatim")),
            "evidence_type": clean_text(record.get("evidence_type")),
            "beccaloni_marker": clean_text(record.get("beccaloni_marker")),
            "source_citation": clean_text(record.get("source_citation")),
            "source_refs": clean_text(record.get("source_refs")),
            "doi_or_url": source_url_for_record(record),
            "confidence": confidence,
            "confidence_bucket": confidence_bucket(confidence),
            "host_id_level": host_id_level,
            "evidence_level": evidence_level,
            "evidence_detail": evidence_detail,
            "evidence_context": clean_text(record.get("evidence_context")),
            "curated_confidence": clean_text(record.get("curated_confidence")) or confidence,
            "curation_action": clean_text(record.get("curation_action")),
            "evidence_basis": clean_text(record.get("evidence_basis")),
            "source_checked": clean_text(record.get("source_checked")),
            "citation_for_ui": clean_text(record.get("citation_for_ui")),
            "notes_for_web_app": clean_text(record.get("notes_for_web_app")),
            "caveats": clean_text(record.get("caveats")),
            "use_for_default_download": use_for_default_download,
        }
        associations.append(association)

        entry = taxa_by_key.setdefault(
            taxon_key,
            {
                "canonical_name": taxon["canonical_name"],
                "rank": taxon["rank"],
                "family": taxon["family"],
                "genus": taxon["genus"],
                "species": taxon["species"],
                "slug": taxon["slug"],
                "resolvable_to_gbif": taxon["resolvable_to_gbif"],
                "use_for_default_download": False,
                "association_count": 0,
                "butterfly_taxa": [],
                "confidence_counts": {},
                "host_id_level_counts": {},
                "evidence_counts": {},
                "occurrence_file": None,
            },
        )
        entry["association_count"] += 1
        entry["use_for_default_download"] = entry["use_for_default_download"] or use_for_default_download
        if association["butterfly_taxon"] and association["butterfly_taxon"] not in entry["butterfly_taxa"]:
            entry["butterfly_taxa"].append(association["butterfly_taxon"])
        entry["_confidence_counter"] = entry.get("_confidence_counter", Counter())
        entry["_confidence_counter"][confidence] += 1
        entry["_host_id_level_counter"] = entry.get("_host_id_level_counter", Counter())
        entry["_host_id_level_counter"][host_id_level] += 1
        entry["_evidence_counter"] = entry.get("_evidence_counter", Counter())
        entry["_evidence_counter"][evidence_level] += 1

    taxa = []
    for taxon in taxa_by_key.values():
        counter = taxon.pop("_confidence_counter", Counter())
        taxon["confidence_counts"] = dict(counter)
        taxon["host_id_level_counts"] = dict(taxon.pop("_host_id_level_counter", Counter()))
        taxon["evidence_counts"] = dict(taxon.pop("_evidence_counter", Counter()))
        taxon["butterfly_taxa"].sort()
        taxa.append(taxon)

    associations.sort(key=lambda item: (
        item["butterfly_taxon"] or "",
        item["host_taxon_rank"],
        item["host_taxon_name"],
    ))
    taxa.sort(key=lambda item: (item["rank"], item["canonical_name"]))
    return associations, taxa


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def load_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"metadata": {"created_at": utc_now()}, "taxa": {}}
    return load_json(path)


def enrich_accepted_usage(resolution: dict[str, Any], cache: dict[str, Any]) -> dict[str, Any]:
    """Attach accepted canonical/scientific names for GBIF synonym matches."""
    accepted_key = resolution.get("accepted_usage_key")
    if not accepted_key or resolution.get("accepted_canonical_name"):
        return resolution
    accepted_cache = cache.setdefault("accepted_taxa", {})
    cache_key = str(accepted_key)
    data = accepted_cache.get(cache_key)
    if data is None:
        response = requests.get(f"{GBIF_SPECIES_URL}/{accepted_key}", timeout=30)
        response.raise_for_status()
        data = response.json()
        accepted_cache[cache_key] = data
        time.sleep(REQUEST_DELAY_SECONDS)
    resolution["accepted_scientific_name"] = data.get("scientificName")
    resolution["accepted_canonical_name"] = data.get("canonicalName") or clean_scientific_name(data.get("scientificName"))
    resolution["accepted_rank"] = data.get("rank")
    return resolution


def resolve_taxon(taxon: dict[str, Any], cache: dict[str, Any], *, refresh: bool = False) -> dict[str, Any]:
    cache_key = f"{taxon['rank']}:{taxon['canonical_name'].lower()}"
    if not refresh and cache_key in cache.get("taxa", {}):
        cached = cache["taxa"][cache_key]
        requested_rank = (clean_text(taxon.get("rank")) or "").lower()
        gbif_rank = (clean_text(cached.get("gbif_rank")) or "").lower()
        if cached.get("status") == "resolved" and requested_rank in {"species", "genus"} and gbif_rank != requested_rank:
            cached = {
                "query": taxon["canonical_name"],
                "rank": taxon["rank"],
                "status": "not_resolved",
                "match_type": cached.get("match_type"),
                "note": (
                    f"GBIF matched {taxon['canonical_name']} to {cached.get('gbif_rank')} "
                    f"({cached.get('scientific_name')}); refusing higher-rank occurrence layer."
                ),
                "gbif_response": cached,
            }
            cache["taxa"][cache_key] = cached
        return enrich_accepted_usage(cached, cache)

    if not taxon["resolvable_to_gbif"]:
        resolution = {
            "query": taxon["canonical_name"],
            "rank": taxon["rank"],
            "status": "not_resolved",
            "note": "Family-level or unknown host association is retained as metadata only.",
        }
        cache.setdefault("taxa", {})[cache_key] = resolution
        return resolution

    params = {
        "name": taxon["canonical_name"],
        "rank": taxon["rank"].upper(),
        "kingdom": "Plantae",
        "verbose": "true",
        "strict": "false",
    }
    response = requests.get(GBIF_SPECIES_MATCH_URL, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    usage_key = data.get("usageKey") or data.get("acceptedUsageKey")
    kingdom = data.get("kingdom")
    match_type = data.get("matchType")
    gbif_rank = clean_text(data.get("rank")).lower()
    requested_rank = clean_text(taxon.get("rank")).lower()
    rank_mismatch = requested_rank in {"species", "genus"} and gbif_rank != requested_rank

    if not usage_key or match_type == "NONE" or rank_mismatch or (kingdom and kingdom != "Plantae"):
        resolution = {
            "query": taxon["canonical_name"],
            "rank": taxon["rank"],
            "status": "not_resolved",
            "match_type": match_type,
            "gbif_response": data,
        }
        if rank_mismatch:
            resolution["note"] = (
                f"GBIF matched {taxon['canonical_name']} to {data.get('rank')} "
                f"({data.get('scientificName')}); refusing higher-rank occurrence layer."
            )
    else:
        resolution = {
            "query": taxon["canonical_name"],
            "rank": taxon["rank"],
            "status": "resolved",
            "gbif_taxon_key": usage_key,
            "accepted_usage_key": data.get("acceptedUsageKey"),
            "scientific_name": data.get("scientificName"),
            "canonical_name": data.get("canonicalName") or taxon["canonical_name"],
            "gbif_rank": data.get("rank"),
            "taxonomic_status": data.get("status"),
            "match_type": match_type,
            "confidence": data.get("confidence"),
            "kingdom": kingdom,
            "family": data.get("family") or taxon.get("family"),
            "genus": data.get("genus") or taxon.get("genus"),
            "resolved_at": utc_now(),
        }

    resolution = enrich_accepted_usage(resolution, cache)
    cache.setdefault("taxa", {})[cache_key] = resolution
    time.sleep(REQUEST_DELAY_SECONDS)
    return resolution


def within_study_extent(lon: float, lat: float) -> bool:
    return (
        STUDY_EXTENT["min_lon"] <= lon <= STUDY_EXTENT["max_lon"]
        and STUDY_EXTENT["min_lat"] <= lat <= STUDY_EXTENT["max_lat"]
    )


def occurrence_is_usable(record: dict[str, Any]) -> bool:
    lon = record.get("decimalLongitude")
    lat = record.get("decimalLatitude")
    if lon is None or lat is None:
        return False
    if record.get("occurrenceStatus") and str(record["occurrenceStatus"]).upper() != "PRESENT":
        return False
    if "COORDINATE_INVALID" in record.get("issues", []):
        return False
    return within_study_extent(float(lon), float(lat))


def fetch_occurrences(taxon_key: int, *, limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = 0
    page_limit = min(300, limit)
    seen_coordinates: set[tuple[float, float]] = set()
    query = {
        "taxonKey": taxon_key,
        "kingdomKey": GBIF_PLANT_KINGDOM_KEY,
        "hasCoordinate": "true",
        "occurrenceStatus": "PRESENT",
        "decimalLongitude": f"{STUDY_EXTENT['min_lon']},{STUDY_EXTENT['max_lon']}",
        "decimalLatitude": f"{STUDY_EXTENT['min_lat']},{STUDY_EXTENT['max_lat']}",
    }

    while len(records) < limit:
        params = {**query, "limit": page_limit, "offset": offset}
        response = requests.get(GBIF_OCCURRENCE_SEARCH_URL, params=params, timeout=45)
        response.raise_for_status()
        data = response.json()
        for item in data.get("results", []):
            if not occurrence_is_usable(item):
                continue
            lon = round(float(item["decimalLongitude"]), 6)
            lat = round(float(item["decimalLatitude"]), 6)
            coord = (lon, lat)
            if coord in seen_coordinates:
                continue
            seen_coordinates.add(coord)
            records.append({
                "gbifID": item.get("gbifID"),
                "species": item.get("species"),
                "genus": item.get("genus"),
                "family": item.get("family"),
                "scientificName": item.get("scientificName"),
                "decimalLongitude": lon,
                "decimalLatitude": lat,
                "coordinateUncertaintyInMeters": item.get("coordinateUncertaintyInMeters"),
                "basisOfRecord": item.get("basisOfRecord"),
                "eventDate": item.get("eventDate"),
                "country": item.get("country"),
                "datasetName": item.get("datasetName"),
                "publisher": item.get("publisher"),
                "license": item.get("license"),
                "issues": item.get("issues", []),
            })
            if len(records) >= limit:
                break
        if data.get("endOfRecords") or not data.get("results"):
            break
        offset += page_limit
        time.sleep(REQUEST_DELAY_SECONDS)

    meta = {
        "query": query,
        "limit": limit,
        "returned_unique_coordinate_records": len(records),
        "dedupe": "Exact duplicate coordinates removed per taxon.",
        "download_doi": None,
        "download_doi_note": "GBIF occurrence/search API was used; no formal GBIF download DOI was minted.",
    }
    return records, meta


def submit_host_plant_download_request(credentials: dict[str, str], taxa: list[dict[str, Any]]) -> str:
    """Submit a host-plant occurrence request through GBIF's async Download API.

    This intentionally mirrors the app's update-database GBIF path in
    scripts/gbif_download_api.py instead of using occurrence/search for normal
    production data generation.
    """
    taxon_keys = taxon_key_map(taxa)
    if not taxon_keys:
        raise ValueError("No resolved GBIF taxon keys available for host plant download.")

    from scripts.gbif_download_api import submit_download_request as submit_ithomiini_download_request

    # Reuse the update database helper for the actual request submission.
    # It builds the same core predicates: TAXON_KEY, HAS_COORDINATE,
    # HAS_GEOSPATIAL_ISSUE=false, OCCURRENCE_STATUS=PRESENT, DWCA output.
    return submit_ithomiini_download_request(credentials, taxon_keys)


def taxon_key_map(taxa: list[dict[str, Any]]) -> dict[str, int]:
    return {
        taxon["slug"]: int(taxon["gbif_taxon_key"])
        for taxon in taxa
        if taxon.get("gbif_taxon_key")
    }


def accepted_genus(taxon: dict[str, Any]) -> str | None:
    resolution = taxon.get("gbif_resolution") or {}
    return clean_text(resolution.get("genus")) or clean_text(taxon.get("genus"))


def selected_taxa_for_download_request(taxa: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Avoid redundant species predicates when an accepted genus is already requested."""
    selected_genera = {
        accepted_genus(taxon)
        for taxon in taxa
        if taxon.get("rank") == "genus" and taxon.get("gbif_taxon_key")
    }
    selected_genera = {genus for genus in selected_genera if genus}
    suppressed: dict[str, str] = {}
    targets = []
    for taxon in taxa:
        if not taxon.get("gbif_taxon_key"):
            continue
        if taxon.get("rank") == "species":
            genus = accepted_genus(taxon)
            literal_genus = clean_text(taxon.get("genus"))
            if genus and genus in selected_genera and genus == literal_genus:
                suppressed[taxon["slug"]] = f"covered_by_genus:{genus}"
                continue
        targets.append(taxon)
    return targets, suppressed


def _dwca_row_to_occurrence(row: dict[str, str]) -> dict[str, Any] | None:
    lon = row.get("decimalLongitude")
    lat = row.get("decimalLatitude")
    if not lon or not lat:
        return None
    try:
        lon_float = round(float(lon), 6)
        lat_float = round(float(lat), 6)
    except (TypeError, ValueError):
        return None
    if not within_study_extent(lon_float, lat_float):
        return None
    if row.get("occurrenceStatus") and row["occurrenceStatus"].upper() != "PRESENT":
        return None
    uncertainty = clean_text(row.get("coordinateUncertaintyInMeters"))
    if uncertainty:
        try:
            if float(uncertainty) > MAX_COORDINATE_UNCERTAINTY_METERS:
                return None
        except ValueError:
            pass

    return {
        "gbifID": row.get("gbifID"),
        "taxonKey": row.get("taxonKey"),
        "acceptedTaxonKey": row.get("acceptedTaxonKey"),
        "speciesKey": row.get("speciesKey"),
        "taxonRank": row.get("taxonRank"),
        "taxonomicStatus": row.get("taxonomicStatus"),
        "acceptedScientificName": row.get("acceptedScientificName"),
        "species": row.get("species"),
        "genus": row.get("genus"),
        "family": row.get("family"),
        "scientificName": row.get("scientificName"),
        "decimalLongitude": lon_float,
        "decimalLatitude": lat_float,
        "coordinateUncertaintyInMeters": row.get("coordinateUncertaintyInMeters"),
        "basisOfRecord": row.get("basisOfRecord"),
        "eventDate": row.get("eventDate"),
        "country": row.get("country"),
        "datasetName": row.get("datasetName"),
        "publisher": row.get("publisher"),
        "license": row.get("license"),
        "issues": [issue for issue in (row.get("issue") or row.get("issues") or "").split(";") if issue],
    }


def occurrence_species_name(record: dict[str, Any]) -> str | None:
    species = clean_scientific_name(record.get("species"))
    if species:
        return species
    genus = clean_text(record.get("genus"))
    scientific = clean_scientific_name(record.get("scientificName"))
    if scientific and genus and scientific.split()[0] == genus and len(scientific.split()) >= 2:
        return scientific
    return None


def species_match_names(taxon: dict[str, Any]) -> set[str]:
    resolution = taxon.get("gbif_resolution") or {}
    names = {
        lower_name(taxon.get("canonical_name")),
        lower_name(taxon.get("species")),
        lower_name(resolution.get("canonical_name")),
        lower_name(resolution.get("scientific_name")),
        lower_name(resolution.get("accepted_canonical_name")),
        lower_name(resolution.get("accepted_scientific_name")),
    }
    return {name for name in names if name}


def occurrence_matches_taxon(record: dict[str, Any], taxon: dict[str, Any]) -> bool:
    rank = taxon.get("rank")
    if rank == "species":
        record_species = lower_name(occurrence_species_name(record))
        if not record_species:
            return False
        return record_species in species_match_names(taxon)
    if rank == "genus":
        record_genus = clean_text(record.get("genus"))
        target_genus = accepted_genus(taxon)
        return bool(record_genus and target_genus and record_genus.lower() == target_genus.lower())
    return False


def process_download_api_occurrences(
    extract_dir: Path,
    taxa: list[dict[str, Any]],
    *,
    limit: int,
    download_info: dict[str, Any],
) -> dict[str, tuple[list[dict[str, Any]], dict[str, Any]]]:
    effective_limit = limit if limit and limit > 0 else None
    occurrence_path = extract_dir / "occurrence.txt"
    records_by_slug: dict[str, list[dict[str, Any]]] = {taxon["slug"]: [] for taxon in taxa}
    seen_by_slug: dict[str, set[tuple[float, float]]] = {taxon["slug"]: set() for taxon in taxa}
    taxa_by_slug = {taxon["slug"]: taxon for taxon in taxa}

    species_slugs_by_name: dict[str, set[str]] = {}
    species_slugs_by_key: dict[str, set[str]] = {}
    genus_slugs_by_name: dict[str, set[str]] = {}
    for taxon in taxa:
        if taxon.get("rank") == "species":
            for name in species_match_names(taxon):
                species_slugs_by_name.setdefault(name, set()).add(taxon["slug"])
            resolution = taxon.get("gbif_resolution") or {}
            for key in (taxon.get("gbif_taxon_key"), resolution.get("accepted_usage_key")):
                key_text = clean_text(key)
                if key_text:
                    species_slugs_by_key.setdefault(key_text, set()).add(taxon["slug"])
        elif taxon.get("rank") == "genus":
            genus = accepted_genus(taxon)
            if genus:
                genus_slugs_by_name.setdefault(genus.lower(), set()).add(taxon["slug"])

    with occurrence_path.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            record = _dwca_row_to_occurrence(row)
            if not record:
                continue
            candidate_slugs: set[str] = set()
            record_species = lower_name(occurrence_species_name(record))
            if record_species:
                candidate_slugs.update(species_slugs_by_name.get(record_species, set()))
            for key in (record.get("taxonKey"), record.get("acceptedTaxonKey"), record.get("speciesKey")):
                key_text = clean_text(key)
                if key_text:
                    candidate_slugs.update(species_slugs_by_key.get(key_text, set()))
            record_genus = clean_text(record.get("genus"))
            if record_genus:
                candidate_slugs.update(genus_slugs_by_name.get(record_genus.lower(), set()))

            for slug in candidate_slugs:
                taxon = taxa_by_slug[slug]
                if effective_limit is not None and len(records_by_slug[slug]) >= effective_limit:
                    continue
                coord = (record["decimalLongitude"], record["decimalLatitude"])
                if coord in seen_by_slug[slug]:
                    continue
                seen_by_slug[slug].add(coord)
                records_by_slug[slug].append({
                    **record,
                    "host_taxon_slug": slug,
                    "host_taxon_rank": taxon["rank"],
                    "host_taxon_name": taxon["canonical_name"],
                    "resolved_taxon_key": taxon.get("gbif_taxon_key"),
                })

    doi = download_info.get("doi")
    query_meta = {
        "method": "gbif_download_api",
        "download_key": download_info.get("key"),
        "download_doi": doi,
        "download_doi_url": f"https://doi.org/{doi}" if doi else None,
        "limit": effective_limit,
        "dedupe": "Exact duplicate coordinates removed per taxon after DWCA download.",
        "filters": (
            "GBIF Download API DWCA with TAXON_KEY, HAS_COORDINATE=true, "
            "HAS_GEOSPATIAL_ISSUE=false, OCCURRENCE_STATUS=PRESENT; app study extent and "
            "coordinate uncertainty <=100km applied locally."
        ),
    }
    return {
        slug: (records, {**query_meta, "returned_unique_coordinate_records": len(records)})
        for slug, records in records_by_slug.items()
    }


def to_occurrence_feature_collection(
    occurrence_results: dict[str, tuple[list[dict[str, Any]], dict[str, Any]]],
    *,
    download_info: dict[str, Any] | None,
) -> dict[str, Any]:
    features = []
    for records, _meta in occurrence_results.values():
        for record in records:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [record["decimalLongitude"], record["decimalLatitude"]],
                },
                "properties": {
                    key: value
                    for key, value in record.items()
                    if key not in {"decimalLongitude", "decimalLatitude"}
                },
            })
    doi = (download_info or {}).get("doi")
    return {
        "type": "FeatureCollection",
        "metadata": {
            "generated_at": utc_now(),
            "method": "gbif_download_api",
            "download_key": (download_info or {}).get("key"),
            "download_doi": doi,
            "download_doi_url": f"https://doi.org/{doi}" if doi else None,
            "feature_count": len(features),
            "filters": (
                "GBIF Download API DWCA with TAXON_KEY, HAS_COORDINATE=true, "
                "HAS_GEOSPATIAL_ISSUE=false, OCCURRENCE_STATUS=PRESENT; app study extent and "
                "coordinate uncertainty <=100km applied locally. Species/genus assignment uses "
                "each occurrence row's own taxonomy."
            ),
        },
        "features": features,
    }


def _dwca_media_row_to_image(row: dict[str, str]) -> dict[str, Any] | None:
    identifier = clean_text(row.get("identifier"))
    if not identifier or not identifier.startswith(("http://", "https://")):
        return None
    media_type = (clean_text(row.get("type")) or "").lower()
    media_format = (clean_text(row.get("format")) or "").lower()
    if media_type and media_type != "stillimage":
        return None
    if media_format and not media_format.startswith("image/"):
        return None
    return {
        "url": identifier,
        "references": clean_text(row.get("references")),
        "title": clean_text(row.get("title")),
        "creator": clean_text(row.get("creator")),
        "publisher": clean_text(row.get("publisher")),
        "license": clean_text(row.get("license")),
        "rightsHolder": clean_text(row.get("rightsHolder")),
    }


def attach_multimedia_to_occurrences(
    extract_dir: Path,
    occurrence_results: dict[str, tuple[list[dict[str, Any]], dict[str, Any]]],
) -> None:
    multimedia_path = extract_dir / "multimedia.txt"
    if not multimedia_path.exists():
        return

    records_by_id: dict[str, list[dict[str, Any]]] = {}
    for records, _meta in occurrence_results.values():
        for record in records:
            gbif_id = clean_text(record.get("gbifID"))
            if not gbif_id:
                continue
            records_by_id.setdefault(gbif_id, []).append(record)

    representative_by_species: dict[str, dict[str, Any]] = {}
    with multimedia_path.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            records = records_by_id.get(str(row.get("gbifID") or ""))
            if not records:
                continue
            image = _dwca_media_row_to_image(row)
            if not image:
                continue
            for record in records:
                record.setdefault("media", []).append(image)
                species_key = clean_text(record.get("species")) or clean_text(record.get("scientificName"))
                if species_key and species_key not in representative_by_species:
                    representative_by_species[species_key] = image

    for records, _meta in occurrence_results.values():
        for record in records:
            if record.get("media"):
                continue
            species_key = clean_text(record.get("species")) or clean_text(record.get("scientificName"))
            fallback = representative_by_species.get(species_key) if species_key else None
            if fallback:
                record["fallback_media"] = fallback


def fetch_occurrences_via_download_api(
    taxa: list[dict[str, Any]],
    *,
    limit: int,
    reuse_download_hours: int,
    download_key: str | None,
) -> tuple[dict[str, tuple[list[dict[str, Any]], dict[str, Any]]], dict[str, Any], dict[str, str]]:
    from scripts.gbif_download_api import (
        download_and_extract,
        find_recent_download,
        load_credentials,
        wait_for_download,
    )

    download_targets, suppressed = selected_taxa_for_download_request(taxa)
    if not download_targets:
        raise ValueError("No resolved GBIF taxon keys available for host plant download.")

    local_extract_dir = PROJECT_ROOT / "temp_gbif_download" / "extracted"
    if download_key and (local_extract_dir / "occurrence.txt").exists():
        download_info = {
            "key": download_key,
            "doi": "10.15468/dl.3464gs" if download_key == "0009656-260519110011954" else None,
            "downloadLink": None,
            "local_extract_dir": str(local_extract_dir),
        }
        extract_dir = local_extract_dir
    else:
        credentials = load_credentials()
        if download_key:
            download_info = wait_for_download(download_key, credentials)
        else:
            download_info = find_recent_download(
                credentials,
                taxon_key_map(download_targets),
                max_age_hours=reuse_download_hours,
            )
        if not download_info and not download_key:
            download_key = submit_host_plant_download_request(credentials, download_targets)
            download_info = wait_for_download(download_key, credentials)
        extract_dir = download_and_extract(download_info)
    results = process_download_api_occurrences(
        extract_dir,
        taxa,
        limit=limit,
        download_info=download_info,
    )
    attach_multimedia_to_occurrences(extract_dir, results)
    return results, download_info, suppressed


def to_geojson(taxon: dict[str, Any], resolution: dict[str, Any], records: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "metadata": {
            "host_taxon": taxon,
            "gbif_resolution": resolution,
            "occurrence_query": meta,
            "scientific_caveat": (
                "GBIF plant occurrences are sampling-biased context records and do not prove "
                "local host use or ecological availability for the butterfly."
            ),
            "generated_at": utc_now(),
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [record["decimalLongitude"], record["decimalLatitude"]],
                },
                "properties": {
                    key: value
                    for key, value in record.items()
                    if key not in {"decimalLongitude", "decimalLatitude"}
                },
            }
            for record in records
        ],
    }


def build_manifest(taxa: list[dict[str, Any]], seed_metadata: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    return {
        "metadata": {
            "generated_at": utc_now(),
            "source_seed": str(args.seed),
            "source_confidence_audit": (
                str(args.confidence_audit)
                if args.confidence_audit and args.confidence_audit.exists()
                else None
            ),
            "seed_metadata": seed_metadata,
            "study_extent": STUDY_EXTENT,
            "confidence_policy": {
                "association_metadata": "high, medium, and low confidence records are retained unless excluded or erroneous.",
                "ui_thresholds": (
                    "High shows direct or life-history evidence only; Medium includes High plus "
                    "catalogue-backed records; Low also includes tentative or needs-check records."
                ),
                "default_occurrence_downloads": "high and medium only; low and needs-check records are not default GBIF targets.",
            },
            "scientific_caveat": (
                "Host-plant GBIF layers are optional context overlays. They are not SDM predictors "
                "and do not demonstrate local host use."
            ),
            "gbif_download_doi": getattr(args, "gbif_download_doi", None),
            "gbif_download_doi_note": (
                "Host plant occurrences are generated through the same GBIF Download API "
                "method as the database update pipeline when GBIF credentials are available."
            ),
            "occurrence_limit_per_taxon": args.occurrence_limit if args.occurrence_limit > 0 else None,
            "gbif_method": args.gbif_method,
            "occurrence_dataset": OCCURRENCE_DATASET_NAME,
            "occurrence_core_dataset": OCCURRENCE_CORE_DATASET_NAME,
            "gallery_dataset": GALLERY_DATASET_NAME,
        },
        "taxa": taxa,
    }


def select_taxa_for_occurrence_download(
    taxa: list[dict[str, Any]],
    *,
    taxon_filters: list[str],
    rank_filters: list[str],
    max_taxa: int | None,
    include_low_confidence: bool,
) -> list[dict[str, Any]]:
    filters = {value.lower() for value in taxon_filters}
    ranks = {value.lower() for value in rank_filters}
    selected = []
    for taxon in taxa:
        if filters and taxon["canonical_name"].lower() not in filters and taxon["slug"].lower() not in filters:
            continue
        if ranks and taxon["rank"].lower() not in ranks:
            continue
        if not taxon["resolvable_to_gbif"]:
            continue
        if not include_low_confidence and not taxon["use_for_default_download"]:
            continue
        selected.append(taxon)
    if max_taxa is not None:
        selected = selected[:max_taxa]
    return selected


def run_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    seed = load_json(args.seed)
    records = list(seed.get("records", []))
    supplement_metadata = None
    if args.supplement and args.supplement.exists():
        supplement = load_json(args.supplement)
        supplement_metadata = supplement.get("metadata", {})
        records.extend(supplement.get("records", []))
    confidence_audit = load_confidence_audit(args.confidence_audit)
    apply_confidence_audit(records, confidence_audit)
    source_level_audit = load_source_level_audit(args.source_level_audit)
    apply_source_level_audit(records, source_level_audit)
    records_to_change = load_source_level_audit(args.records_to_change)
    apply_source_level_audit(records, records_to_change)
    associations, taxa = build_association_outputs(records)
    cache = load_cache(args.cache)

    selected = select_taxa_for_occurrence_download(
        taxa,
        taxon_filters=args.taxon,
        rank_filters=args.host_rank,
        max_taxa=args.max_taxa,
        include_low_confidence=args.include_low_confidence,
    )

    occurrence_dir = args.output / "occurrences"
    selected_slugs = {taxon["slug"] for taxon in selected}
    for index, taxon in enumerate(taxa, 1):
        if selected_slugs and taxon["slug"] in selected_slugs:
            if index == 1 or index % 25 == 0:
                print(f"Resolving host plant taxa [{index}/{len(taxa)}]...", flush=True)
            resolution = resolve_taxon(taxon, cache, refresh=args.refresh_taxa)
            write_json(args.cache, cache)
        else:
            resolution = {
                "query": taxon["canonical_name"],
                "rank": taxon["rank"],
                "status": "not_queried",
                "note": "Resolution deferred until this host taxon is selected for occurrence generation.",
            }
        taxon["gbif_resolution"] = resolution
        taxon["gbif_taxon_key"] = resolution.get("gbif_taxon_key")
        taxon["gbif_status"] = resolution.get("status")
        taxon["occurrence_count"] = 0
        taxon["occurrence_mode"] = "not_generated"

    selected_resolved = [
        taxon
        for taxon in taxa
        if taxon["slug"] in selected_slugs and taxon["gbif_resolution"].get("status") == "resolved"
    ]

    download_api_results: dict[str, tuple[list[dict[str, Any]], dict[str, Any]]] = {}
    suppressed_download_slugs: dict[str, str] = {}
    download_info: dict[str, Any] | None = None
    if not args.dry_run and selected_resolved and args.gbif_method == "download-api":
        download_api_results, download_info, suppressed_download_slugs = fetch_occurrences_via_download_api(
            selected_resolved,
            limit=args.occurrence_limit,
            reuse_download_hours=args.reuse_download_hours,
            download_key=args.download_key,
        )
        args.gbif_download_doi = download_info.get("doi")

    if not args.dry_run:
        unified_results: dict[str, tuple[list[dict[str, Any]], dict[str, Any]]] = {}
        for taxon in selected_resolved:
            resolution = taxon["gbif_resolution"]
            if args.gbif_method == "download-api":
                records, meta = download_api_results.get(taxon["slug"], ([], {}))
            else:
                records, meta = fetch_occurrences(int(resolution["gbif_taxon_key"]), limit=args.occurrence_limit)
                records = [
                    {
                        **record,
                        "host_taxon_slug": taxon["slug"],
                        "host_taxon_rank": taxon["rank"],
                        "host_taxon_name": taxon["canonical_name"],
                        "resolved_taxon_key": taxon.get("gbif_taxon_key"),
                    }
                    for record in records
                    if occurrence_matches_taxon(record, taxon)
                ]
            unified_results[taxon["slug"]] = (records, meta)
            taxon["occurrence_count"] = len(records)
            taxon["occurrence_mode"] = "unified_dataset"
            taxon["occurrence_cap"] = args.occurrence_limit if args.occurrence_limit > 0 else None
            if taxon["slug"] in suppressed_download_slugs:
                taxon["download_request"] = suppressed_download_slugs[taxon["slug"]]
        write_json(
            args.output / OCCURRENCE_DATASET_NAME,
            to_occurrence_feature_collection(unified_results, download_info=download_info),
        )

    write_json(args.cache, cache)
    write_json(args.output / "host_plant_associations.json", {
        "metadata": {
            "generated_at": utc_now(),
            "source_seed": str(args.seed),
            "source_supplement": str(args.supplement) if args.supplement and args.supplement.exists() else None,
            "source_confidence_audit": (
                str(args.confidence_audit)
                if args.confidence_audit and args.confidence_audit.exists()
                else None
            ),
            "source_level_audit": (
                str(args.source_level_audit)
                if args.source_level_audit and args.source_level_audit.exists()
                else None
            ),
            "records_to_change": (
                str(args.records_to_change)
                if args.records_to_change and args.records_to_change.exists()
                else None
            ),
            "record_count": len(associations),
            "host_filter_schema": {
                "host_id_level": ["species", "genus", "family"],
                "evidence_level": ["direct", "literature", "needs_check"],
                "defaults": {"host_id_level": ["species"], "evidence_level": ["direct", "literature"]},
            },
            "excluded_policy": "confidence=exclude and records marked erroneous are omitted.",
        },
        "associations": associations,
    })
    write_json(args.output / "host_plant_taxa.json", {
        "metadata": {
            "generated_at": utc_now(),
            "source_seed": str(args.seed),
            "source_supplement": str(args.supplement) if args.supplement and args.supplement.exists() else None,
            "source_confidence_audit": (
                str(args.confidence_audit)
                if args.confidence_audit and args.confidence_audit.exists()
                else None
            ),
            "taxon_count": len(taxa),
        },
        "taxa": taxa,
    })
    seed.setdefault("metadata", {})["supplement"] = supplement_metadata
    manifest = build_manifest(taxa, seed.get("metadata", {}), args)
    write_json(args.output / "host_plant_layers_manifest.json", manifest)
    if not args.dry_run and (args.output / OCCURRENCE_DATASET_NAME).exists():
        from build_host_plant_taxon_shards import build_taxon_shards

        build_taxon_shards(args.output)
    return {"associations": associations, "taxa": taxa, "selected": selected}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED_PATH)
    parser.add_argument("--supplement", type=Path, default=DEFAULT_SUPPLEMENT_PATH)
    parser.add_argument("--confidence-audit", type=Path, default=DEFAULT_CONFIDENCE_AUDIT_PATH)
    parser.add_argument("--source-level-audit", type=Path, default=DEFAULT_SOURCE_LEVEL_AUDIT_PATH)
    parser.add_argument("--records-to-change", type=Path, default=DEFAULT_RECORDS_TO_CHANGE_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE_PATH)
    parser.add_argument("--taxon", action="append", default=[], help="Canonical host taxon name or slug to generate.")
    parser.add_argument(
        "--host-rank",
        action="append",
        default=[],
        choices=["species", "genus"],
        help="Restrict occurrence generation to a host taxon rank. Repeat for multiple ranks.",
    )
    parser.add_argument("--max-taxa", type=int, default=None, help="Maximum number of taxa to generate occurrences for.")
    parser.add_argument(
        "--occurrence-limit",
        type=int,
        default=0,
        help="Maximum unique-coordinate records per taxon. Use 0 for all available records.",
    )
    parser.add_argument(
        "--gbif-method",
        choices=["download-api", "search-api"],
        default="download-api",
        help=(
            "GBIF occurrence source. download-api is the normal path and matches the "
            "database update pipeline; search-api is only a quick local development fallback."
        ),
    )
    parser.add_argument(
        "--reuse-download-hours",
        type=int,
        default=24,
        help="Lookback window for reusing a completed matching GBIF Download API job on the account.",
    )
    parser.add_argument(
        "--download-key",
        default=None,
        help="Process a specific existing GBIF Download API job key instead of submitting a new job.",
    )
    parser.add_argument("--include-low-confidence", action="store_true")
    parser.add_argument("--refresh-taxa", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run_pipeline(args)
    print(
        f"Wrote {len(result['associations'])} host associations, "
        f"{len(result['taxa'])} host taxa, selected {len(result['selected'])} occurrence layer(s)."
    )


if __name__ == "__main__":
    main()
