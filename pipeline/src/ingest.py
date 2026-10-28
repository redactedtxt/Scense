"""Step 2: turn the raw Kaggle CSV into a clean catalogue (parquet).

Column names come from pipeline/DATASET_NOTES.md (written from inspect_dataset.py).
Usage: python src/ingest.py
"""

import json
import re
import unicodedata
from pathlib import Path

import pandas as pd

from pipeline_config import CATALOGUE_PATH, RAW_DIR, Config, load_config

LAYER_COLUMNS = {
    "notes_top": "top",
    "notes_middle": "heart",
    "notes_base": "base",
    "notes_flat": "flat",
}
IMAGE_URL = "https://fimgs.net/mdimg/perfume/375x500.{id}.jpg"
VALUE_COLUMNS = [f"price_value_b{i}" for i in range(1, 6)]  # 1 overpriced .. 5 great value
# Every JSONL line starts with the perfume's id, so lines outside the catalogue can be
# skipped without parsing their JSON (the file is 550 MB).
JSONL_ID = re.compile(r'^\{"id":(\d+),')


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


def notes_for_row(row: pd.Series, aliases: dict[str, str], images: dict[str, int]) -> list[dict]:
    """All notes of one fragrance as {note, layer, weight, image_id}, aliases applied per
    layer. image_id is None when the dataset has no picture for the note."""
    notes = []
    for column, layer in LAYER_COLUMNS.items():
        for note, weight in apply_aliases(split_pairs(row[column]), aliases):
            notes.append(
                {"note": note, "layer": layer, "weight": weight, "image_id": images.get(note)}
            )
    return notes


def read_note_images(path: Path, dataset_ids: set[int]) -> dict[str, int]:
    """Raw note name -> Fragrantica image id, from the JSONL (the CSV has no images).

    A note has one picture wherever it appears, so the first id seen for a name is kept.
    """
    images: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            match = JSONL_ID.match(line)
            if not match or int(match.group(1)) not in dataset_ids:
                continue
            notes = json.loads(line).get("notes") or {}
            layers = [*(notes.get("tiered") or {}).values(), notes.get("flat") or []]
            for note in (n for layer in layers for n in layer):
                if note.get("image_id") is not None:
                    images.setdefault(note["name"], int(note["image_id"]))
    return images


def canonical_note_images(images: dict[str, int], aliases: dict[str, str]) -> dict[str, int]:
    """Images keyed by canonical note name. A canonical note keeps its own picture; one that
    only appears under a variant spelling ("Vanille") borrows that variant's picture."""
    result = {name: iid for name, iid in images.items() if aliases.get(name, name) == name}
    for name, iid in images.items():
        result.setdefault(aliases.get(name, name), iid)
    return result


