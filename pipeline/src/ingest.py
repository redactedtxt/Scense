"""Step 2: turn the raw Kaggle CSV into a clean catalogue (parquet).

Column names come from pipeline/DATASET_NOTES.md (written from inspect_dataset.py).
Usage: python src/ingest.py
"""

import json
import re
import unicodedata

import pandas as pd

from pipeline_config import CATALOGUE_PATH, RAW_DIR, Config, load_config

LAYER_COLUMNS = {
    "notes_top": "top",
    "notes_middle": "heart",
    "notes_base": "base",
    "notes_flat": "flat",
}
IMAGE_URL = "https://fimgs.net/mdimg/perfume/375x500.{id}.jpg"


def split_pairs(cell: object) -> list[tuple[str, float]]:
    """Parse 'name:100|name:47' into (name, value) pairs. Empty cells give []."""
    if not isinstance(cell, str) or not cell:
        return []
    pairs = []
    for part in cell.split("|"):
        # rpartition so a name that contains ':' still parses.
        name, _, value = part.rpartition(":")
        pairs.append((name, float(value)))
    return pairs


def slugify(text: str) -> str:
    """Lowercase kebab-case with accents stripped."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def build_slug(brand: str, name: str, year: float | None) -> str:
    """brand-name-year; the year is left out when unknown."""
    parts = [slugify(brand), slugify(name)]
    if year is not None and not pd.isna(year):
        parts.append(str(int(year)))
    return "-".join(p for p in parts if p)


def assign_slugs(df: pd.DataFrame) -> pd.Series:
    """Build slugs, appending the dataset id to every row in a full collision.

    Collisions are checked inside this frame only, so a slug never changes
    because of an unrelated fragrance elsewhere in the dataset.
    """
    slugs = pd.Series(
        [build_slug(b, n, y) for b, n, y in zip(df["brand"], df["name"], df["year"], strict=True)],
        index=df.index,
    )
    collides = slugs.duplicated(keep=False)
    slugs[collides] = slugs[collides] + "-" + df.loc[collides, "id"].astype(str)
    return slugs


def apply_aliases(pairs: list[tuple[str, float]], aliases: dict[str, str]):
    """Rename note variants to their canonical name; a note listed twice keeps its top weight."""
    best: dict[str, float] = {}
    for name, weight in pairs:
        canonical = aliases.get(name, name)
        best[canonical] = max(weight, best.get(canonical, weight))
    return list(best.items())


def notes_for_row(row: pd.Series, aliases: dict[str, str]) -> list[dict]:
    """All notes of one fragrance as {note, layer, weight}, aliases applied per layer."""
    notes = []
    for column, layer in LAYER_COLUMNS.items():
        for note, weight in apply_aliases(split_pairs(row[column]), aliases):
            notes.append({"note": note, "layer": layer, "weight": weight})
    return notes


def check_catalogue(catalogue: pd.DataFrame, cfg: Config) -> None:
    """Fail loudly on anything the model cannot handle, instead of skipping it."""
    min_votes = cfg.scoring["min_strength_votes"]
    thin = catalogue[catalogue["strength_votes"] < min_votes]
    if len(thin):
        raise ValueError(f"{len(thin)} fragrances have fewer than {min_votes} strength votes")
    seen = {a for accords in catalogue["accords"] for a, _ in json.loads(accords)}
    unmapped = sorted(seen - set(cfg.accord_map))
    if unmapped:
        raise ValueError(f"accords missing from accord_map.csv: {unmapped}")
    if catalogue["slug"].duplicated().any():
        raise ValueError("slug collision survived the id suffix")
    # Guests' saved Own/Want ids point at these fragrances (DECISIONS B28).
    lost = sorted(set(cfg.pinned_ids) - set(catalogue["slug"]))
    if lost:
        raise ValueError(f"pinned fragrances missing from the catalogue: {lost[:5]}")
    for column in ("winter", "spring", "summer", "autumn"):
        if (catalogue[column] < 0).any():
            raise ValueError(f"negative votes in {column}")
    if (catalogue[["winter", "spring", "summer", "autumn"]].sum(axis=1) == 0).any():
        raise ValueError("a fragrance has zero season votes")
    if (catalogue[["day", "night"]].sum(axis=1) == 0).any():
        raise ValueError("a fragrance has zero day/night votes")


def build_catalogue(raw: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    top = raw.sort_values(["vote_count", "id"], ascending=[False, True])
    top = top.head(cfg.scoring["catalogue_size"])
    has_data = top["accords"].notna() | top[list(LAYER_COLUMNS)].notna().any(axis=1)
    top = top[has_data].copy()

    out = pd.DataFrame(index=top.index)
    out["slug"] = assign_slugs(top)
    out["name"] = top["name"]
    out["brand"] = top["brand"]
    out["gender"] = top["gender"]
    out["release_year"] = top["year"].astype("Int64")
    out["image_url"] = top["id"].map(lambda i: IMAGE_URL.format(id=i))
    out["community_rating"] = top["rating_avg"]
    out["rating_votes"] = top["vote_count"].astype(int)
    out["accords"] = top["accords"].map(lambda c: json.dumps(split_pairs(c)))
    out["notes"] = top.apply(lambda r: json.dumps(notes_for_row(r, cfg.note_aliases)), axis=1)
    longevity = top[[f"longevity_b{i}" for i in range(1, 6)]]
    sillage = top[[f"sillage_b{i}" for i in range(1, 5)]]
    out["longevity_votes"] = longevity.apply(lambda r: json.dumps([int(v) for v in r]), axis=1)
    out["sillage_votes"] = sillage.apply(lambda r: json.dumps([int(v) for v in r]), axis=1)
    out["strength_votes"] = longevity.sum(axis=1).astype(int) + sillage.sum(axis=1).astype(int)
    for column in ("winter", "spring", "summer", "autumn", "day", "night"):
        out[column] = top[column].astype(int)
    return out.reset_index(drop=True)


def main() -> None:
    cfg = load_config()
    raw = pd.read_csv(RAW_DIR / "perfumes.csv", low_memory=False)
    catalogue = build_catalogue(raw, cfg)
    check_catalogue(catalogue, cfg)
    CATALOGUE_PATH.parent.mkdir(exist_ok=True)
    catalogue.to_parquet(CATALOGUE_PATH, index=False)
    print(f"ingest: wrote {len(catalogue)} fragrances to {CATALOGUE_PATH}")


if __name__ == "__main__":
    main()
