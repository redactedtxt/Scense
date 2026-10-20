# SPEC.md: Scense, a Fragrance Layering App

You are Claude Code. This file is the source of truth for the build. Read it in full before writing code. Build one milestone at a time, in order. After each milestone, stop, summarise what you built, list the files a reviewer should read first, and wait for Tejas to approve before starting the next one.

Tejas reviews all code but does not write it. Write code a third-year CS student can read: clear names, short functions, a comment above every non-obvious block explaining *why*, not *what*.

---

## 1. What the app does

A fragrance catalogue with a layering engine at its centre.

1. **Pairing (the centerpiece).** You enter one or more notes, or one fragrance, and pick a goal: **Enhance** or **Soften**. Notes return a ranked list of notes. A fragrance returns a ranked list of fragrances. You can search the fragrance list for any bottle and see its rank ("Baccarat Rouge 540: #38 of 999"). The UI shows the fragrance's name, brand, and dominant family only; it never shows a concentration label such as "Eau de toilette", because the dataset has none.
2. **Catalogue.** Browse and search the 1,000 most-voted fragrances. Each page shows the note pyramid, accords, strength, season and day/night tags, community rating, and vote count.
3. **Chatbot.** You describe what you like and dislike in plain words. The AI turns your words into a taste profile and the server recommends fragrances from the catalogue.
4. **Concierge.** You describe an outing in free text. The AI asks for anything missing, then the server picks the best fragrance from your Own list.
5. **Collection.** Want and Own buttons on every fragrance.
6. **Taste profile card.** Shows the profile the chatbot built, in plain words. You can edit it.
7. **Accounts (pass 2).** Sign up, sign in, written reviews, pair ratings.

### Non-goals for v1

- No mobile app. Responsive web only.
- No payments, no email verification, no password reset.
- No live scraping of any site.
- No LLM-generated fragrance data. All fragrance facts come from the dataset.
- Pair ratings get stored but do not change scores yet.

---

## 2. Stack and repo layout

App name: **Scense**. GitHub repo name: `scense`. Production domain: `https://scense.name`.

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript, React Router, TanStack Query, Tailwind CSS v4 (via `@tailwindcss/vite`) |
| API | Node 24 + Express + TypeScript, Zod for validation, `pg` for database access |
| Offline jobs | Python 3.12: pandas, psycopg 3, PyYAML, pytest |
| Database | PostgreSQL 16 |
| AI | Anthropic API, model `claude-haiku-5-5`, official `@anthropic-ai/sdk` |
| Migrations | Plain SQL files in `db/migrations`, run with `node-pg-migrate` |
| Tests | Vitest + Supertest (API), Vitest + Testing Library (web), pytest (pipeline), Playwright for 3 smoke tests |
| Infra | Docker, Docker Compose, Caddy (TLS and static files), GitHub Actions, one AWS EC2 instance |

```
/
├── SPEC.md
├── DECISIONS.md
├── README.md
├── docker-compose.yml            # local dev: db, api, web
├── docker-compose.prod.yml       # EC2: caddy, api, db, backup
├── Caddyfile
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── db/migrations/                # 001_init.sql, 002_search_aliases.sql, 003_accounts.sql, ...
├── pipeline/
│   ├── raw/                      # Kaggle files, gitignored
│   ├── config/
│   │   ├── scoring.yaml          # every tunable number lives here (incl. strength_cutoffs, search and browse settings)
│   │   ├── families.yaml         # 14 wheel families, ring positions, harshness
│   │   ├── facets.yaml           # facets and harshness nudges
│   │   ├── accord_map.csv        # dataset accord -> family weights + facets
│   │   ├── note_map.csv          # canonical note -> family weights + facets
│   │   ├── note_aliases.csv      # dataset note spelling/origin variant -> canonical note
│   │   ├── pinned_ids.csv        # id,slug of the fragrances guests may have saved; never changes (B28)
│   │   ├── brand_aliases.csv     # search: abbreviation -> brand (YSL -> Yves Saint Laurent)
│   │   ├── name_aliases.csv      # search: misspelling -> word in a fragrance name (myself -> MYSLF)
│   │   └── occasions.yaml        # concierge occasion -> family preferences
│   ├── src/
│   │   ├── inspect_dataset.py
│   │   ├── ingest.py
│   │   ├── profiles.py
│   │   ├── scoring.py
│   │   ├── precompute.py
│   │   └── load.py
│   └── tests/
├── api/src/
│   ├── index.ts
│   ├── db.ts
│   ├── config.ts
│   ├── routes/                   # fragrances, notes, pairing, auth, collection, chat, concierge, reviews, ratings, profile
│   ├── services/                 # scoring.ts (runtime note scoring), llm.ts, caps.ts, recommend.ts
│   ├── middleware/               # auth.ts, guest.ts, rateLimit.ts, errors.ts
│   └── tests/
└── web/src/
    ├── pages/
    ├── components/
    ├── lib/                      # api client, guestStore.ts
    └── tests/
```

