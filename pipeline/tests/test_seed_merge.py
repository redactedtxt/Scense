"""A catalogue reseed must never delete what users made (DECISIONS B32).

scripts/seed-prod.ps1 ships the catalogue to production in a `seed` schema
(scripts/seed/stage.sql) and merges it in with scripts/seed/merge.sql. These tests run
both SQL files on a scratch database that holds a small catalogue and a user with rows in
every pass 2 table, then check the user's rows survived and the catalogue changed.

The tests use a tiny hand-made catalogue, not the Kaggle data, so they need only a
reachable Postgres (they skip without one, as in CI).
"""

import json
from pathlib import Path

import psycopg
import pytest

SEED_SQL = Path(__file__).resolve().parents[2] / "scripts" / "seed"
FAMILIES = ["Soft Amber", "Amber", "Woody Amber", "Woods", "Mossy Woods", "Dry Woods",
            "Aromatic Fougère", "Citrus", "Water", "Green", "Fruity", "Floral",
            "Soft Floral", "Floral Amber"]  # fmt: skip
USER_TABLES = ["users", "collection", "taste_profiles", "reviews", "pair_ratings"]


def _run(conn, filename: str) -> None:
    conn.execute((SEED_SQL / filename).read_text(encoding="utf-8"))


def _fragrance(conn, fid: int, slug: str, name: str) -> None:
    profile = [1.0 if i == fid % 14 else 0.0 for i in range(14)]
    conn.execute(
        """INSERT INTO fragrances (id, slug, name, brand, profile, facets, harshness, strength,
             seasons, daynight, search_vector)
           VALUES (%s, %s, %s, 'Brand', %s, '{}', 0.5, 2, '{}', '{}', to_tsvector('simple', %s))""",
        (fid, slug, name, profile, name),
    )


def _catalogue(conn) -> None:
    """Three fragrances with notes, accords, pair scores, and aliases."""
    for i, name in enumerate(FAMILIES):
        conn.execute("INSERT INTO families (id, name, harshness) VALUES (%s, %s, 0.3)", (i, name))
    for fid in (1, 2, 3):
        _fragrance(conn, fid, f"brand-f{fid}", f"F{fid}")
    conn.execute(
        """INSERT INTO notes (id, name, mapped, profile, facets, harshness)
           VALUES (1, 'Vanilla', true, %s, %s, 0.2), (2, 'Oud', false, NULL, NULL, NULL)""",
        ([0.0] * 14, json.dumps({})),
    )
    conn.execute("INSERT INTO fragrance_notes VALUES (1, 1, 'base'), (2, 2, 'base')")
    conn.execute("INSERT INTO fragrance_accords VALUES (1, 'woody', 100), (2, 'sweet', 80)")
    conn.execute(
        """INSERT INTO pair_scores VALUES (1, 2, 'enhance', 0.9, 1), (1, 3, 'enhance', 0.5, 2),
                                          (2, 1, 'enhance', 0.9, 1)"""
    )
    conn.execute("INSERT INTO brand_aliases VALUES ('BR', 'Brand')")
    conn.execute("INSERT INTO name_aliases VALUES ('effone', 'F1')")
    conn.execute("SELECT setval('fragrances_id_seq', 3)")


def _user_data(conn) -> None:
    """One user with a row in every table that points at a user or a fragrance."""
    conn.execute(
        """INSERT INTO users (id, email, display_name, password_hash)
           VALUES (1, 'ana@example.com', 'Ana', 'x')"""
    )
    conn.execute(
        """INSERT INTO collection (user_id, fragrance_id, status)
           VALUES (1, 1, 'own'), (1, 2, 'want')"""
    )
    conn.execute("INSERT INTO taste_profiles (user_id, families, facets) VALUES (1, '{}', '{}')")
    conn.execute(
        "INSERT INTO reviews (user_id, fragrance_id, stars, body) VALUES (1, 1, 5, 'Lovely')"
    )
    conn.execute("INSERT INTO pair_ratings VALUES (1, 1, 2, 'enhance', 4, now())")


