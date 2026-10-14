"""Print what the raw Kaggle dump actually contains.

Nothing else in the pipeline may assume a column name; read this output first.
Usage: python src/inspect_dataset.py [--raw raw] [--top 300]
"""

import argparse
import json
from collections import Counter
from pathlib import Path

import pandas as pd

CONCENTRATION_WORDS = [
    "eau fraîche",
    "eau fraiche",
    "eau de cologne",
    "eau de toilette",
    "eau de parfum",
    "extrait",
    "elixir",
    "parfum",
]


def print_schema(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    print(f"== CSV: {len(df)} rows, {len(df.columns)} columns ==")
    for col in df.columns:
        print(f"  {col:28s} {str(df[col].dtype):8s} null={df[col].isna().mean():.1%}")
    return df


def print_jsonl_shapes(jsonl_path: Path, n_samples: int = 3) -> int:
    """Show the nested shape of the first records and count all lines."""
    print("\n== JSONL top-level keys and 3 sample records (long text trimmed) ==")
    count = 0
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            if count < n_samples:
                rec = json.loads(line)
                rec["description"] = (rec.get("description") or "")[:80] + "..."
                rec.pop("ai_summary", None)
                rec["similar"] = "<omitted>"
                if count == 0:
                    print("keys:", list(rec.keys()))
                print(json.dumps(rec, ensure_ascii=False)[:1800])
                print("---")
            count += 1
    print(f"JSONL lines: {count}")
    return count


def print_value_counts(df: pd.DataFrame) -> None:
    print("\n== gender values ==")
    print(df["gender"].value_counts(dropna=False).to_string())
    print("\n== year range ==")
    print(df["year"].describe().to_string())
    print("\n== vote_count (rating votes) distribution ==")
    print(df["vote_count"].describe().to_string())
    print("\n== aggregate-blob null rows (longevity_avg null) ==")
    print(f"{df['longevity_avg'].isna().sum()} of {len(df)}")
    print("\n== slug duplicates ==", df["slug"].duplicated().sum())


def top_n(df: pd.DataFrame, n: int) -> pd.DataFrame:
    return df.sort_values("vote_count", ascending=False).head(n)


def print_top_checks(top: pd.DataFrame) -> None:
    print(f"\n== Top {len(top)} by vote_count ==")
    print("vote_count range:", top["vote_count"].min(), "to", top["vote_count"].max())
    print(top["gender"].value_counts(dropna=False).to_string())
    print("missing accords:", (top["accords"].isna()).sum())
    print(
        "missing all notes:",
        top[["notes_top", "notes_middle", "notes_base", "notes_flat"]].isna().all(axis=1).sum(),
    )
    print("flat-note rows:", top["notes_flat"].notna().sum())
    print("null longevity/sillage:", top["longevity_avg"].isna().sum())
    top = top.copy()
    top["lon_votes"] = top[[f"longevity_b{i}" for i in range(1, 6)]].sum(axis=1)
    top["sil_votes"] = top[[f"sillage_b{i}" for i in range(1, 5)]].sum(axis=1)
    top["ls_votes"] = top["lon_votes"] + top["sil_votes"]
    print("longevity+sillage votes >= 50:", (top["ls_votes"] >= 50).sum(), "of", len(top))
    print("ls_votes min/median:", top["ls_votes"].min(), top["ls_votes"].median())
    print(
        "season columns all present:",
        top[["winter", "spring", "summer", "autumn"]].notna().all(axis=1).sum(),
    )
    print("day/night present:", top[["day", "night"]].notna().all(axis=1).sum())
    print(
        "(season sum==0):", (top[["winter", "spring", "summer", "autumn"]].sum(axis=1) == 0).sum()
    )


def print_named_fragrances(df: pd.DataFrame, top: pd.DataFrame) -> None:
    print("\n== Fragrances the spec names ==")
    for needle in ["Club de Nuit Intense", "Aventus", "Sables Roses"]:
        hit = df[df["name"].str.contains(needle, case=False, na=False)]
        for _, r in hit.sort_values("vote_count", ascending=False).head(5).iterrows():
            in_top = r["slug"] in set(top["slug"])
            print(
                f"  {r['brand']} / {r['name']} ({r['gender']}) votes={r['vote_count']} "
                f"in_top={in_top}"
            )


def print_concentration_check(df: pd.DataFrame, top: pd.DataFrame) -> None:
    """The spec falls back to concentration. Is it in the data anywhere?"""
    print("\n== Concentration: any column? ==")
    print([c for c in df.columns if "conc" in c.lower()] or "no column")
    print("Does it show in name / description text of the top set?")
    counts: Counter = Counter()
    for text in (top["name"].fillna("") + " " + top["description"].fillna("")).str.lower():
        for word in CONCENTRATION_WORDS:
            if word in text:
                counts[word] += 1
                break
    print(dict(counts), f"-> {sum(counts.values())} of {len(top)} rows mention one")


def split_pairs(cell: object) -> list[tuple[str, float]]:
    """Parse 'name:100|name:47' into (name, value) pairs."""
    if not isinstance(cell, str) or not cell:
        return []
    out = []
    for part in cell.split("|"):
        name, _, val = part.rpartition(":")
        out.append((name, float(val)))
    return out


def print_vocab(top: pd.DataFrame, full: pd.DataFrame) -> None:
    accords_top = Counter(a for c in top["accords"] for a, _ in split_pairs(c))
    accords_all = Counter(a for c in full["accords"] for a, _ in split_pairs(c))
    print(
        f"\n== Accord vocabulary: {len(accords_all)} in full set, {len(accords_top)} in top set =="
    )
    print("top-set accords:", dict(accords_top.most_common()))
    print("accords only in full set:", sorted(set(accords_all) - set(accords_top))[:60])

    note_cols = ["notes_top", "notes_middle", "notes_base", "notes_flat"]
    notes_top = Counter(n for col in note_cols for c in top[col] for n, _ in split_pairs(c))
    print(f"\n== Note vocabulary in top set: {len(notes_top)} distinct ==")
    print("top 160 by number of fragrances (name:count):")
    print(", ".join(f"{n}:{k}" for n, k in notes_top.most_common(160)))
    covered = sum(k for _, k in notes_top.most_common(150)) / sum(notes_top.values())
    print(f"share of note mentions covered by top 150: {covered:.1%}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="raw")
    parser.add_argument("--top", type=int, default=300)
    args = parser.parse_args()
    raw = Path(args.raw)

    df = print_schema(raw / "perfumes.csv")
    print_jsonl_shapes(raw / "perfumes.jsonl")
    print_value_counts(df)
    top = top_n(df, args.top)
    print_top_checks(top)
    print_named_fragrances(df, top)
    print_concentration_check(df, top)
    print_vocab(top, df)


if __name__ == "__main__":
    main()
