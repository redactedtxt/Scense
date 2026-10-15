import numpy as np
import pytest

from scoring import (
    GoalRules,
    base_score,
    build_matrices,
    enhance_kernel,
    normalise_row,
    pair_score,
    rank_row,
    ring_distance,
    score_matrix,
    similarity_score,
)


def test_ring_distance_examples_from_spec():
    assert ring_distance(13, 0) == 1
    assert ring_distance(0, 7) == 7
    assert ring_distance(3, 10) == 7


def test_ring_distance_is_symmetric_and_bounded():
    for i in range(14):
        for j in range(14):
            assert ring_distance(i, j) == ring_distance(j, i)
            assert 0 <= ring_distance(i, j) <= 7


def test_matrix_reads_the_affinity_table(cfg):
    table = cfg.scoring["affinity"]["enhance"]
    m = build_matrices(cfg.scoring)["enhance"]
    assert m[0, 0] == table[0] and m[0, 13] == table[1] and m[0, 7] == table[7]


def test_base_score_of_one_hot_profiles_is_the_matrix_cell(cfg):
    m = build_matrices(cfg.scoring)["soften"]
    a, b = np.eye(14)[2], np.eye(14)[9]
    assert base_score(a, b, m) == pytest.approx(m[2, 9])


def _item(family, harshness, strength, facets=None):
    facets = np.zeros(6) if facets is None else np.asarray(facets, dtype=float)
    return {
        "profile": np.eye(14)[family],
        "facets": facets,
        "harshness": harshness,
        "strength": strength,
    }


def test_enhance_has_no_strength_penalty(cfg):
    m, rules = build_matrices(cfg.scoring)["enhance"], GoalRules.from_scoring(cfg.scoring)
    base = _item(0, 0.5, 1)
    assert pair_score(base, _item(0, 0.5, 1), "enhance", m, rules) == pytest.approx(1.0)
    assert pair_score(base, _item(0, 0.5, 4), "enhance", m, rules) == pytest.approx(1.0)


def test_enhance_matrix_is_positive_definite(cfg):
    # A positive definite kernel guarantees self-similarity 1 beats every other partner.
    # If a retune of the Enhance table breaks this, the SPEC 3.6 self-score test can fail.
    m = build_matrices(cfg.scoring)["enhance"]
    assert np.linalg.eigvalsh(m).min() > 0
    kernel = enhance_kernel(m, 6, cfg.scoring["enhance"]["facet_weight"])
    assert np.linalg.eigvalsh(kernel).min() > 0


def test_fragrance_enhance_uses_facets_and_notes_do_not(cfg):
    m, rules = build_matrices(cfg.scoring)["enhance"], GoalRules.from_scoring(cfg.scoring)
    smoky, sweet = _item(3, 0.5, 2, [0, 0, 0, 0, 1, 0]), _item(3, 0.5, 2, [1, 0, 0, 0, 0, 0])
    assert pair_score(smoky, sweet, "enhance", m, rules) < 1.0
    assert pair_score(smoky, sweet, "enhance", m, rules, with_facets=False) == pytest.approx(1.0)


def test_soften_drops_equal_or_harsher_partners(cfg):
    m, rules = build_matrices(cfg.scoring)["soften"], GoalRules.from_scoring(cfg.scoring)
    base = _item(0, 0.5, 2)
    assert pair_score(base, _item(5, 0.5, 2), "soften", m, rules) is None
    assert pair_score(base, _item(5, 0.7, 2), "soften", m, rules) is None
    assert pair_score(base, _item(5, 0.3, 2), "soften", m, rules) is not None


def test_soften_scales_by_harshness_gap_and_buried_penalty(cfg):
    m, rules = build_matrices(cfg.scoring)["soften"], GoalRules.from_scoring(cfg.scoring)
    base = _item(0, 0.8, 4)
    plain = pair_score(base, _item(4, 0.3, 3), "soften", m, rules)
    assert plain == pytest.approx(m[0, 4] * (1 + 0.8 - 0.3))
    buried = pair_score(base, _item(4, 0.3, 2), "soften", m, rules)
    assert buried == pytest.approx(plain * cfg.scoring["soften"]["buried_penalty"])


@pytest.mark.parametrize("goal", ["enhance", "soften"])
def test_vectorised_scores_match_the_scalar_function(cfg, goal):
    rng = np.random.default_rng(0)
    profiles, facets = rng.dirichlet(np.ones(14), size=12), rng.uniform(0, 1, (12, 6))
    harsh, strength = rng.uniform(0, 1, 12), rng.integers(1, 5, 12)
    m, rules = build_matrices(cfg.scoring)[goal], GoalRules.from_scoring(cfg.scoring)
    grid = score_matrix(profiles, facets, harsh, strength, goal, m, rules)
    items = [
        {
            "profile": profiles[i],
            "facets": facets[i],
            "harshness": harsh[i],
            "strength": strength[i],
        }
        for i in range(12)
    ]
    for a in range(12):
        for b in range(12):
            expected = None if a == b else pair_score(items[a], items[b], goal, m, rules)
            if expected is None:
                assert np.isnan(grid[a, b])
            else:
                assert grid[a, b] == pytest.approx(expected)


def test_normalise_and_rank_ignore_nan():
    row = np.array([np.nan, 2.0, 4.0, 1.0])
    assert normalise_row(row)[2] == pytest.approx(100.0)
    assert rank_row(row) == {2: 1, 1: 2, 3: 3}


def test_enhance_similarity_is_one_with_itself_and_below_one_for_others(cfg):
    m = build_matrices(cfg.scoring)["enhance"]
    diffuse = np.full(14, 1 / 14)
    concentrated = np.eye(14)[3]
    assert similarity_score(diffuse, diffuse, m) == pytest.approx(1.0)
    assert similarity_score(concentrated, diffuse, m) < 1.0
    assert similarity_score(diffuse, concentrated, m) == pytest.approx(
        similarity_score(concentrated, diffuse, m)
    )
