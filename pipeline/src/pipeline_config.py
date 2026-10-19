"""Load every file in pipeline/config into plain Python objects.

All validation of the mapping files happens here, so a typo in a family name
fails loudly before any scoring runs. The `check` column in the CSVs is for the
human reviewer and is never read.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

PIPELINE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = PIPELINE_DIR / "config"
RAW_DIR = PIPELINE_DIR / "raw"
BUILD_DIR = PIPELINE_DIR / "build"
CATALOGUE_PATH = BUILD_DIR / "catalogue.parquet"


@dataclass(frozen=True)
class Mapping:
    """One mapping row: a 14-value family weight vector plus the facets it carries."""

    weights: np.ndarray
    facets: frozenset[str]


@dataclass(frozen=True)
class Config:
    family_names: list[str]
    family_harshness: np.ndarray
    facet_names: list[str]
    facet_nudges: np.ndarray
    scoring: dict
    accord_map: dict[str, Mapping]
    note_map: dict[str, Mapping]
    note_aliases: dict[str, str]
    # (alias, target) pairs for search. One alias may point at several targets.
    brand_aliases: list[tuple[str, str]]
    name_aliases: list[tuple[str, str]]
    # slug -> database id for fragrances that already exist in production (DECISIONS B28).
    pinned_ids: dict[str, int]


def _read_yaml(name: str, config_dir: Path) -> dict:
    with (config_dir / name).open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def _split(cell: object) -> list[str]:
    """Split a ';'-separated cell. Empty or missing cells give an empty list."""
    if not isinstance(cell, str) or not cell.strip():
        return []
    return [part.strip() for part in cell.split(";")]


def parse_mapping_csv(
    path: Path,
    key_column: str,
    family_names: list[str],
    facet_names: list[str],
    tolerance: float,
) -> dict[str, Mapping]:
    """Read an accord or note map and check every row.

    Reads the named columns only, so the reviewer's `check` column is ignored.
    """
    df = pd.read_csv(path, usecols=[key_column, "family_weights", "facets"], dtype=str)
    index = {name: i for i, name in enumerate(family_names)}
    result: dict[str, Mapping] = {}
    for _, row in df.iterrows():
        key = row[key_column]
        if key in result:
            raise ValueError(f"{path.name}: duplicate row for '{key}'")
        result[key] = _parse_row(path.name, key, row, index, set(facet_names), tolerance)
    return result


def _parse_row(
    file_name: str,
    key: str,
    row: pd.Series,
    family_index: dict[str, int],
    known_facets: set[str],
    tolerance: float,
) -> Mapping:
    weights = np.zeros(len(family_index))
    for pair in _split(row["family_weights"]):
        name, _, value = pair.rpartition(":")
        if name not in family_index:
            raise ValueError(f"{file_name}: '{key}' uses unknown family '{name}'")
        weights[family_index[name]] += float(value)
    if abs(weights.sum() - 1.0) > tolerance:
        raise ValueError(f"{file_name}: weights for '{key}' sum to {weights.sum():.6f}, not 1")
    facets = frozenset(_split(row["facets"]))
    unknown = facets - known_facets
    if unknown:
        raise ValueError(f"{file_name}: '{key}' uses unknown facet(s) {sorted(unknown)}")
    return Mapping(weights, facets)


def read_alias_pairs(path: Path, alias_column: str, target_column: str) -> list[tuple[str, str]]:
    """Read a search-alias CSV as (alias, target) pairs. The `check` column is ignored.

    Read as text with no NA parsing, so an alias like "NA" stays a string.
    """
    df = pd.read_csv(path, usecols=[alias_column, target_column], dtype=str, keep_default_na=False)
    rows = zip(df[alias_column], df[target_column], strict=True)
    pairs = [(a.strip(), t.strip()) for a, t in rows]
    if any(not a or not t for a, t in pairs):
        raise ValueError(f"{path.name}: every row needs an alias and a {target_column}")
    if len({(a.casefold(), t.casefold()) for a, t in pairs}) != len(pairs):
        raise ValueError(f"{path.name}: duplicate alias row")
    return pairs


def read_pinned_ids(path: Path) -> dict[str, int]:
    """Read id,slug pairs. A guest's saved Own/Want list stores these ids, so they never change."""
    df = pd.read_csv(path, dtype={"id": int, "slug": str}, keep_default_na=False)
    if df["id"].duplicated().any() or df["slug"].duplicated().any():
        raise ValueError(f"{path.name}: duplicate id or slug")
    if (df["id"] < 1).any() or (df["slug"].str.strip() == "").any():
        raise ValueError(f"{path.name}: every row needs a positive id and a slug")
    return dict(zip(df["slug"], df["id"].astype(int), strict=True))


def load_config(config_dir: Path = CONFIG_DIR) -> Config:
    families = _read_yaml("families.yaml", config_dir)["families"]
    families = sorted(families, key=lambda f: f["position"])
    if [f["position"] for f in families] != list(range(len(families))):
        raise ValueError("families.yaml: positions must be 0..N-1 with no gaps")
    facets = _read_yaml("facets.yaml", config_dir)["facets"]
    scoring = _read_yaml("scoring.yaml", config_dir)

    family_names = [f["name"] for f in families]
    facet_names = [f["name"] for f in facets]
    tolerance = scoring["weight_sum_tolerance"]
    aliases = pd.read_csv(config_dir / "note_aliases.csv", usecols=["alias", "canonical"])
    return Config(
        family_names=family_names,
        family_harshness=np.array([f["harshness"] for f in families], dtype=float),
        facet_names=facet_names,
        facet_nudges=np.array([f["harshness_nudge"] for f in facets], dtype=float),
        scoring=scoring,
        accord_map=parse_mapping_csv(
            config_dir / "accord_map.csv", "accord", family_names, facet_names, tolerance
        ),
        note_map=parse_mapping_csv(
            config_dir / "note_map.csv", "note", family_names, facet_names, tolerance
        ),
        note_aliases=dict(zip(aliases["alias"], aliases["canonical"], strict=True)),
        brand_aliases=read_alias_pairs(config_dir / "brand_aliases.csv", "alias", "brand"),
        name_aliases=read_alias_pairs(config_dir / "name_aliases.csv", "alias", "name_word"),
        pinned_ids=read_pinned_ids(config_dir / "pinned_ids.csv"),
    )
