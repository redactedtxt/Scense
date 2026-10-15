import json

import pandas as pd
import pytest

from pipeline_config import CONFIG_DIR, parse_mapping_csv

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
