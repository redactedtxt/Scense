import pandas as pd

from ingest import apply_aliases, assign_slugs, build_slug, split_pairs


def test_slug_example_from_spec():
    assert build_slug("Davidoff", "Cool Water", 1988) == "davidoff-cool-water-1988"


def test_slug_leaves_out_a_missing_year():
    assert build_slug("Azzaro", "The Most Wanted", float("nan")) == "azzaro-the-most-wanted"
    assert build_slug("Azzaro", "The Most Wanted", None) == "azzaro-the-most-wanted"


def test_slug_strips_accents_and_collapses_punctuation():
    assert build_slug("Hermès", "Terre d'Hermès", 2006) == "hermes-terre-d-hermes-2006"
    assert "--" not in build_slug("Yves Saint Laurent", "Y -- Eau  de Parfum!", 2017)


def test_collision_appends_dataset_id_to_every_colliding_row():
    df = pd.DataFrame(
        {
            "id": [507, 508, 9],
            "brand": ["Davidoff", "Davidoff", "Creed"],
            "name": ["Cool Water", "Cool Water", "Aventus"],
            "year": [1988.0, 1988.0, 2010.0],
        }
    )
    assert list(assign_slugs(df)) == [
        "davidoff-cool-water-1988-507",
        "davidoff-cool-water-1988-508",
        "creed-aventus-2010",
    ]


def test_split_pairs_handles_colons_and_empty_cells():
    assert split_pairs("a:100|b c:47") == [("a", 100.0), ("b c", 47.0)]
    assert split_pairs(float("nan")) == []


def test_alias_merge_keeps_highest_weight_once():
    aliases = {"Vanille": "Vanilla", "Bourbon Vanilla": "Vanilla"}
    pairs = [("Vanille", 30.0), ("Bourbon Vanilla", 55.0), ("Musk", 10.0)]
    assert apply_aliases(pairs, aliases) == [("Vanilla", 55.0), ("Musk", 10.0)]