---

## 3. The fragrance model

### 3.1 The 14 families (Michael Edwards fragrance wheel)

Store in `families.yaml`. Position is the index on the ring. Position 13 wraps to 0.

| Pos | Family | Base harshness |
|---|---|---|
| 0 | Soft Amber | 0.15 |
| 1 | Amber | 0.25 |
| 2 | Woody Amber | 0.60 |
| 3 | Woods | 0.40 |
| 4 | Mossy Woods | 0.50 |
| 5 | Dry Woods | 0.80 |
| 6 | Aromatic Fougère | 0.50 |
| 7 | Citrus | 0.60 |
| 8 | Water | 0.40 |
| 9 | Green | 0.70 |
| 10 | Fruity | 0.30 |
| 11 | Floral | 0.30 |
| 12 | Soft Floral | 0.15 |
| 13 | Floral Amber | 0.30 |

### 3.2 Facets

The wheel lacks gourmand, spicy, and an intensity axis. Facets patch that. Store in `facets.yaml`.

| Facet | Example notes | Harshness nudge |
|---|---|---|
| sweet | vanilla, tonka, caramel, praline | -0.20 |
| creamy | sandalwood, coconut, milk | -0.20 |
| powdery | iris, heliotrope, musk | -0.15 |
| spicy | cinnamon, clove, pepper, cardamom | +0.15 |
| smoky | birch tar, incense, leather, tobacco | +0.25 |
| sharp | grapefruit, lemon, galbanum | +0.20 |

### 3.3 Mapping files (draft them, Tejas reviews them)

- `accord_map.csv` columns: `accord, family_weights, facets, check`. Example row: `warm spicy, "Woody Amber:0.6;Soft Amber:0.4", "spicy"`. Weights in a row sum to 1. Cover every accord that appears in the filtered catalogue.
- `note_map.csv` columns: `note, family_weights, facets, check`. Cover the 150 most frequent **canonical** notes in the filtered catalogue (frequency = number of catalogue fragrances containing the note, after aliases are applied; ties at the cutoff go to the note with the larger summed weight). When the catalogue grew to 1,000 the 150 stayed and every further note used in 10 or more fragrances was added, 167 in all (DECISIONS B27).
- `note_aliases.csv` columns: `alias, canonical`. Maps spelling and origin variants to one canonical note ("Vanille", "Madagascar Vanilla", "Bourbon Vanilla" → "Vanilla"; "Virginia Cedar" → "Cedar"). Ingest applies it to every note name before anything else, and a fragrance that lists two variants of one note counts that note once (keep the highest weight). Notes outside `note_map.csv` after aliasing are ignored for note pairing and autocomplete but still shown on the fragrance page. They are stored in `notes` with `mapped = false` and no profile.
- `brand_aliases.csv` columns: `alias, brand, check`. Search abbreviations and common alternative spellings of a brand (`YSL` → `Yves Saint Laurent`, `JPG` → `Jean Paul Gaultier`, `D&G` → `Dolce&Gabbana`). `brand` is the brand exactly as the dataset spells it. An alias applies to every fragrance of that brand. A row whose brand is not in the catalogue is allowed (it is kept for when the catalogue grows); `load.py` prints a note for it.
- `name_aliases.csv` columns: `alias, name_word, check`. Spellings people type for a fragrance name (`myself` → `MYSLF`). `name_word` is a word or phrase inside the dataset name, matched as whole words in order, anywhere in the name (`MYSLF` matches "MYSLF Eau de Parfum"; `Eau de Parfum` matches every name that contains those three words). An alias applies to every fragrance whose name matches. One alias may have several rows.
- Both files are draft-then-review like the mapping files: the `check` column holds `# CHECK` for rows Tejas should confirm, and the loaders ignore it. Both are loaded into the `brand_aliases` and `name_aliases` tables and folded into `search_vector` (section 5).
- The `check` column holds `# CHECK` remarks for the human reviewer. **Pipeline code must ignore it** when loading (read only the named columns).

Draft both files from perfumery knowledge, then **stop and ask Tejas to review them** before moving on. Mark any row you feel unsure about with a `# CHECK` comment column.

### 3.4 Fragrance profile

For each fragrance:

