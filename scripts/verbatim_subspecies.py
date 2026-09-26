"""
Recover subspecies from the name a collection originally reported.

GBIF interprets every occurrence against its backbone taxonomy. When the
backbone does not list a subspecies (common for Ithomiini), the record is
matched to the species and the interpreted infraspecificEpithet is empty,
although the publisher's verbatim name still carries it, e.g.
"Ithomia salapia derasa Hewitson, 1855" or "Ithomia salapia ssp. aquinia".

parse_verbatim_subspecies() extracts that epithet conservatively: the name
must start with the record's own genus and species, and the third word must
look like an epithet rather than an author, year, qualifier or form.
Spelling variants (e.g. "aquina" for "aquinia") are left to the taxonomic
curation step, which merges subspecies typos across all sources.
"""

import re

RANK_MARKERS = {"ssp", "ssp.", "subsp", "subsp.", "subspecies", "race", "r."}
# Uncertain or non-subspecific qualifiers: the name is not a subspecies ID.
QUALIFIERS = {
    "cf", "cf.", "aff", "aff.", "nr", "nr.", "near", "sp", "sp.", "spp", "spp.",
    "var", "var.", "f", "f.", "form", "forma", "fm", "fm.", "ab", "ab.", "x",
    "hybrid", "n", "n.", "nov", "nov.", "indet", "indet.", "complex", "group",
    "sensu", "s.l.", "s.str.", "?",
}
EPITHET = re.compile(r"^[a-z][a-z-]{2,}$")
YEAR = re.compile(r"^\(?\[?\d{4}\]?\)?[,.]?$")


def _tokens(name):
    text = str(name or "").replace("\xa0", " ").strip().lower()
    return text.split()


def parse_verbatim_subspecies(verbatim_name, scientific_name):
    """Return the subspecies epithet in a verbatim name, or None.

    >>> parse_verbatim_subspecies("Ithomia salapia derasa Hewitson, 1855", "Ithomia salapia")
    'derasa'
    >>> parse_verbatim_subspecies("ithomia salapia ssp. aquinia", "Ithomia salapia")
    'aquinia'
    >>> parse_verbatim_subspecies("Ithomia salapia Hewitson, 1853", "Ithomia salapia") is None
    True
    """
    tokens = _tokens(verbatim_name)
    binomial = _tokens(scientific_name)
    if len(tokens) < 3 or len(binomial) != 2 or tokens[:2] != binomial:
        return None
    rest = tokens[2:]
    while rest and rest[0] in RANK_MARKERS:
        rest = rest[1:]
    if not rest:
        return None
    candidate = rest[0]
    following = rest[1] if len(rest) > 1 else ""
    if candidate in QUALIFIERS or not EPITHET.match(candidate):
        return None  # qualifiers, "(author", "author,", years and codes
    # "Genus species Author 1853" without a comma: an author, not an epithet.
    if YEAR.match(following):
        return None
    return candidate

