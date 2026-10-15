"""One command-line entry point, so the pipeline runs the same on Windows (no `make`) and Linux.

    python pipeline/src/run.py pipeline   # ingest, profiles, scoring, load, then top 10s
    python pipeline/src/run.py tune       # same, minus ingest (reuses build/catalogue.parquet)
    python pipeline/src/run.py migrate    # apply db/migrations through the running api container

The Makefile targets call these, so `make pipeline` and this file never drift apart.
"""

import argparse
import subprocess
import sys

import pandas as pd

import ingest
import load
from pipeline_config import CATALOGUE_PATH, PIPELINE_DIR, Config, load_config
from precompute import precompute_pairs, top_partners
from profiles import build_fragrance_profiles, build_note_profiles, dominant_family

# The two fragrances the spec asks us to eyeball after every tuning change.
CDNIM_SLUG = "armaf-club-de-nuit-intense-man-2015"
AVENTUS_SLUG = "creed-aventus-2010"


def build_everything(cfg: Config) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Steps 3 to 5: profiles, note profiles and all pair scores, in memory."""
    catalogue = pd.read_parquet(CATALOGUE_PATH)
    fragrances = build_fragrance_profiles(catalogue, cfg)
    notes = build_note_profiles(cfg, catalogue)
    pairs = precompute_pairs(fragrances, cfg)
    return fragrances, notes, pairs


def print_top10(fragrances: pd.DataFrame, pairs: pd.DataFrame, cfg: Config, slug, goal) -> None:
    base = int(fragrances.index[fragrances["slug"] == slug][0])
    row = fragrances.loc[base]
    print(f"\n=== {row['brand']} {row['name']}: top 10 for {goal.upper()} "
          f"(base harshness {row['harshness']:.2f}, strength {row['strength']}) ===")  # fmt: skip
    top = top_partners(pairs, fragrances, base, goal)
    facet = {name: i for i, name in enumerate(cfg.facet_names)}
    for _, r in top.iterrows():
        family = cfg.family_names[dominant_family(r["profile"])]
        print(
            f"{r['rank']:>3}  {r['score']:5.1f}  {r['brand']} {r['name']}"
            f"  [{family}; harsh {r['harshness']:.2f}; str {r['strength']};"
            f" sweet {r['facets'][facet['sweet']]:.2f},"
            f" powdery {r['facets'][facet['powdery']]:.2f}]"
        )


def run_model(cfg: Config) -> None:
    fragrances, notes, pairs = build_everything(cfg)
    load.load_all(fragrances, notes, pairs, cfg)
    print(f"loaded {len(fragrances)} fragrances, {len(notes)} notes, {len(pairs)} pair rows")
    print_top10(fragrances, pairs, cfg, CDNIM_SLUG, "soften")
    print_top10(fragrances, pairs, cfg, AVENTUS_SLUG, "enhance")


def migrate() -> None:
    cmd = ["docker", "compose", "exec", "api", "npm", "run", "migrate"]
    sys.exit(subprocess.run(cmd, cwd=PIPELINE_DIR.parent).returncode)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["pipeline", "tune", "migrate"])
    command = parser.parse_args().command
    if command == "migrate":
        migrate()
        return
    if command == "pipeline":
        ingest.main()
    run_model(load_config())


if __name__ == "__main__":
    main()