1. `p` = a 14-value vector. For each accord with strength `s` (0 to 100), add `s × weight` to each mapped family. Normalise so `p` sums to 1. If a fragrance has no accords, build `p` from its notes with equal weight per note.
2. `facets` = a 6-value vector. Each facet's value = (sum of strengths of accords tagged with it) / (sum of all accord strengths). Range 0 to 1.
3. `harshness` = clamp(Σ pᵢ × familyHarshnessᵢ + Σ facet_f × nudge_f, 0, 1).
4. `strength` (integer 1 to 4), always from community votes. The dataset has no concentration field, so there is no fallback:
   - Convert the longevity vote distribution (5 buckets) and the sillage vote distribution (4 buckets) each to a 0 to 1 weighted mean (weakest bucket = 0, strongest = 1) and average the two.
   - Bin with `strength_cutoffs: [0.46, 0.54, 0.62]` from `scoring.yaml` (`[c1, c2, c3]`): `< c1 → 1`, `< c2 → 2`, `< c3 → 3`, else `4`.
   - `scoring.yaml` also holds `min_strength_votes` (1,000). `ingest.py` fails loudly if any catalogue fragrance has fewer longevity plus sillage votes than that. The 1,000 all have 1,613 or more, so this is a guard, not a code path.
   - Tejas approved these cutoffs from the top-300 distribution. They give strengths 1 to 4 a 75 / 78 / 72 / 75 split and put Armaf Club de Nuit Intense Man (0.633) at 4. At 1,000 fragrances the split is 308 / 279 / 224 / 189 and the first 300 keep 75 / 78 / 72 / 75; Tejas kept the cutoffs (DECISIONS B27).
5. Season tags and day/night tags come from the dataset's season and time-of-day votes. Store each as a share from 0 to 1 (`winter, spring, summer, autumn, day, night`). The data and schema use the dataset's `autumn`; the UI label is "Fall".

### 3.5 Scoring

Ring distance between families i and j: `d = min(|i - j|, 14 - |i - j|)`, range 0 to 7.

Affinity tables (in `scoring.yaml`):

| d | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| enhance | 1.0 | 0.6 | 0.3 | 0.1 | 0 | 0 | 0 | 0 |
| soften | 0.2 | 0.4 | 0.6 | 0.8 | 0.9 | 0.85 | 0.75 | 0.6 |

Base score for base A and partner B:

```
raw(A, B) = Σᵢ Σⱼ pAᵢ × pBⱼ × M_goal[d(i, j)]   =  pA · M · pB
```

Precompute the 14 × 14 matrix `M_goal[d(i,j)]` once per goal.

- **Soften:** `base(A, B) = raw(A, B)`.
- **Enhance:** a cosine-style similarity. Enhance means "more of what you have", so a fragrance and its near-clones must score highest.
  - Fragrances: `x = [p (14 families), facets (6)]` and `K` = block-diagonal(`M_enhance`, `facet_weight × I₆`), so a facet only matches the same facet. `base(A, B) = xA·K·xB / sqrt(xA·K·xA × xB·K·xB)`. `facet_weight` (1.0) lives in `scoring.yaml` under `enhance`.
  - Notes: families only, `base(A, B) = pA·M·pB / sqrt(pA·M·pA × pB·M·pB)`.
  - The Enhance table must keep `M_enhance` positive definite (a pytest checks it). Then a fragrance scores exactly 1 with itself and below 1 with anything different.

Goal rules:

- **Enhance:** score = base. No strength penalty: a stronger near-clone amplifies the base.
- **Soften:** drop B if harshness(B) ≥ harshness(A). Otherwise score = base × (1 + harshness(A) - harshness(B)). If strength(B) < strength(A) - 1, multiply by 0.7 (the partner gets buried).

Scores get normalised to 0 to 100 within each base fragrance's list for display. Every constant above lives in `scoring.yaml`. Nothing gets hardcoded.

**Notes** use the same formulas over mapped notes only; Enhance uses the families-only similarity above. A note's profile comes from `note_map.csv`, its harshness from section 3.4 step 3. Multi-note input: average the input notes' profiles and harshness. Exclude input notes from results. Return single notes only. The API computes note scores at request time (167 notes is cheap).

**Fragrances** get precomputed: up to 1,000 × 999 × 2 rows in `pair_scores` with a rank per (base, goal). Enhance lists every other fragrance (999 rows per base). Soften lists only partners gentler than the base, so its totals vary by base (1,498,500 rows in total for the current catalogue: 999,000 Enhance and 499,500 Soften).

### 3.6 Sanity tests the pipeline must pass

Write these as pytest cases:

