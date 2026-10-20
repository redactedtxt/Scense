"""Shared fixtures. Catalogue tests need `build/catalogue.parquet` (made by the pipeline's
ingest step from the gitignored Kaggle file), so they skip on a fresh checkout and in CI."""

import uuid
from pathlib import Path

import pandas as pd
import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

import load
from pipeline_config import CATALOGUE_PATH, load_config
from precompute import precompute_pairs
from profiles import build_fragrance_profiles


@pytest.fixture(scope="session")
def cfg():
    return load_config()


@pytest.fixture(scope="session")
def catalogue():
    if not CATALOGUE_PATH.exists():
        pytest.skip("run `python src/run.py pipeline` first to build the catalogue parquet")
    return pd.read_parquet(CATALOGUE_PATH)


@pytest.fixture(scope="session")
def fragrances(catalogue, cfg):
    return build_fragrance_profiles(catalogue, cfg)


@pytest.fixture(scope="session")
def pairs(fragrances, cfg):
    return precompute_pairs(fragrances, cfg)


MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


@pytest.fixture
def scratch_database(monkeypatch):
    """A throwaway empty database with every real migration applied; dropped afterwards.
    Skips when no Postgres is reachable (CI has none)."""
    base = conninfo_to_dict(load.database_url())
    name = f"scense_test_{uuid.uuid4().hex[:8]}"
    try:
        admin = psycopg.connect(make_conninfo(**{**base, "dbname": "postgres"}), autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("no Postgres reachable (start docker compose); this test needs CREATE DATABASE")
    admin.execute(f'CREATE DATABASE "{name}"')
    url = make_conninfo(**{**base, "dbname": name})
    try:
        with psycopg.connect(url) as conn:
            for migration in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
                conn.execute(migration.read_text(encoding="utf-8").split("-- Down Migration")[0])
        monkeypatch.setenv("DATABASE_URL", url)
        yield url
    finally:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()
