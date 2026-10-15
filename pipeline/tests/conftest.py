"""Shared fixtures. Catalogue tests need `build/catalogue.parquet` (made by the pipeline's
ingest step from the gitignored Kaggle file), so they skip on a fresh checkout and in CI."""

import pandas as pd
import pytest

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