- `d(13, 0) == 1`, `d(0, 7) == 7`, `d(3, 10) == 7`.
- Profiles sum to 1 within 1e-6.
- Enhance score of a fragrance with itself beats its score with any fragrance whose dominant family sits at distance 4 or more.
- For Armaf Club de Nuit Intense Man, Soften: at least 7 of the top 10 partners have Amber, Soft Amber, or Floral Amber, or a `sweet` or `powdery` facet above 0.2. If this fails, print the top 10 and stop. Tejas will tune.
- Soften never returns a partner with equal or higher harshness.
- Every row in `accord_map.csv` and `note_map.csv` has weights that sum to 1 and only known family and facet names.
- Every accord in the catalogue is in `accord_map.csv`, and every `note_aliases.csv` canonical name exists in `note_map.csv` or is a deliberate unmapped note.
- Every `brand_aliases.csv` brand is a catalogue brand (except any deliberate absentees, none today: Comme des Garcons, spelled without the cedilla in the dataset, joined at 1,000), and every `name_aliases.csv` `name_word` appears in some catalogue name.
- The alias files hold YSL, JPG, D&G, CDG, MFK, PDM, TF and `myself` → MYSLF, ignore the `check` column, and reject duplicate or empty rows.
- Slug builder: `Davidoff` / `Cool Water` / 1988 gives `davidoff-cool-water-1988`; a missing year is left out; accents are stripped; a collision appends the dataset id.

---

## 4. Data pipeline (Python, offline)

Tejas downloads the Decant Kaggle dataset ("Fragrantica Perfumes: Ratings, Notes, Votes & More", kaggle.com/datasets/ledecanteur/fragrantica-perfumes) into `pipeline/raw/`.

