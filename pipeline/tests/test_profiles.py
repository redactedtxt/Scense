import json

import numpy as np
import pandas as pd
import pytest

from profiles import (
    build_fragrance_profile,
    build_note_profiles,
    dominant_family,
    harshness,
    profile_from_accords,
    profile_from_notes,
    strength_from_votes,
    weighted_vote_mean,
)

CUTOFFS = [0.46, 0.54, 0.62]


def test_weighted_vote_mean_ends_at_zero_and_one():
    assert weighted_vote_mean([5, 0, 0, 0, 0]) == 0
    assert weighted_vote_mean([0, 0, 0, 7]) == 1
    assert weighted_vote_mean([1, 1, 1]) == pytest.approx(0.5)


def test_strength_bins_follow_the_cutoffs():
    assert strength_from_votes([10, 0, 0, 0, 0], [10, 0, 0, 0], CUTOFFS) == 1
    assert strength_from_votes([0, 0, 0, 0, 10], [0, 0, 0, 10], CUTOFFS) == 4
    # longevity 0.5 and sillage 0.5 average 0.5, between c1 (0.46) and c2 (0.54)
    assert strength_from_votes([0, 0, 1, 0, 0], [0, 1, 1, 0], CUTOFFS) == 2


def test_profile_from_accords_sums_to_one(cfg):
    p = profile_from_accords([("citrus", 100), ("woody", 50), ("sweet", 20)], cfg)
    assert p.sum() == pytest.approx(1.0, abs=1e-6)
    assert p[cfg.family_names.index("Citrus")] > 0.5


def test_fallback_profile_from_notes_uses_mapped_notes_only(cfg):
    p, facets = profile_from_notes(["Vanilla", "Not A Real Note"], cfg)
    assert p.sum() == pytest.approx(1.0, abs=1e-6)
    assert facets[cfg.facet_names.index("sweet")] == 1.0


def test_harshness_is_clamped(cfg):
    p = np.eye(14)[cfg.family_names.index("Dry Woods")]
    assert harshness(p, np.ones(6) * 10, cfg) == 1.0
    assert harshness(np.eye(14)[0], np.ones(6) * -10, cfg) == 0.0


def test_dominant_family_tie_goes_to_lower_position():
    assert dominant_family(np.array([0.5, 0.5] + [0] * 12)) == 0


def test_row_without_accords_uses_notes(cfg):
    row = {
        "accords": json.dumps([]),
        "notes": json.dumps([{"note": "Vanilla", "layer": "base", "weight": 50}]),
        "longevity_votes": json.dumps([1, 1, 1, 1, 1]),
        "sillage_votes": json.dumps([1, 1, 1, 1]),
        "winter": 1,
        "spring": 1,
        "summer": 1,
        "autumn": 1,
        "day": 3,
        "night": 1,
    }
    built = build_fragrance_profile(pd.Series(row), cfg)
    assert built["profile"].sum() == pytest.approx(1.0, abs=1e-6)
    assert built["daynight"]["day"] == pytest.approx(0.75)


def test_catalogue_profiles_sum_to_one(fragrances):
    sums = np.array([p.sum() for p in fragrances["profile"]])
    assert np.allclose(sums, 1.0, atol=1e-6)


def test_catalogue_values_are_in_range(fragrances):
    assert fragrances["harshness"].between(0, 1).all()
    assert fragrances["strength"].between(1, 4).all()
    for column in ("seasons", "daynight"):
        assert all(abs(sum(v.values()) - 1) < 1e-6 for v in fragrances[column])


def test_strength_split_matches_the_approved_cutoffs(fragrances):
    # SPEC 3.4: the cutoffs give a 75 / 78 / 72 / 75 split of the top 300.
    assert fragrances["strength"].value_counts().sort_index().tolist() == [75, 78, 72, 75]


def test_every_catalogue_note_is_stored_and_only_mapped_ones_have_profiles(catalogue, cfg):
    notes = build_note_profiles(cfg, catalogue)
    seen = {n["note"] for raw in catalogue["notes"] for n in json.loads(raw)}
    assert seen <= set(notes["name"])
    mapped = notes[notes["mapped"]]
    assert set(mapped["name"]) == set(cfg.note_map)
    assert all(abs(p.sum() - 1) < 1e-6 for p in mapped["profile"])
    assert notes[~notes["mapped"]]["profile"].isna().all()
