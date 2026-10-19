"""Step 6: upsert everything into Postgres in one transaction. Safe to re-run.

Connects with DATABASE_URL (default: the docker-compose dev database).
"""

import io
import json
import os

import pandas as pd
import psycopg

from pipeline_config import Config

DEFAULT_DATABASE_URL = "postgresql://scense:scense_dev@localhost:5432/scense"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def load_all(fragrances: pd.DataFrame, notes: pd.DataFrame, pairs: pd.DataFrame, cfg: Config):
    """Everything happens inside one transaction: a failure leaves the database untouched."""
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            _upsert_families(cur, cfg)
            note_ids = _upsert_notes(cur, notes, cfg)
            fragrance_ids = _upsert_fragrances(cur, fragrances, cfg)
            _replace_fragrance_notes(cur, fragrances, fragrance_ids, note_ids)
            _replace_accords(cur, fragrances, fragrance_ids)
            _replace_pairs(cur, pairs, fragrance_ids)
            _replace_aliases(cur, cfg)
            _rebuild_search_vectors(cur)
            _report_unused_aliases(cur)
        # leaving the `with conn` block commits; an exception rolls back


def _upsert_families(cur, cfg: Config) -> None:
    for i, (name, harshness) in enumerate(zip(cfg.family_names, cfg.family_harshness, strict=True)):
        cur.execute(
            """INSERT INTO families (id, name, harshness) VALUES (%s, %s, %s)
               ON CONFLICT (id) DO UPDATE
                 SET name = EXCLUDED.name, harshness = EXCLUDED.harshness""",
            (i, name, float(harshness)),
        )


def _facet_json(names: list[str], values) -> str:
    return json.dumps({n: round(float(v), 6) for n, v in zip(names, values, strict=True)})


def _upsert_notes(cur, notes: pd.DataFrame, cfg: Config) -> dict[str, int]:
    """Every note is stored; unmapped ones have no profile, facets or harshness."""
    ids = {}
    for row in notes.itertuples():
        profile = facets = harshness = None
        if row.mapped:
            profile = [float(x) for x in row.profile]
            facets = _facet_json(cfg.facet_names, row.facets)
            harshness = float(row.harshness)
        cur.execute(
            """INSERT INTO notes (name, mapped, profile, facets, harshness)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (name) DO UPDATE SET mapped = EXCLUDED.mapped,
                 profile = EXCLUDED.profile, facets = EXCLUDED.facets,
                 harshness = EXCLUDED.harshness
               RETURNING id""",
            (row.name, bool(row.mapped), profile, facets, harshness),
        )
        ids[row.name] = cur.fetchone()[0]
    return ids


def _upsert_fragrances(cur, fragrances: pd.DataFrame, cfg: Config) -> list[int]:
    """Returns database ids in the same order as the `fragrances` rows."""
    facet_names = cfg.facet_names
    ids = []
    for row in fragrances.itertuples():
        year = None if pd.isna(row.release_year) else int(row.release_year)
        cur.execute(
            """INSERT INTO fragrances (slug, name, brand, gender, release_year, image_url,
                 community_rating, rating_votes, profile, facets, harshness, strength,
                 seasons, daynight)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, brand = EXCLUDED.brand,
                 gender = EXCLUDED.gender, release_year = EXCLUDED.release_year,
                 image_url = EXCLUDED.image_url, community_rating = EXCLUDED.community_rating,
                 rating_votes = EXCLUDED.rating_votes, profile = EXCLUDED.profile,
                 facets = EXCLUDED.facets, harshness = EXCLUDED.harshness,
                 strength = EXCLUDED.strength, seasons = EXCLUDED.seasons,
                 daynight = EXCLUDED.daynight
               RETURNING id""",
            (
                row.slug, row.name, row.brand, row.gender, year, row.image_url,
                float(row.community_rating), int(row.rating_votes),
                [float(x) for x in row.profile], _facet_json(facet_names, row.facets),
                float(row.harshness), int(row.strength),
                json.dumps(row.seasons), json.dumps(row.daynight),
            ),
        )  # fmt: skip
        ids.append(cur.fetchone()[0])
    return ids


