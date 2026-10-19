import json
import re
import unicodedata

import pandas as pd
import pytest

from pipeline_config import CONFIG_DIR, parse_mapping_csv, read_alias_pairs

# Canonical names that are deliberately not in note_map.csv: they fell outside the
# 150 most frequent notes, so note pairing ignores them (SPEC 3.3).
DELIBERATELY_UNMAPPED = {"Pine Needles", "Tiare Flower"}


def test_mapping_files_load_and_validate(cfg):
    # load_config raises on bad weights or unknown names, so loading is already a check.
    assert len(cfg.family_names) == 14 and len(cfg.facet_names) == 6
    assert len(cfg.note_map) == 150
    for mapping in [*cfg.accord_map.values(), *cfg.note_map.values()]:
        assert mapping.weights.sum() == pytest.approx(1.0, abs=1e-6)


def _write(tmp_path, family_weights, facets=""):
    path = tmp_path / "m.csv"
    row = {"note": "X", "family_weights": family_weights, "facets": facets}
    pd.DataFrame([row]).to_csv(path, index=False)
    return path


def _parse(cfg, path):
    return parse_mapping_csv(path, "note", cfg.family_names, cfg.facet_names, 1e-6)


def test_weights_must_sum_to_one(cfg, tmp_path):
    with pytest.raises(ValueError, match="sum"):
        _parse(cfg, _write(tmp_path, "Citrus:0.5;Water:0.4"))


def test_unknown_family_is_rejected(cfg, tmp_path):
    with pytest.raises(ValueError, match="unknown family"):
        _parse(cfg, _write(tmp_path, "Citris:1.0"))


def test_unknown_facet_is_rejected(cfg, tmp_path):
    with pytest.raises(ValueError, match="unknown facet"):
        _parse(cfg, _write(tmp_path, "Citrus:1.0", "minty"))


def test_check_column_is_ignored(cfg, tmp_path):
    path = tmp_path / "m.csv"
    path.write_text('note,family_weights,facets,check\nX,"Citrus:1.0","",# CHECK me\n')
    assert "X" in _parse(cfg, path)


def test_alias_targets_exist_in_note_map(cfg):
    canonical = set(pd.read_csv(CONFIG_DIR / "note_aliases.csv")["canonical"])
    assert canonical - set(cfg.note_map) <= DELIBERATELY_UNMAPPED


def test_every_catalogue_accord_is_mapped(catalogue, cfg):
    seen = {a for accords in catalogue["accords"] for a, _ in json.loads(accords)}
    assert seen <= set(cfg.accord_map)


# --- search aliases (DECISIONS B23) -------------------------------------------------

# Brands in brand_aliases.csv that the current top 300 does not contain. The alias is
# kept for when the catalogue grows; load.py prints a note for it.
DELIBERATELY_ABSENT_BRANDS = {"Comme des Garçons"}


def _words(text: str) -> list[str]:
    """Lowercase words with accents folded, as the search vector does with unaccent."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.findall(r"\w+", plain.casefold())


def _contains_phrase(name: str, phrase: str) -> bool:
    """True when the phrase's words appear in the name's words, side by side and in order."""
    words, wanted = _words(name), _words(phrase)
    return any(words[i : i + len(wanted)] == wanted for i in range(len(words) - len(wanted) + 1))


def test_alias_files_hold_the_requested_aliases(cfg):
    brands = {(a.casefold(), b) for a, b in cfg.brand_aliases}
    assert ("ysl", "Yves Saint Laurent") in brands
    assert ("jpg", "Jean Paul Gaultier") in brands
    assert ("d&g", "Dolce&Gabbana") in brands
    assert ("cdg", "Comme des Garçons") in brands
    assert ("mfk", "Maison Francis Kurkdjian") in brands
    assert ("pdm", "Parfums de Marly") in brands
    assert ("tf", "Tom Ford") in brands
    names = {(a.casefold(), n) for a, n in cfg.name_aliases}
    assert ("myself", "MYSLF") in names
    shorthand = [
        ("bdc", "Bleu de Chanel"),
        ("adg", "Acqua di Giò"),
        ("cdnim", "Club de Nuit Intense Man"),
        ("tv", "Tobacco Vanille"),
        ("lmw", "Le Male"),
    ]
    for pair in shorthand:
        assert pair in names
    assert ("margiela", "Maison Martin Margiela") in brands


def test_alias_files_ignore_the_check_column_and_reject_bad_rows(tmp_path):
    path = tmp_path / "a.csv"
    path.write_text("alias,brand,check\nYSL,Yves Saint Laurent,# CHECK me\nNA,Some Brand,\n")
    assert read_alias_pairs(path, "alias", "brand") == [
        ("YSL", "Yves Saint Laurent"),
        ("NA", "Some Brand"),
    ]

    path.write_text("alias,brand,check\nYSL,Yves Saint Laurent,\nysl,yves saint laurent,\n")
    with pytest.raises(ValueError, match="duplicate"):
        read_alias_pairs(path, "alias", "brand")

    path.write_text("alias,brand,check\nYSL,,\n")
    with pytest.raises(ValueError, match="needs an alias"):
        read_alias_pairs(path, "alias", "brand")


def test_brand_aliases_point_at_catalogue_brands(catalogue, cfg):
    brands = set(catalogue["brand"])
    targets = {brand for _, brand in cfg.brand_aliases}
    assert targets - brands <= DELIBERATELY_ABSENT_BRANDS


def test_name_aliases_point_at_catalogue_names(catalogue, cfg):
    for alias, phrase in cfg.name_aliases:
        assert any(_contains_phrase(n, phrase) for n in catalogue["name"]), f"{alias} -> {phrase}"


def test_the_requested_aliases_apply_to_real_bottles(catalogue, cfg):
    ysl = [
        (b, n)
        for b, n in zip(catalogue["brand"], catalogue["name"], strict=True)
        if b == "Yves Saint Laurent"
    ]
    assert ysl, "the catalogue should hold YSL bottles"
    assert any(_contains_phrase(n, "MYSLF") for _, n in ysl), (
        "myself -> MYSLF should land on a YSL bottle"
    )
    assert "Jean Paul Gaultier" in set(catalogue["brand"])
