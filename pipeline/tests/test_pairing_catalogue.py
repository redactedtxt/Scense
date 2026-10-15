"""SPEC 3.6 sanity tests that run on the real catalogue."""

from precompute import top_partners
from profiles import dominant_family
from scoring import GoalRules, build_matrices, pair_score, ring_distance

SWEET_OR_POWDERY = 0.2
AMBER_FAMILIES = {"Amber", "Soft Amber", "Floral Amber"}
CDNIM_SLUG = "armaf-club-de-nuit-intense-man-2015"


def _item(fragrances, i):
    r = fragrances.loc[i]
    return {
        "profile": r["profile"],
        "facets": r["facets"],
        "harshness": r["harshness"],
        "strength": r["strength"],
    }


def test_enhance_with_itself_beats_far_families(fragrances, cfg):
    matrix = build_matrices(cfg.scoring)["enhance"]
    rules = GoalRules.from_scoring(cfg.scoring)
    dominant = [dominant_family(p) for p in fragrances["profile"]]
    failures = []
    for a in fragrances.index:
        base = _item(fragrances, a)
        own = pair_score(base, base, "enhance", matrix, rules)
        for b in fragrances.index:
            if b == a or ring_distance(dominant[a], dominant[b]) < 4:
                continue
            other = pair_score(base, _item(fragrances, b), "enhance", matrix, rules)
            if other >= own:
                failures.append((fragrances.loc[a, "name"], fragrances.loc[b, "name"]))
    assert not failures, failures[:10]


def test_soften_never_returns_equal_or_harsher_partner(fragrances, pairs):
    soften = pairs[pairs["goal"] == "soften"]
    harsh = fragrances["harshness"].to_numpy()
    assert (harsh[soften["partner"]] < harsh[soften["base"]]).all()


def test_pairs_never_include_the_base_itself(pairs):
    assert (pairs["base"] != pairs["partner"]).all()


def test_ranks_are_consecutive_per_base_and_goal(pairs):
    for _, group in pairs.groupby(["base", "goal"]):
        assert sorted(group["rank"]) == list(range(1, len(group) + 1))


def test_scores_are_between_0_and_100(pairs):
    assert pairs["score"].between(0, 100).all()


def _report(cfg, top):
    sweet, powdery = cfg.facet_names.index("sweet"), cfg.facet_names.index("powdery")
    lines = []
    for _, r in top.iterrows():
        family = cfg.family_names[dominant_family(r["profile"])]
        lines.append(
            f"{r['rank']:>2} {r['score']:5.1f} {r['brand']} {r['name']} [{family}] "
            f"sweet={r['facets'][sweet]:.2f} powdery={r['facets'][powdery]:.2f}"
        )
    return "\n".join(lines)


def test_club_de_nuit_intense_man_soften_top_10(fragrances, pairs, cfg):
    base = int(fragrances.index[fragrances["slug"] == CDNIM_SLUG][0])
    top = top_partners(pairs, fragrances, base, "soften", 10)
    sweet, powdery = cfg.facet_names.index("sweet"), cfg.facet_names.index("powdery")

    def qualifies(r):
        family = cfg.family_names[dominant_family(r["profile"])]
        return (
            family in AMBER_FAMILIES
            or r["facets"][sweet] > SWEET_OR_POWDERY
            or r["facets"][powdery] > SWEET_OR_POWDERY
        )

    hits = sum(qualifies(r) for _, r in top.iterrows())
    # SPEC 3.6: if this fails, print the top 10 and stop; Tejas tunes.
    assert hits >= 7, f"only {hits}/10 qualify:\n{_report(cfg, top)}"
