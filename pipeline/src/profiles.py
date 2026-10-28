"""Step 3: build each fragrance's (and each note's) profile.

A profile is: p (14 family shares summing to 1), facets (6 values, 0..1),
harshness (0..1), strength (1..4 for fragrances), and season / day-night shares.
"""

import json

import numpy as np
import pandas as pd

from pipeline_config import Config, Mapping

SEASONS = ["winter", "spring", "summer", "autumn"]
DAY_NIGHT = ["day", "night"]

# Fragrantica's 120 px note icon (DECISIONS B42), hotlinked like the bottle photos (B19).
NOTE_IMAGE_URL = "https://fimgs.net/mdimg/sastojci/t.{id}.jpg"


def facet_vector(facets: frozenset[str], facet_names: list[str]) -> np.ndarray:
    """1.0 for each facet a mapping carries, 0.0 for the rest."""
    return np.array([1.0 if name in facets else 0.0 for name in facet_names])


def profile_from_accords(accords: list[tuple[str, float]], cfg: Config) -> np.ndarray:
    """Add strength x weight per family, then normalise to sum to 1."""
    p = np.zeros(len(cfg.family_names))
    for accord, strength in accords:
        p += strength * cfg.accord_map[accord].weights
    return p / p.sum()


def facets_from_accords(accords: list[tuple[str, float]], cfg: Config) -> np.ndarray:
    """Share of total accord strength carried by accords tagged with each facet."""
    total = sum(strength for _, strength in accords)
    out = np.zeros(len(cfg.facet_names))
    for accord, strength in accords:
        out += strength * facet_vector(cfg.accord_map[accord].facets, cfg.facet_names)
    return out / total


def profile_from_notes(notes: list[str], cfg: Config) -> tuple[np.ndarray, np.ndarray]:
    """Fallback for a fragrance with no accords: every mapped note counts equally.

    Notes outside note_map.csv are ignored, as they are for note pairing.
    """
    mapped = [cfg.note_map[n] for n in notes if n in cfg.note_map]
    if not mapped:
        raise ValueError("fragrance has no accords and no mapped notes")
    p = np.mean([m.weights for m in mapped], axis=0)
    facets = np.mean([facet_vector(m.facets, cfg.facet_names) for m in mapped], axis=0)
    return p, facets


def harshness(p: np.ndarray, facets: np.ndarray, cfg: Config) -> float:
    """Family harshness blended by profile, nudged by facets, clamped to 0..1."""
    raw = float(p @ cfg.family_harshness + facets @ cfg.facet_nudges)
    return min(1.0, max(0.0, raw))


def weighted_vote_mean(buckets: list[int]) -> float:
    """Mean vote position scaled so the weakest bucket is 0 and the strongest is 1."""
    positions = np.linspace(0.0, 1.0, len(buckets))
    return float(np.dot(positions, buckets) / sum(buckets))


def strength_from_votes(longevity: list[int], sillage: list[int], cutoffs: list[float]) -> int:
    """Average the longevity and sillage scores, then bin with the cutoffs from scoring.yaml."""
    score = (weighted_vote_mean(longevity) + weighted_vote_mean(sillage)) / 2
    for level, cutoff in enumerate(cutoffs, start=1):
        if score < cutoff:
            return level
    return len(cutoffs) + 1


def vote_shares(row: pd.Series, columns: list[str]) -> dict[str, float]:
    total = sum(row[c] for c in columns)
    return {c: float(row[c] / total) for c in columns}


def build_fragrance_profile(row: pd.Series, cfg: Config) -> dict:
    accords = [(a, s) for a, s in json.loads(row["accords"])]
    if accords:
        p, facets = profile_from_accords(accords, cfg), facets_from_accords(accords, cfg)
    else:
        notes = [n["note"] for n in json.loads(row["notes"])]
        p, facets = profile_from_notes(notes, cfg)
    cutoffs = cfg.scoring["strength_cutoffs"]
    return {
        "profile": p,
        "facets": facets,
        "harshness": harshness(p, facets, cfg),
        "strength": strength_from_votes(
            json.loads(row["longevity_votes"]), json.loads(row["sillage_votes"]), cutoffs
        ),
        "seasons": vote_shares(row, SEASONS),
        "daynight": vote_shares(row, DAY_NIGHT),
    }


def build_fragrance_profiles(catalogue: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """Catalogue rows plus profile, facets, harshness, strength, seasons and daynight."""
    built = pd.DataFrame([build_fragrance_profile(r, cfg) for _, r in catalogue.iterrows()])
    return pd.concat([catalogue.reset_index(drop=True), built], axis=1)


def build_note_profile(mapping: Mapping, cfg: Config) -> dict:
    facets = facet_vector(mapping.facets, cfg.facet_names)
    return {
        "profile": mapping.weights,
        "facets": facets,
        "harshness": harshness(mapping.weights, facets, cfg),
    }


def note_image_urls(catalogue: pd.DataFrame) -> dict[str, str]:
    """Note name -> its Fragrantica icon URL, for notes the dataset has a picture of."""
    urls: dict[str, str] = {}
    for notes in catalogue["notes"]:
        for n in json.loads(notes):
            if n.get("image_id") is not None:
                urls.setdefault(n["note"], NOTE_IMAGE_URL.format(id=n["image_id"]))
    return urls


def build_note_profiles(cfg: Config, catalogue: pd.DataFrame) -> pd.DataFrame:
    """One row per note. Mapped notes get a profile; every other note in the catalogue is
    kept with `mapped` False and no profile, so the fragrance page can still show it.
    Every note carries its icon URL, or None when the dataset has no picture."""
    rows = [
        {"name": n, "mapped": True, **build_note_profile(m, cfg)} for n, m in cfg.note_map.items()
    ]
    seen = {n["note"] for notes in catalogue["notes"] for n in json.loads(notes)}
    rows += [{"name": n, "mapped": False} for n in sorted(seen - set(cfg.note_map))]
    urls = note_image_urls(catalogue)
    for row in rows:
        row["image_url"] = urls.get(row["name"])
    return pd.DataFrame(rows)


def dominant_family(profile: np.ndarray) -> int:
    """Index of the largest family share; a tie goes to the lower ring position."""
    return int(np.argmax(profile))
