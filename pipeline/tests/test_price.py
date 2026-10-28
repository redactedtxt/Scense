"""Price tiers, value-for-money votes, and note pictures (DECISIONS B42)."""

import json

import pandas as pd
import pytest

from ingest import (
    assign_price_tiers,
    canonical_note_images,
    read_note_images,
    unused_tier_overrides,
    value_votes,
)
from pipeline_config import TierOverride, read_brand_tiers, read_tier_overrides

# --- the two tier files -------------------------------------------------------------


def test_tier_files_load(cfg):
    assert len(cfg.brand_tiers) >= 180
    assert set(cfg.brand_tiers.values()) == {1, 2, 3, 4}
    assert cfg.brand_tiers["Tom Ford"] == 3
    assert TierOverride("Tom Ford", "collection", "Private Blend", 4) in cfg.tier_overrides


def test_brand_tiers_reject_bad_rows(tmp_path):
    path = tmp_path / "b.csv"
    path.write_text("brand,tier,check\nDior,$$$,# CHECK ignored\n")
    assert read_brand_tiers(path) == {"Dior": 3}
    path.write_text("brand,tier,check\nDior,$$$$$,\n")
    with pytest.raises(ValueError, match="tier"):
        read_brand_tiers(path)
    path.write_text("brand,tier,check\nDior,$$,\nDior,$$$,\n")
    with pytest.raises(ValueError, match="duplicate brand Dior"):
        read_brand_tiers(path)


def test_overrides_reject_bad_rows(tmp_path):
    path = tmp_path / "o.csv"
    header = "brand,scope,value,tier,reason,check\n"
    path.write_text(header + "Dior,collection,X,$$$$,why,\n")
    assert read_tier_overrides(path) == [TierOverride("Dior", "collection", "X", 4)]
    path.write_text(header + "Dior,name,X,$$$$,,\n")
    with pytest.raises(ValueError, match="scope"):
        read_tier_overrides(path)
    path.write_text(header + "Dior,slug,x,$,,\nDior,slug,x,$$,,\n")
    with pytest.raises(ValueError, match="duplicate"):
        read_tier_overrides(path)


# --- assigning tiers ----------------------------------------------------------------


def _bottles():
    return pd.DataFrame(
        {
            "brand": ["Tom Ford", "Tom Ford", "Tom Ford", "Armaf"],
            "collection": ["Noir", "Private Blend", "Private Blend", None],
            "slug": ["tf-noir", "tf-oud-wood", "tf-cheap-blend", "armaf-cdnim"],
        }
    )


def test_tier_comes_from_brand_then_line_then_bottle(cfg):
    overrides = [
        TierOverride("Tom Ford", "slug", "tf-cheap-blend", 2),
        TierOverride("Tom Ford", "collection", "Private Blend", 4),
    ]
    rules = cfg.__class__(**{**cfg.__dict__, "tier_overrides": overrides})
    # A slug rule wins over a line rule whatever order the file lists them in.
    assert list(assign_price_tiers(_bottles(), rules)) == [3, 4, 2, 1]


def test_an_override_for_another_brand_does_not_apply(cfg):
    overrides = [TierOverride("Dior", "collection", "Private Blend", 1)]
    rules = cfg.__class__(**{**cfg.__dict__, "tier_overrides": overrides})
    assert list(assign_price_tiers(_bottles(), rules)) == [3, 3, 3, 1]
    assert unused_tier_overrides(_bottles(), rules) == ["Dior collection 'Private Blend'"]


# --- value votes and note pictures ---------------------------------------------------


def test_value_votes_count_and_mean():
    top = pd.DataFrame(
        {f"price_value_b{i}": [v, 0] for i, v in zip(range(1, 6), [1, 0, 0, 0, 3], strict=True)}
    )
    total, score = value_votes(top)
    assert list(total) == [4, 0]
    assert score[0] == pytest.approx((1 * 1 + 5 * 3) / 4)
    assert score[1] is None


def test_note_images_prefer_the_canonical_spelling():
    images = {"Vanille": 9, "Vanilla": 74, "Bourbon Vanilla": 8, "Orris": 31}
    aliases = {"Vanille": "Vanilla", "Bourbon Vanilla": "Vanilla", "Orris": "Iris"}
    assert canonical_note_images(images, aliases) == {"Vanilla": 74, "Iris": 31}


def test_note_images_read_only_catalogue_lines(tmp_path):
    def line(pid, name, image):
        notes = {"tiered": {"top": [{"name": name, "image_id": image}]}, "flat": []}
        return json.dumps({"id": pid, "notes": notes}, separators=(",", ":"))

    path = tmp_path / "p.jsonl"
    path.write_text("\n".join([line(1, "Rose", 5), line(2, "Oud", 6), line(3, "Musk", None)]))
    assert read_note_images(path, {1, 3}) == {"Rose": 5}


# --- the real catalogue (skips without the parquet) ---------------------------------


def test_every_catalogue_bottle_has_a_tier_and_value_votes(catalogue, cfg):
    assert set(catalogue["brand"]) <= set(cfg.brand_tiers)
    assert catalogue["price_tier"].between(1, 4).all()
    assert (catalogue["value_votes"] >= cfg.scoring["price"]["min_value_votes"]).all()


def test_every_override_matches_a_catalogue_bottle(catalogue, cfg):
    assert unused_tier_overrides(catalogue, cfg) == []


def test_tiers_land_on_the_bottles_the_review_named(catalogue):
    tier = dict(zip(catalogue["slug"], catalogue["price_tier"], strict=True))
    assert tier["tom-ford-oud-wood-2007"] == 4  # Private Blend
    assert tier["tom-ford-noir-2012"] == 3  # Tom Ford's default
    assert tier["dior-gris-dior-2017"] == 4  # Dior Privée
    assert tier["dior-sauvage-2015"] == 3  # Dior's default
    assert tier["armaf-club-de-nuit-intense-man-2015"] == 1


def test_mapped_notes_have_pictures(catalogue):
    notes = [n for cell in catalogue["notes"] for n in json.loads(cell)]
    assert sum(n["image_id"] is not None for n in notes) / len(notes) > 0.95
