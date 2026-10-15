"""Step 5: score every fragrance pair for both goals and rank each base's list."""

import numpy as np
import pandas as pd

from pipeline_config import Config
from scoring import GOALS, GoalRules, build_matrices, normalise_row, rank_row, score_matrix


def precompute_pairs(fragrances: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """One row per (base, goal, partner): positional indexes, 0-100 score, rank.

    Indexes are positions in `fragrances`; load.py swaps them for database ids.
    """
    profiles = np.vstack(fragrances["profile"].to_list())
    facets = np.vstack(fragrances["facets"].to_list())
    harsh = fragrances["harshness"].to_numpy()
    strength = fragrances["strength"].to_numpy()
    matrices = build_matrices(cfg.scoring, len(cfg.family_names))
    rules = GoalRules.from_scoring(cfg.scoring)

    rows = []
    for goal in GOALS:
        scores = score_matrix(profiles, facets, harsh, strength, goal, matrices[goal], rules)
        for base in range(len(fragrances)):
            rows.extend(_rows_for_base(base, goal, scores[base]))
    return pd.DataFrame(rows, columns=["base", "partner", "goal", "score", "rank"])


def _rows_for_base(base: int, goal: str, scores: np.ndarray) -> list[tuple]:
    if np.isnan(scores).all():
        return []  # nothing gentler than this base (Soften) -> empty list
    ranks = rank_row(scores)
    shown = normalise_row(scores)
    return [(base, partner, goal, float(shown[partner]), rank) for partner, rank in ranks.items()]


def top_partners(
    pairs: pd.DataFrame, fragrances: pd.DataFrame, base: int, goal: str, n: int = 10
) -> pd.DataFrame:
    """The best `n` partners for one base, joined with partner details for printing."""
    best = pairs[(pairs["base"] == base) & (pairs["goal"] == goal)].nsmallest(n, "rank")
    return best.merge(fragrances, left_on="partner", right_index=True)