def _replace_fragrance_notes(cur, fragrances, fragrance_ids, note_ids) -> None:
    """Every note of every fragrance, mapped or not."""
    cur.execute("DELETE FROM fragrance_notes WHERE fragrance_id = ANY(%s)", (fragrance_ids,))
    rows = set()
    for fid, notes_json in zip(fragrance_ids, fragrances["notes"], strict=True):
        for n in json.loads(notes_json):
            rows.add((fid, note_ids[n["note"]], n["layer"]))
    cur.executemany(
        "INSERT INTO fragrance_notes (fragrance_id, note_id, layer) VALUES (%s, %s, %s)",
        sorted(rows),
    )


def _replace_accords(cur, fragrances, fragrance_ids) -> None:
    cur.execute("DELETE FROM fragrance_accords WHERE fragrance_id = ANY(%s)", (fragrance_ids,))
    rows = [
        (fid, accord, strength)
        for fid, accords_json in zip(fragrance_ids, fragrances["accords"], strict=True)
        for accord, strength in json.loads(accords_json)
    ]
    cur.executemany(
        "INSERT INTO fragrance_accords (fragrance_id, accord, strength) VALUES (%s, %s, %s)", rows
    )


def _replace_pairs(cur, pairs: pd.DataFrame, fragrance_ids: list[int]) -> None:
    """Swap positional indexes for database ids, then bulk-load with COPY (fast for ~180k rows)."""
    cur.execute("DELETE FROM pair_scores")
    ids = pd.Series(fragrance_ids)
    out = pd.DataFrame(
        {
            "base_id": ids[pairs["base"]].to_numpy(),
            "partner_id": ids[pairs["partner"]].to_numpy(),
            "goal": pairs["goal"].to_numpy(),
            "score": pairs["score"].to_numpy(),
            "rank": pairs["rank"].to_numpy(),
        }
    )
    buffer = io.StringIO()
    out.to_csv(buffer, index=False, header=False)
    buffer.seek(0)
    with cur.copy(
        "COPY pair_scores (base_id, partner_id, goal, score, rank) FROM STDIN WITH (FORMAT csv)"
    ) as copy:
        copy.write(buffer.read())


def _replace_aliases(cur, cfg: Config) -> None:
    """Search aliases live in the database so the search vector is built from them in SQL."""
    cur.execute("DELETE FROM brand_aliases")
    cur.execute("DELETE FROM name_aliases")
    cur.executemany("INSERT INTO brand_aliases (alias, brand) VALUES (%s, %s)", cfg.brand_aliases)
    cur.executemany("INSERT INTO name_aliases (alias, name_word) VALUES (%s, %s)", cfg.name_aliases)


def _rebuild_search_vectors(cur) -> None:
    """name + brand + every alias that applies, as one 'simple' tsvector.

    A brand alias applies to every fragrance of that brand. A name alias applies to every
    fragrance whose name contains its name_word as a phrase; the phrase test uses the same
    text-search parser as the vector, so "J'adore" and "Eau de Parfum" are cut into words
    identically on both sides. Everything is unaccented first, and the API unaccents the
    typed text too, so "tresor" finds Trésor and "Giò" is "gio" on both sides. The API's
    query uses 'simple' too (routes/fragrances.ts).
    """
    cur.execute(
        """UPDATE fragrances f SET search_vector = to_tsvector('simple', unaccent(
             f.name || ' ' || f.brand
             || ' ' || coalesce((SELECT string_agg(a.alias, ' ') FROM brand_aliases a
                                  WHERE lower(a.brand) = lower(f.brand)), '')
             || ' ' || coalesce((SELECT string_agg(n.alias, ' ') FROM name_aliases n
                                  WHERE to_tsvector('simple', unaccent(f.name))
                                    @@ phraseto_tsquery('simple', unaccent(n.name_word))), '')))"""
    )


def _report_unused_aliases(cur) -> None:
    """An alias that matches nothing is not an error (the catalogue changes), but say so."""
    cur.execute(
        """SELECT 'brand', alias, brand FROM brand_aliases a
            WHERE NOT EXISTS (SELECT 1 FROM fragrances f WHERE lower(f.brand) = lower(a.brand))
           UNION ALL
           SELECT 'name', alias, name_word FROM name_aliases n
            WHERE NOT EXISTS (SELECT 1 FROM fragrances f
                               WHERE to_tsvector('simple', unaccent(f.name))
                                     @@ phraseto_tsquery('simple', unaccent(n.name_word)))"""
    )
    for kind, alias, target in cur.fetchall():
        print(f"note: {kind} alias '{alias}' -> '{target}' matches no fragrance in this catalogue")
