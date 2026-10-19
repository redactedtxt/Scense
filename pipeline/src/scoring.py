"""Step 4: ring distance, the affinity matrix, and goal-aware pair scoring.

Pure functions only (no files, no database) so they can be unit tested.
Every constant arrives through `GoalRules` / the affinity tables from scoring.yaml.
"""

from dataclasses import dataclass

import numpy as np

ENHANCE = "enhance"
SOFTEN = "soften"
GOALS = (ENHANCE, SOFTEN)


@dataclass(frozen=True)
class GoalRules:
    facet_weight: float
    soften_gap: int
    buried_penalty: float

    @classmethod
    def from_scoring(cls, scoring: dict) -> "GoalRules":
        return cls(
            facet_weight=scoring["enhance"]["facet_weight"],
            soften_gap=scoring["soften"]["strength_gap"],
            buried_penalty=scoring["soften"]["buried_penalty"],
        )


def ring_distance(i: int, j: int, size: int = 14) -> int:
    """Shortest way round the ring between families i and j."""
    gap = abs(i - j)
    return min(gap, size - gap)


def build_matrix(affinity: list[float], size: int = 14) -> np.ndarray:
    """M[i][j] = affinity at ring distance d(i, j). Built once per goal."""
    return np.array(
        [[affinity[ring_distance(i, j, size)] for j in range(size)] for i in range(size)]
    )


def build_matrices(scoring: dict, size: int = 14) -> dict[str, np.ndarray]:
    return {goal: build_matrix(scoring["affinity"][goal], size) for goal in GOALS}


def base_score(p_a: np.ndarray, p_b: np.ndarray, matrix: np.ndarray) -> float:
    """base(A, B) = pA . M . pB"""
    return float(p_a @ matrix @ p_b)


def enhance_kernel(matrix: np.ndarray, n_facets: int, facet_weight: float) -> np.ndarray:
    """20 x 20 kernel for fragrance Enhance: families through M, facets matched one-to-one.

    Block-diagonal, so a facet only ever matches the same facet, scaled by facet_weight.
    """
    size = len(matrix)
    kernel = np.zeros((size + n_facets, size + n_facets))
    kernel[:size, :size] = matrix
    kernel[size:, size:] = facet_weight * np.eye(n_facets)
    return kernel


def similarity_score(x_a: np.ndarray, x_b: np.ndarray, kernel: np.ndarray) -> float:
    """Enhance score: xA.K.xB divided by sqrt(self(A) x self(B)), like a cosine.

    Enhance means "more of what you have", so a fragrance and its near-clones should
    score highest. With a positive definite kernel, a fragrance always scores exactly
    1 with itself and below 1 with anything different.
    """
    own = base_score(x_a, x_a, kernel) * base_score(x_b, x_b, kernel)
    return base_score(x_a, x_b, kernel) / own**0.5


def pair_score(
    a: dict, b: dict, goal: str, matrix: np.ndarray, rules: GoalRules, with_facets: bool = True
) -> float | None:
    """Score partner `b` for base `a`. Returns None when the goal rules drop the partner.

    `a` and `b` are dicts with `profile`, `facets`, `harshness` and `strength`.
    Fragrances use `with_facets=True`; notes score Enhance on families only.
    """
    if goal == ENHANCE:
        # No strength penalty: a stronger near-clone amplifies the base, which is the goal.
        if not with_facets:
            return similarity_score(a["profile"], b["profile"], matrix)
        kernel = enhance_kernel(matrix, len(a["facets"]), rules.facet_weight)
        x_a = np.concatenate([a["profile"], a["facets"]])
        x_b = np.concatenate([b["profile"], b["facets"]])
        return similarity_score(x_a, x_b, kernel)
    score = base_score(a["profile"], b["profile"], matrix)
    # Soften only helps if the partner is gentler than the base.
    if b["harshness"] >= a["harshness"]:
        return None
    score *= 1 + a["harshness"] - b["harshness"]
    # A much weaker partner is buried by the base.
    if b["strength"] < a["strength"] - rules.soften_gap:
        score *= rules.buried_penalty
    return score


def _enhance_matrix(profiles, facets, matrix, rules) -> np.ndarray:
    kernel = enhance_kernel(matrix, facets.shape[1], rules.facet_weight)
    x = np.hstack([profiles, facets])
    raw = x @ kernel @ x.T
    own = np.diag(raw)
    return raw / np.sqrt(np.outer(own, own))


def _soften_matrix(profiles, harsh, strength, matrix, rules) -> np.ndarray:
    scores = profiles @ matrix @ profiles.T
    harsh_gap = harsh[:, None] - harsh[None, :]  # base harshness - partner harshness
    gap = strength[None, :] - strength[:, None]  # partner strength - base strength
    scores = scores * (1 + harsh_gap)
    scores = np.where(gap < -rules.soften_gap, scores * rules.buried_penalty, scores)
    return np.where(harsh_gap > 0, scores, np.nan)


def score_matrix(
    profiles: np.ndarray,
    facets: np.ndarray,
    harsh: np.ndarray,
    strength: np.ndarray,
    goal: str,
    matrix: np.ndarray,
    rules: GoalRules,
) -> np.ndarray:
    """Every (base row, partner column) fragrance score at once. NaN marks a dropped pair.

    Same maths as `pair_score`, vectorised so 1,000 x 1,000 pairs take seconds.
    The diagonal (a fragrance paired with itself) is NaN: it is never a result.
    """
    if goal == ENHANCE:
        scores = _enhance_matrix(profiles, facets, matrix, rules)
    else:
        scores = _soften_matrix(profiles, harsh, strength, matrix, rules)
    np.fill_diagonal(scores, np.nan)
    return scores


def normalise_row(scores: np.ndarray) -> np.ndarray:
    """Scale one base's scores to 0..100 by dividing by its best partner."""
    best = np.nanmax(scores)
    return scores / best * 100 if best > 0 else scores


def rank_row(scores: np.ndarray) -> dict[int, int]:
    """Map partner index -> rank (1 = best). NaN partners are not ranked.

    Ties break by partner index so reruns give identical ranks.
    """
    valid = np.flatnonzero(~np.isnan(scores))
    order = sorted(valid, key=lambda j: (-scores[j], j))
    return {int(j): rank for rank, j in enumerate(order, start=1)}
