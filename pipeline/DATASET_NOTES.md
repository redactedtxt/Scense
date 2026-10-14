# DATASET_NOTES.md

What is in `pipeline/raw/` and which fields the pipeline will use. Produced by `src/inspect_dataset.py`; re-run it to reproduce every number below.

## Files

| File | Notes |
|---|---|
| `perfumes.csv` | 140,228 rows, 59 columns, flat. Nested data is packed into strings (`name:value\|name:value`). |
| `perfumes.jsonl` | Same 140,228 perfumes with nested objects. Has `picture`/`thumbnail`, per-note `slug`/`image_id`, and `similar`/`ai_summary`, which the CSV lacks. |
| `SCHEMA.md` | Describes the JSONL. The CSV carries the same fields flattened. |

**Decision for ingest:** read the **CSV**. It has every field SPEC.md needs, loads in seconds, and is 4x smaller. `image_url` is rebuilt from `id`: `https://fimgs.net/mdimg/perfume/375x500.{id}.jpg` (per SCHEMA.md). The two files agree on row count.

## Fields we will use (CSV column names)

| Need | Column(s) | Shape / notes |
|---|---|---|
| Identity | `id`, `slug`, `name`, `brand` | `slug` is **not unique** (see mismatches). `id` is. |
| Gender | `gender` | `male` / `female` / `unisex` (spec says men/women/unisex). Never null. |
| Year | `year` | float, 18% null overall, 4 null in the top 300. |
| Rating | `rating_avg`, `vote_count` | `vote_count` = number of rating votes. Never null. |
| Accords | `accords` | `"citrus:100\|fresh spicy:47\|..."`, strength 0..100, ordered high to low. Top-300 rows have 5 to 8 accords. |
| Notes | `notes_top`, `notes_middle`, `notes_base`, `notes_flat` | Same `name:weight` packing, weight 0..100. Either tiered or flat, never both: 14 of the top 300 are flat only. Null when empty. |
| Longevity votes | `longevity_b1..b5` (+ `longevity_avg`) | Counts per bucket, 1 = weak, 5 = strong. |
| Sillage votes | `sillage_b1..b4` (+ `sillage_avg`) | Counts per bucket, **4 buckets**, 1 = intimate. |
| Season votes | `winter`, `spring`, `summer`, `autumn` | **Vote counts**, not booleans. Spec calls the fourth one `fall`. |
| Day/night votes | `day`, `night` | Vote counts. |
| Image | derived from `id` | Not stored as a column in the CSV. |

Fields we will ignore: `price_value_*`, `have/had/want`, `perceived_*`, `people`, popularity columns, `perfumers`, `description`, `collection`, `url`, `similar`, `ai_summary`.

## The top 300

SPEC section 4.2: top 300 by total rating votes. The dataset has one `vote_count` per perfume (not split by gender), so "across men's, women's, and unisex" is simply `vote_count` over all rows.

- `vote_count` range in the top 300: 8,202 to 36,883. The 300th cutoff is 8,202.
- Gender: 142 female, 97 male, 61 unisex.
- Nothing is missing in the top 300: all have accords, all have at least one notes column, all have longevity, sillage, season, and day/night votes.
- Longevity + sillage votes: minimum 4,085, median 11,926. Every top-300 fragrance is far above the 50-vote threshold.
- Season totals per fragrance are in the thousands (median ~21,000 across season and day/night columns), and none sum to zero, so shares are safe to compute.
- Aggregate-blob nulls (SCHEMA.md says they go null together): **zero** rows in the CSV have null longevity, because the CSV stores them as 0 instead. They only matter for low-vote rows, which the filter removes. `people` is null for 2.2% of rows overall but never in the top 300.

## Vocabulary

**Accords:** 92 distinct in the full set, **59 in the top 300**. All 59 are in `config/accord_map.csv`; the other 33 are one-off oddities (gasoline, bacon, brown scotch tape, ...) that never appear in the catalogue. Accord names are lowercase except `Champagne` and `Pear` (not in the top 300).

**Notes:** 468 distinct raw names in the top 300, 395 after `config/note_aliases.csv` merges spelling and origin variants (76 aliases into 34 canonical notes). `config/note_map.csv` covers the 150 most frequent canonical notes. The 150th note sits in a tie at 3 fragrances (36 notes); ties go to the larger summed note weight. Some raw names contain a corrupted character (`Ambermax�`, `Pepperwood�`, `Drag�e`); none are in the top 150.

## Strength

Strength is computed from votes only (SPEC 3.4 step 4). The 0-1 value is the mean of the longevity and sillage weighted means. Across the top 300: 10th percentile 0.397, 25th 0.460, 50th 0.538, 75th 0.619, 90th 0.688 (range 0.214 to 0.874). Club de Nuit Intense Man is 0.633, the 78th percentile; Aventus 0.515. Cutoffs `[0.46, 0.54, 0.62]` (approved) live in `scoring.yaml` as `strength_cutoffs`; they give 75 / 78 / 72 / 75 fragrances at strengths 1 to 4.

## Where the dataset differs from SPEC.md (all ruled on)

1. **No concentration field.** Dropped from the spec: no `concentration` column, no fallback, no `strength_source`. Strength always comes from votes.
2. **`slug` is not unique** (1,563 duplicated in the full set; `Davidoff/Cool-Water` ids 507 and 508 in the top 300). We build our own slug, `brand-name-year` in kebab-case, appending the id only on a full collision inside the catalogue. The top 300 have no collisions, so no id suffixes appear today. Four top-300 rows have no year and get slugs without one (for example `azzaro-the-most-wanted`).
3. **`autumn`, `male`, `female`** are stored as the dataset gives them. The UI shows Fall, Men, Women.
4. **Strength bins.** Cutoffs move into `scoring.yaml`.
5. **`Les Sables Roses` is not in the top 300** (2,239 votes). The spec example is now Baccarat Rouge 540.
6. **Note variants** are merged through `note_aliases.csv`.
7. **Year has junk values** in the full set (min 20, max 2027). None in the top 300.

The CSV stores the vote blob as zeros, not nulls, when it is missing (3,116 rows have null `people` and all-zero votes). None are in the top 300.