1. `inspect_dataset.py`: print the schema, column names, nested field shapes, and 3 sample rows. **Do not assume column names anywhere. Read them here first** and write a short `pipeline/DATASET_NOTES.md` describing the fields you will use.
2. `ingest.py`: read `pipeline/raw/perfumes.csv`. Filter to the top `catalogue_size` (1,000) fragrances by `vote_count` (the dataset's total rating votes; it is not split by gender, so all genders compete together). Drop rows missing both accords and notes. Apply `note_aliases.csv`. Build each slug (below). Output a clean parquet file.
   - **Slug:** the dataset's own `slug` is not unique (for example two Cool Waters), so we build ours: `brand-name-year`, lowercase kebab-case, accents stripped, non-alphanumerics collapsed to one hyphen, year omitted when unknown. Example: `davidoff-cool-water-1988`. Collisions are checked inside the catalogue only, so slugs don't change when an unrelated fragrance elsewhere in the dataset collides. If brand, name, and year all match, append `-{dataset id}` to every colliding row.
   - Store `gender` as the dataset gives it (`male`, `female`, `unisex`) and seasons as `winter, spring, summer, autumn`. Only the UI says Men, Women, Fall.
3. `profiles.py`: build `p`, facets, harshness, strength, season and day/night shares.
4. `scoring.py`: ring distance, matrix build, pair scoring, goal rules. Pure functions, fully unit tested.
5. `precompute.py`: all fragrance pairs for both goals, ranks included.
6. `load.py`: upsert everything into Postgres in one transaction, including the search-alias tables and every fragrance's `search_vector`. Re-runnable. Fragrances listed in `pinned_ids.csv` are inserted with their pinned id and the load refuses a catalogue that drops one; new fragrances take the next id (DECISIONS B28).

Command: `make pipeline` runs steps 2 to 6. `make tune` reruns 3 to 6 after a `scoring.yaml` change and prints the CDNIM Soften top 10 and the Creed Aventus Enhance top 10.

---

## 5. Database schema

Migration `001_init.sql` (pass 1):

```sql
CREATE TABLE families (
  id SMALLINT PRIMARY KEY,            -- ring position 0-13
  name TEXT NOT NULL UNIQUE,
  harshness REAL NOT NULL
);

CREATE TABLE fragrances (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,          -- built by ingest: brand-name-year, see section 4
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  gender TEXT,                        -- male, female, unisex (dataset values; UI shows Men, Women, Unisex)
  release_year SMALLINT,
  image_url TEXT,
  community_rating REAL,
  rating_votes INTEGER,
  profile REAL[14] NOT NULL,
  facets JSONB NOT NULL,              -- {"sweet":0.3,...}
  harshness REAL NOT NULL,
  strength SMALLINT NOT NULL CHECK (strength BETWEEN 1 AND 4),
  seasons JSONB NOT NULL,             -- {"winter":0.4,"spring":..,"summer":..,"autumn":..}; UI shows "Fall"
  daynight JSONB NOT NULL,            -- {"day":0.3,"night":0.7}
  search_vector TSVECTOR              -- 'simple' vector of name, brand, and their aliases (see 002)
);
CREATE INDEX fragrances_search_idx ON fragrances USING GIN (search_vector);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mapped BOOLEAN NOT NULL,            -- true = in note_map.csv; only mapped notes are paired and autocompleted
  profile REAL[14],                   -- null when not mapped
  facets JSONB,                       -- null when not mapped
  harshness REAL,                     -- null when not mapped
  CHECK (mapped = (profile IS NOT NULL AND facets IS NOT NULL AND harshness IS NOT NULL))
);

CREATE TABLE fragrance_notes (
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id),
  layer TEXT NOT NULL CHECK (layer IN ('top','heart','base','flat')),
  PRIMARY KEY (fragrance_id, note_id, layer)
);

CREATE TABLE fragrance_accords (
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  accord TEXT NOT NULL,
  strength REAL NOT NULL,
  PRIMARY KEY (fragrance_id, accord)
);

CREATE TABLE pair_scores (
  base_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (goal IN ('enhance','soften')),
  score REAL NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (base_id, goal, partner_id)
);
CREATE INDEX pair_scores_rank_idx ON pair_scores (base_id, goal, rank);

CREATE TABLE llm_usage (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL,              -- 'user:<id>' or 'guest:<uuid>'
  feature TEXT NOT NULL CHECK (feature IN ('chat','concierge')),
  day DATE NOT NULL,                  -- America/Toronto date
  conversation_id UUID NOT NULL,
  user_messages SMALLINT NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subject, feature, day)
);
```

Migration `002_search_aliases.sql` (search fix, after M6):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- typo-tolerant fallback
CREATE EXTENSION IF NOT EXISTS unaccent;  -- accent-free spellings match (tresor finds Trésor)

CREATE TABLE brand_aliases (
  alias TEXT NOT NULL,                -- what people type: YSL
  brand TEXT NOT NULL,                -- the brand as the dataset spells it
  PRIMARY KEY (alias, brand)
);

CREATE TABLE name_aliases (
  alias TEXT NOT NULL,                -- what people type: myself
  name_word TEXT NOT NULL,            -- a word or phrase inside a fragrance name: MYSLF
  PRIMARY KEY (alias, name_word)
);
```

`load.py` fills both tables from the CSVs, then rebuilds every `search_vector` in SQL as `to_tsvector('simple', unaccent(name || ' ' || brand || ' ' || brand aliases || ' ' || name aliases))`, in the same transaction as the rest of the load. The name-alias test uses `phraseto_tsquery('simple', name_word)`, so the alias match and the vector use one parser. This migration took number 002, so the pass 2 accounts migration below is `003_accounts.sql`.

Migration `003_accounts.sql` (pass 2):

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email CITEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('own','want')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fragrance_id)
);

CREATE TABLE taste_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  families JSONB NOT NULL,            -- 14 weights, -1 to 1
  facets JSONB NOT NULL,              -- 6 weights, -1 to 1
  summary TEXT,                       -- one plain-English line
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fragrance_id)
);

CREATE TABLE pair_ratings (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  base_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (goal IN ('enhance','soften')),
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, base_id, partner_id, goal)
);
```

---

## 6. Guest mode

The site opens in guest mode. No login wall.

- On first visit, `web/src/lib/guestStore.ts` creates a UUID and stores it in localStorage with the guest's Own list, Want list, and taste profile. Wrap every localStorage read and write in try/catch. If storage fails, keep state in memory and show a small banner: "Your browser blocked storage, so your collection won't persist."
- The web client sends the UUID in an `X-Guest-Id` header. The API uses it only for LLM caps. Guests send their owned fragrance IDs and taste profile in the request body when a feature needs them.
- Guests cannot write reviews or rate pairs. Show the buttons disabled with "Sign in to review."
- On sign-up or sign-in, offer to import the guest collection and taste profile into the account, then clear the guest store.

---

## 7. API

All responses JSON. Validate every body and query with Zod. Errors return `{ error: { code, message } }`.

### Pass 1

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | DB ping, for the deploy check |
| GET | `/api/fragrances?q=&gender=&family=&sort=&page=` | Search and list, 24 per page. `gender` is `male`, `female`, or `unisex`. `q` is a prefix full-text search over name, brand, and their aliases, accent-insensitive (`ysl myself` finds YSL MYSLF, `tresor` finds Trésor). If `q` matches nothing at all (not merely nothing after the gender and family filters), a typo-tolerant fallback returns near-misses: a bottle matches when every typed word is within `search.fuzzy_min_similarity` (pg_trgm) of one of its words, ordered by closeness, and the response says `fuzzy: true`. `sort` is `popular` (default: rating votes, high to low), `least-popular` (rating votes, low to high), or `highest-rated` (weighted rating, below); an unknown value is a 400. The sort orders exact results; fuzzy results are ordered by closeness |
| GET | `/api/fragrances/:slug` | Full detail: notes by layer, accords, family profile, strength, tags, rating |
| GET | `/api/notes?q=` | Autocomplete. Mapped notes only (`mapped = true`) |
| POST | `/api/pairing/notes` | Body `{ notes: string[], goal }`. Mapped notes only; rejects an unmapped input note. Returns ranked notes with score 0-100 and the dominant family of each |
| GET | `/api/pairing/fragrances/:slug?goal=&page=&owned=&ownedOnly=` | Ranked partners from `pair_scores`. `owned` = comma list of IDs to flag. `ownedOnly=true` returns only those partners, searched across the whole list, with their full-list ranks; `total` stays the whole list size and `matching` counts what the filter returns |
| GET | `/api/pairing/fragrances/:slug/rank/:partnerSlug?goal=` | Returns `{ status: "ranked", rank, total, score }` for the "#38 of 999" search. `total` is the real size of that base's list for the goal, so Soften shows e.g. "#12 of 214". If the partner is not in the list (Soften only: it is as harsh or harsher than the base), return `{ status: "too_harsh", total }` and the UI says "too harsh to soften this base". Never a missing rank or a 404 for a valid slug |
| GET | `/api/families` | The 14 families for the About page and profile card |

**Weighted rating (the "Highest rated" sort).** `(votes × rating + m × mean) / (votes + m)`. `mean` is the average community rating of the whole catalogue (not of the filtered list, so a bottle's score does not change with the filters) and `m` is `browse.rating_weight_votes` in `scoring.yaml` (10,000, about the catalogue's median vote count). A bottle needs roughly `m` votes before its own rating counts as much as the average, so a bottle with few votes and a perfect score cannot top the list. Ties break by votes, then id. A bottle with no rating sorts last.

### Pass 2

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup` | email, display name, password ≥ 10 chars (and ≤ 72 bytes, bcrypt's limit). Rate-limit 5 per hour per IP |
| POST | `/api/auth/login` | Rate-limit 5 attempts per 15 min per IP + email |
| POST | `/api/auth/logout` | Clears cookie. The token is not revoked (known limitation, DECISIONS B31) |
| GET | `/api/auth/me` | Current user or 401 |
| GET | `/api/collection` | The signed-in user's whole collection, in the guest store's item shape (M7; DECISIONS B31) |
| GET/PUT/DELETE | `/api/collection/:fragranceId` | status own or want |
| POST | `/api/collection/import` | Guest import on sign-in |
| GET/PUT | `/api/profile/taste` | Read and edit the taste profile |
| POST | `/api/chat` | See section 8 |
| POST | `/api/concierge` | See section 9 |
| GET/POST/PUT/DELETE | `/api/fragrances/:id/reviews` | One review per user per fragrance |
| PUT | `/api/pair-ratings` | Store only |

Auth: bcrypt cost 12. JWT signed with `JWT_SECRET`, 7-day expiry, in an httpOnly, Secure, SameSite=Lax cookie. Add `helmet` and a CORS allowlist from `CORS_ORIGIN` (production value: `https://scense.name`). Express trusts exactly one proxy hop (Caddy), so rate limits see the visitor's address (DECISIONS B31).

---

## 8. Chatbot

Goal: turn plain descriptions into a taste profile, then recommend from the catalogue. The model translates words into weights. **The server picks every fragrance. The model never names a fragrance.**

Flow per user message:

1. `caps.ts` checks the cap (section 10). Over the cap returns 429 with a friendly message.
2. Send the model: a system prompt listing the 14 families with one-line descriptions, the 6 facets, a short descriptor glossary (for example "stings the nose" → spicy, "smells like a clean shirt" → Soft Floral + powdery, "like the beach" → Water), the current taste profile, and the conversation so far.
3. Require this JSON back, validated with Zod. Retry once on invalid JSON, then fail gracefully:

```json
{
  "reply": "string, under 120 words, explains which notes the user is describing",
  "profile_update": { "families": { "Woody Amber": 0.6 }, "facets": { "spicy": 0.5, "smoky": -0.4 } },
  "summary": "You lean toward warm spicy scents and avoid smoky ones.",
  "ready_to_recommend": true
}
```

4. Merge: new weight = clamp(0.6 × old + 0.4 × update, -1, 1). Save to `taste_profiles` (users) or return it to the client (guests).
5. When `ready_to_recommend` is true, `recommend.ts` scores every fragrance: cosine similarity between the taste vector (14 families + 6 facets) and the fragrance vector (profile + facets). Return up to 3 owned matches first, then up to 3 non-owned matches that score higher than the best owned match.
6. The UI shows the reply, the recommendation cards, and the updated taste profile card.

The disclaimer under the input: "You get one chat per day, up to 8 messages. Recommendations come from our catalogue only."

---

## 9. Concierge

Slots: `occasion`, `time_of_day` (day or night), `season` (or weather), `setting` (indoor or outdoor), `projection` (low, medium, high).

1. The model reads the user's free text and returns `{ slots: {...}, missing: [...], next_question, question_options }`. Only fill a slot when the user stated it or it follows directly ("dinner at 8" → night).
2. If a slot is missing, ask one question at a time. Projection uses options: low, medium, high.
3. When all slots are filled, `recommend.ts` scores candidates:
   - Candidates = the user's Own list. If it is empty, use the full catalogue and ignore Want and Own.
   - score = 0.30 × season share + 0.20 × day/night share + 0.20 × projection fit + 0.20 × occasion fit + 0.10 × taste similarity.
   - Projection fit: low wants strength 1-2, medium 2-3, high 3-4. Full credit inside the band, 0.5 one step out, 0 beyond.
   - Occasion fit: cosine similarity between the fragrance profile and the occasion's family preferences from `occasions.yaml` (office, date night, wedding, casual day, gym or outdoors, night out, formal event, interview).
4. Return the top pick and 2 alternatives. The model writes one sentence per pick explaining the fit, using only the structured facts the server passes in.

Same cap and disclaimer pattern as the chatbot.

---

## 10. AI caps and cost controls

- Each subject (`user:<id>` or `guest:<uuid>`) gets **one conversation per feature per day**, up to **8 user messages**. The day resets at midnight America/Toronto.
- Site-wide backstop: `GUEST_DAILY_CONVERSATION_CAP` (default 100) total guest conversations per day across both features. Over the cap, guests see "Today's guest demos are used up. Sign up or come back tomorrow."
- `max_tokens` 400 per call. Trim conversation history to the last 8 turns.
- Log tokens in `llm_usage`. Add `GET /api/admin/usage` behind an `ADMIN_TOKEN` header for Tejas.

---

## 11. Frontend

Pages:

| Route | Content |
|---|---|
| `/` | Pairing. Tabs: Notes or Fragrance. Goal toggle: Enhance or Soften. Results list with score bars, "Owned" badges, an "Owned only" filter, and a search box that jumps to any fragrance's rank. The page opens with nothing selected: an empty search box and a short prompt in the results area. A shared `?f=<slug>` link still preloads that fragrance |
| `/browse` | Catalogue grid with search, gender and family filters, and a sort control (Most popular, the default; Least popular; Highest rated). Search, filters, sort, and page live in the URL; the default sort stays out of it |
| `/f/:slug` | Fragrance page: pyramid, accords as bars, family profile as a small wheel chart, strength, tags, rating, Want/Own buttons, reviews (pass 2), "Pair this" button |
| `/chat` | Chatbot with the taste profile card beside it |
| `/concierge` | Concierge chat with question chips |
| `/me` | Collection tabs (Own, Want) and the editable taste profile card |
| `/about` | How the scoring works: the wheel, ring distance, Enhance vs Soften, with a diagram. Recruiters read this page |
| `/login`, `/signup` | Pass 2 |

Taste profile card: top 3 positive families and facets in plain words, top 2 negatives, the summary line, and an Edit mode with sliders from -1 to 1. Saving updates storage or the API.

Header: Scense wordmark, nav, "Sign in" in the top right. Footer on every page: "Fragrance data from the Fragrantica community via the Decant dataset. Not affiliated with Fragrantica."

### Design reference

- `design/figma-make/src/App.tsx` and `design/figma-make/src/index.css` are the visual source of truth for the pairing page (`/`). Match its layout, colours, fonts (Cormorant Garamond for display, Inter for body), and spacing. The folder is a reference only. Do not import from it or build it.
- Two rules on the pairing page override the Figma design:
  - In Notes mode, the results summary reads "[N] notes ranked to [enhance/soften] [selected notes]." It never mentions fragrances or a base bottle.
  - The "Find my bottle's rank" finder only appears in Fragrance mode. Hide it in Notes mode.
  - Match cards show the dominant family only (for example "Woody Amber"). Drop the Figma placeholder's concentration label ("Woody Amber · Eau de toilette"); the dataset has no concentration.
- Display labels differ from stored values: `male` shows "Men", `female` shows "Women", `autumn` shows "Fall".
- Pull the colours and fonts into Tailwind v4 theme tokens in `index.css` so every page shares them.
- Pages without a design (browse, fragrance page, chat, concierge, collection, about) reuse the same tokens and components.
- Treat the export's data as placeholders: the hardcoded matches, Unsplash images, and example copy. Real data comes from the API and `image_url`.
- Keep the existing rules: works at 375px, keyboard accessible, no layout shift on results load.
- Every fragrance search dropdown (the pairing base picker and the rank finder) shows a small bottle thumbnail beside each name, drawn by the same component as the result cards, so a missing photo gets the same drawn bottle. The thumbnail's frame has a fixed size, so the list does not jump as photos load. Note dropdowns have no thumbnails (notes have no bottle), and Browse has no dropdown: its search filters the grid.

---

## 12. DevOps

### Local
`docker compose up` starts Postgres, the API with hot reload, and Vite. A `Makefile` wraps common commands: `make dev`, `make test`, `make pipeline`, `make tune`, `make migrate`.

### CI (`ci.yml`, on every pull request and push)
Lint (ESLint, Ruff), typecheck, run API, web, and pipeline tests, build both Docker images.

### Deploy (`deploy.yml`, on push to `main`)
1. Build API and web images, push to GitHub Container Registry.
2. SSH to EC2 with `appleboy/ssh-action`, `docker compose -f docker-compose.prod.yml pull && up -d`.
3. Run migrations in the API container.
4. Curl `https://scense.name/api/health`. Fail the job if it doesn't return 200 within 60 seconds.

### Production (`docker-compose.prod.yml`)
- `caddy`: TLS via Let's Encrypt for `scense.name` and `www.scense.name`, serves the web build, proxies `/api` to the API. `scense.name` is the main address; `www.scense.name` returns a permanent redirect to it.
- `api`: the Node 24 image.
- `db`: `postgres:16` with a named volume, not exposed outside the Docker network.
- `backup`: nightly `pg_dump` to an S3 bucket, keep 14 days.

### Caddyfile

```
scense.name {
	encode gzip
	handle /api/* {
		reverse_proxy api:3000
	}
	handle {
		root * /srv/web
		try_files {path} /index.html
		file_server
	}
}

www.scense.name {
	redir https://scense.name{uri} permanent
}
```

DNS: an A record for `scense.name` and another for `www.scense.name`, both pointing at the EC2 Elastic IP.

### Node version
Pin Node 24 in every place it can drift:
- `.nvmrc` at the repo root contains `24`.
- `api/package.json` and `web/package.json` set `"engines": { "node": ">=24 <25" }`.
- Dockerfiles build from `node:24-alpine`.
- `ci.yml` and `deploy.yml` use `actions/setup-node` with `node-version-file: .nvmrc`.

### Secrets (GitHub Actions secrets and an `.env` on the server)
`DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `CORS_ORIGIN`, `GUEST_DAILY_CONVERSATION_CAP`, `ADMIN_TOKEN`, `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, `AWS_BACKUP_BUCKET`.

**Never commit a secret. Never ask Tejas to paste a secret into chat.** Tell him which secret to create and where.

---

## 13. Milestones

Stop after each one. Report: what you built, files to read first, commands to run, and anything Tejas needs to do.

### Pass 1
| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold: repo layout, Docker Compose dev, Makefile, lint configs, empty CI | `make dev` serves a hello page and `/api/health` returns 200; CI passes |
| M1 | Data inspection and mapping drafts | `DATASET_NOTES.md`, `accord_map.csv`, `note_map.csv` drafted. **Stop for Tejas to review mappings** |
| M2 | Profiles, scoring, precompute, load | All section 3.6 tests pass; `make tune` prints both top-10 lists |
| M3 | Pass 1 API | All pass 1 endpoints with tests |
| M4 | Pairing UI, browse, fragrance pages, about page | Full pass 1 flow works in the browser |
| M5 | Guest mode | Own/Want persist across reloads; storage failure banner works |
| M6 | Production deploy | Live HTTPS site; deploy on push to `main`; nightly backup runs. The API image carries its own copy of `pipeline/config/scoring.yaml` (built from the repo root: `docker build -f api/Dockerfile .`), so `docker-compose.prod.yml` and `deploy.yml` must build the API with the repo root as context and mount nothing |
| M6.1 | Usability fixes from watching real users | Pairing opens empty with a prompt; search understands brand abbreviations, name misspellings, and typos; fragrance dropdowns show bottle thumbnails; Browse has a sort control. Alias, typo-fallback, and sort tests pass |
| M6.2 | Catalogue grows from 300 to 1,000 | Existing ids unchanged (tested); mappings reviewed; section 3.6 tests pass; `seed-prod.ps1` checks ids and ships the larger catalogue |

### Pass 2
| # | Milestone | Done when |
|---|---|---|
| M7 | Accounts, collection API, and guest import | Signup, login, logout, import; a signed-in user's Own and Want save to the account; auth and rate-limit tests pass; a reseed keeps user data (tested). The collection API moved here from M8 so the site never shows sign-in with browser-only saves (DECISIONS B31) |
| M8 | Reviews and pair ratings | Guests blocked; one review per user per fragrance |
| M9 | Chatbot, taste profile card, caps | Cap enforced at message 9 and at the guest site-wide cap; JSON validation tested with mocked LLM responses |
| M10 | Concierge | Asks for missing slots; empty-collection fallback works |
| M11 | Polish | Playwright smoke tests (pair a fragrance, chat once, concierge once); README skeleton with setup steps; Lighthouse accessibility ≥ 90 |

---

## 14. Rules for the build

- Put every tunable number in a config file.
- Mock the Anthropic API in tests. Never call it from CI.
- Keep functions under about 40 lines. Split them otherwise.
- After each milestone, list 3 to 5 "explain it back" questions Tejas should answer about the code you wrote.
- If the spec conflicts with what the dataset contains, stop and ask. Do not guess.
- If a decision is missing from this spec, pick the simplest option, note it in `DECISIONS.md` under "Build-time decisions," and flag it in your milestone report.