def _snapshot(conn) -> dict[str, list]:
    return {t: conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2").fetchall() for t in USER_TABLES}


def _new_catalogue_in_seed(conn) -> None:
    """What a pipeline rerun produces: a renamed bottle, a new bottle (id 4), new pair
    scores, a different note list, and a changed alias."""
    _run(conn, "stage.sql")
    conn.execute("UPDATE seed.fragrances SET name = 'F1 Renamed', rating_votes = 999 WHERE id = 1")
    conn.execute(
        """INSERT INTO seed.fragrances (id, slug, name, brand, profile, facets, harshness, strength,
             seasons, daynight)
           SELECT 4, 'brand-f4', 'F4', brand, profile, facets, harshness, strength,
                  seasons, daynight
             FROM seed.fragrances WHERE id = 3"""
    )
    conn.execute("DELETE FROM seed.pair_scores")
    conn.execute(
        """INSERT INTO seed.pair_scores
           VALUES (1, 4, 'enhance', 0.95, 1), (4, 1, 'enhance', 0.95, 1)"""
    )
    conn.execute("DELETE FROM seed.fragrance_notes WHERE note_id = 2")
    conn.execute("DELETE FROM seed.notes WHERE id = 2")
    conn.execute("INSERT INTO seed.notes VALUES (3, 'Rose', false, NULL, NULL, NULL)")
    conn.execute("INSERT INTO seed.fragrance_notes VALUES (4, 3, 'heart')")
    conn.execute("UPDATE seed.brand_aliases SET alias = 'BRD'")


@pytest.fixture
def db(scratch_database):
    with psycopg.connect(scratch_database) as conn:
        _catalogue(conn)
        _user_data(conn)
        conn.commit()
        yield conn


def test_reseed_keeps_every_user_row_and_updates_the_catalogue(db):
    before = _snapshot(db)
    assert all(before[t] for t in USER_TABLES)  # the test means nothing with empty tables

    _new_catalogue_in_seed(db)
    _run(db, "merge.sql")
    db.commit()

    assert _snapshot(db) == before
    renamed = db.execute("SELECT name, rating_votes FROM fragrances WHERE id = 1").fetchone()
    assert renamed == ("F1 Renamed", 999)
    assert [r[0] for r in db.execute("SELECT id FROM fragrances ORDER BY id")] == [1, 2, 3, 4]
    assert db.execute("SELECT count(*) FROM pair_scores").fetchone()[0] == 2
    assert [r[0] for r in db.execute("SELECT name FROM notes ORDER BY id")] == ["Vanilla", "Rose"]
    assert db.execute("SELECT alias FROM brand_aliases").fetchall() == [("BRD",)]
    # The seed schema is gone, and the next new fragrance gets id 5, not a reused one.
    assert db.execute("SELECT count(*) FROM pg_namespace WHERE nspname = 'seed'").fetchone()[0] == 0
    assert db.execute("SELECT nextval('fragrances_id_seq')").fetchone()[0] == 5


def test_reseed_refuses_a_seed_that_drops_a_production_fragrance(db):
    """Dropping a fragrance would cascade into collections; the merge must stop instead."""
    before = _snapshot(db)
    _new_catalogue_in_seed(db)
    db.execute("DELETE FROM seed.fragrances WHERE id = 2")
    with pytest.raises(psycopg.errors.RaiseException, match="missing 1 production fragrances"):
        _run(db, "merge.sql")
    db.rollback()
    assert _snapshot(db) == before
    assert db.execute("SELECT name FROM fragrances WHERE id = 1").fetchone()[0] == "F1"


def test_the_old_truncate_cascade_would_have_wiped_users_collections(db):
    """Why the script changed: the old load's TRUNCATE ... CASCADE, on the same data,
    empties collection, reviews, and pair ratings. Rolled back afterwards."""
    db.execute(
        "TRUNCATE families, fragrances, notes, fragrance_notes, fragrance_accords, pair_scores,"
        " brand_aliases, name_aliases CASCADE"
    )
    assert db.execute("SELECT count(*) FROM collection").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM reviews").fetchone()[0] == 0
    db.rollback()