def value_votes(top: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """How many value-for-money votes each bottle has, and their mean on the 1..5 scale
    (None when there are none)."""
    counts = top[VALUE_COLUMNS].fillna(0).astype(int)
    total = counts.sum(axis=1)
    weighted = sum(counts[c] * (i + 1) for i, c in enumerate(VALUE_COLUMNS))
    mean = (weighted / total.where(total > 0)).round(4)
    # An object column, so a bottle with no votes keeps None instead of NaN.
    values = [None if pd.isna(v) else float(v) for v in mean]
    return total, pd.Series(values, index=top.index, dtype=object)


def assign_price_tiers(catalogue: pd.DataFrame, cfg: Config) -> pd.Series:
    """The brand's default tier, then any override for the bottle's line or slug. A slug
    override wins over a line override, since it is the more specific rule."""
    tiers = catalogue["brand"].map(cfg.brand_tiers)
    for scope in ("collection", "slug"):
        for o in (o for o in cfg.tier_overrides if o.scope == scope):
            hit = (catalogue["brand"] == o.brand) & (catalogue[scope] == o.value)
            tiers[hit] = o.tier
    return tiers


def unused_tier_overrides(catalogue: pd.DataFrame, cfg: Config) -> list[str]:
    """Overrides that match no bottle. Not an error (the catalogue changes), but worth a note."""
    return [
        f"{o.brand} {o.scope} '{o.value}'"
        for o in cfg.tier_overrides
        if not ((catalogue["brand"] == o.brand) & (catalogue[o.scope] == o.value)).any()
    ]


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
    untiered = sorted(set(catalogue["brand"]) - set(cfg.brand_tiers))
    if untiered:
        raise ValueError(f"brands missing from brand_tiers.csv: {untiered}")
    for column in ("winter", "spring", "summer", "autumn"):
        if (catalogue[column] < 0).any():
            raise ValueError(f"negative votes in {column}")
    if (catalogue[["winter", "spring", "summer", "autumn"]].sum(axis=1) == 0).any():
        raise ValueError("a fragrance has zero season votes")
    if (catalogue[["day", "night"]].sum(axis=1) == 0).any():
        raise ValueError("a fragrance has zero day/night votes")


def select_top(raw: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """The most-voted fragrances that have accords or notes."""
    top = raw.sort_values(["vote_count", "id"], ascending=[False, True])
    top = top.head(cfg.scoring["catalogue_size"])
    has_data = top["accords"].notna() | top[list(LAYER_COLUMNS)].notna().any(axis=1)
    return top[has_data].copy()


def build_catalogue(top: pd.DataFrame, cfg: Config, images: dict[str, int]) -> pd.DataFrame:
    """`images` maps canonical note names to Fragrantica image ids ({} for none)."""
    out = pd.DataFrame(index=top.index)
    out["slug"] = assign_slugs(top)
    out["name"] = top["name"]
    out["brand"] = top["brand"]
    out["collection"] = top["collection"].map(lambda c: c if isinstance(c, str) and c else None)
    out["gender"] = top["gender"]
    out["release_year"] = top["year"].astype("Int64")
    out["image_url"] = top["id"].map(lambda i: IMAGE_URL.format(id=i))
    out["community_rating"] = top["rating_avg"]
    out["rating_votes"] = top["vote_count"].astype(int)
    out["accords"] = top["accords"].map(lambda c: json.dumps(split_pairs(c)))
    out["notes"] = top.apply(
        lambda r: json.dumps(notes_for_row(r, cfg.note_aliases, images)), axis=1
    )
    longevity = top[[f"longevity_b{i}" for i in range(1, 6)]]
    sillage = top[[f"sillage_b{i}" for i in range(1, 5)]]
    out["longevity_votes"] = longevity.apply(lambda r: json.dumps([int(v) for v in r]), axis=1)
    out["sillage_votes"] = sillage.apply(lambda r: json.dumps([int(v) for v in r]), axis=1)
    out["strength_votes"] = longevity.sum(axis=1).astype(int) + sillage.sum(axis=1).astype(int)
    for column in ("winter", "spring", "summer", "autumn", "day", "night"):
        out[column] = top[column].astype(int)
    out["value_votes"], out["value_score"] = value_votes(top)
    out["price_tier"] = assign_price_tiers(out, cfg)
    return out.reset_index(drop=True)


def main() -> None:
    cfg = load_config()
    top = select_top(pd.read_csv(RAW_DIR / "perfumes.csv", low_memory=False), cfg)
    raw_images = read_note_images(RAW_DIR / "perfumes.jsonl", set(top["id"].astype(int)))
    catalogue = build_catalogue(top, cfg, canonical_note_images(raw_images, cfg.note_aliases))
    check_catalogue(catalogue, cfg)
    for override in unused_tier_overrides(catalogue, cfg):
        print(f"note: tier override {override} matches no fragrance in this catalogue")
    CATALOGUE_PATH.parent.mkdir(exist_ok=True)
    catalogue.to_parquet(CATALOGUE_PATH, index=False)
    print(f"ingest: wrote {len(catalogue)} fragrances to {CATALOGUE_PATH}")


if __name__ == "__main__":
    main()
