"""Fragrance ids never change once a guest can have saved them (DECISIONS B28).

A guest's Own and Want lists are stored in their browser as fragrance ids, so a new
catalogue must keep every existing fragrance's id and give new fragrances new ones.
"""

import uuid
from pathlib import Path

import pandas as pd
import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

import load
from pipeline_config import load_config, read_pinned_ids
from profiles import build_note_profiles

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"
PAIR_COLUMNS = ["base", "partner", "goal", "score", "rank"]


def test_pinned_ids_file_is_valid(cfg):
    assert len(cfg.pinned_ids) == 300
    assert sorted(cfg.pinned_ids.values()) == list(range(1, 301))


def test_pinned_ids_reject_duplicates(tmp_path):
    path = tmp_path / "p.csv"
    path.write_text("id,slug\n1,a\n1,b\n")
    with pytest.raises(ValueError, match="duplicate"):
        read_pinned_ids(path)
    path.write_text("id,slug\n1,a\n2,a\n")
    with pytest.raises(ValueError, match="duplicate"):
        read_pinned_ids(path)


def test_every_pinned_fragrance_is_still_in_the_catalogue(catalogue, cfg):
    assert set(cfg.pinned_ids) <= set(catalogue["slug"])


def test_load_refuses_a_catalogue_that_drops_a_pinned_fragrance(fragrances, cfg):
    smaller = fragrances[fragrances["slug"] != next(iter(cfg.pinned_ids))]
    with pytest.raises(ValueError, match="pinned fragrances missing"):
        load._check_pinned_ids(smaller, cfg)


@pytest.fixture
def scratch_database(monkeypatch):
    """A throwaway empty database with the real migrations applied; dropped afterwards."""
    base = conninfo_to_dict(load.database_url())
    name = f"scense_ids_{uuid.uuid4().hex[:8]}"
    try:
        admin = psycopg.connect(make_conninfo(**{**base, "dbname": "postgres"}), autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("no Postgres reachable (start docker compose); this test needs CREATE DATABASE")
    admin.execute(f'CREATE DATABASE "{name}"')
    url = make_conninfo(**{**base, "dbname": name})
    try:
        with psycopg.connect(url) as conn:
            for migration in sorted(MIGRATIONS.glob("00[12]_*.sql")):
                conn.execute(migration.read_text(encoding="utf-8").split("-- Down Migration")[0])
        monkeypatch.setenv("DATABASE_URL", url)
        yield url
    finally:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()


def _ids_by_slug(url: str) -> dict[str, int]:
    with psycopg.connect(url) as conn:
        return {slug: i for i, slug in conn.execute("SELECT id, slug FROM fragrances")}


def test_existing_ids_survive_a_rebuild_in_any_order(scratch_database, fragrances, catalogue, cfg):
    """The dangerous case: an empty database loaded with the catalogue in a different order,
    which is what a rebuilt dev database or a disaster recovery would do."""
    notes = build_note_profiles(cfg, catalogue)
    no_pairs = pd.DataFrame(columns=PAIR_COLUMNS)
    reversed_catalogue = fragrances.iloc[::-1].reset_index(drop=True)

    load.load_all(reversed_catalogue, notes, no_pairs, cfg)
    ids = _ids_by_slug(scratch_database)

    assert len(ids) == len(fragrances)
    assert {slug: ids[slug] for slug in cfg.pinned_ids} == cfg.pinned_ids
    new_ids = sorted(i for slug, i in ids.items() if slug not in cfg.pinned_ids)
    assert new_ids[0] > max(cfg.pinned_ids.values())
    assert len(set(new_ids)) == len(new_ids)

    # Loading again (the normal re-run) must not move anything, pinned or new.
    load.load_all(fragrances, notes, no_pairs, cfg)
    assert _ids_by_slug(scratch_database) == ids


def test_loaded_ids_match_the_pinned_ids_in_the_dev_database(cfg):
    """After `pipeline` has run on the dev database, the original 300 still hold their ids."""
    try:
        conn = psycopg.connect(load.database_url())
    except psycopg.OperationalError:
        pytest.skip("no Postgres reachable")
    with conn:
        rows = dict(conn.execute("SELECT slug, id FROM fragrances").fetchall())
    if not rows:
        pytest.skip("dev database is empty")
    assert {slug: rows[slug] for slug in cfg.pinned_ids} == cfg.pinned_ids


def test_load_config_pins_match_the_file():
    assert load_config().pinned_ids == read_pinned_ids(
        Path(__file__).resolve().parents[1] / "config" / "pinned_ids.csv"
    )
