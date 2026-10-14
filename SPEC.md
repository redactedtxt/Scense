# SPEC.md: Scense, a Fragrance Layering App

You are Claude Code. This file is the source of truth for the build. Read it in full before writing code. Build one milestone at a time, in order. After each milestone, stop, summarise what you built, list the files a reviewer should read first, and wait for Tejas to approve before starting the next one.

Tejas reviews all code but does not write it. Write code a third-year CS student can read: clear names, short functions, a comment above every non-obvious block explaining *why*, not *what*.

---

## 1. What the app does

A fragrance catalogue with a layering engine at its centre.

1. **Pairing (the centerpiece).** You enter one or more notes, or one fragrance, and pick a goal: **Enhance** or **Soften**. Notes return a ranked list of notes. A fragrance returns a ranked list of fragrances. You can search the fragrance list for any bottle and see its rank ("Les Sables Roses: #38 of 299").
2. **Catalogue.** Browse and search 150 to 300 fragrances. Each page shows the note pyramid, accords, strength, season and day/night tags, community rating, and vote count.
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
├── db/migrations/                # 001_init.sql, 002_accounts.sql, ...
├── pipeline/
│   ├── raw/                      # Kaggle files, gitignored
│   ├── config/
│   │   ├── scoring.yaml          # every tunable number lives here
│   │   ├── families.yaml         # 14 wheel families, ring positions, harshness
│   │   ├── facets.yaml           # facets and harshness nudges
│   │   ├── accord_map.csv        # dataset accord -> family weights + facets
│   │   ├── note_map.csv          # note -> family weights + facets
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

- `accord_map.csv` columns: `accord, family_weights, facets`. Example row: `warm spicy, "Woody Amber:0.6;Soft Amber:0.4", "spicy"`. Weights in a row sum to 1.
- `note_map.csv` columns: `note, family_weights, facets`. Cover the 150 most frequent notes in the filtered catalogue.

Draft both files from perfumery knowledge, then **stop and ask Tejas to review them** before moving on. Mark any row you feel unsure about with a `# CHECK` comment column.

### 3.4 Fragrance profile

For each fragrance:

1. `p` = a 14-value vector. For each accord with strength `s` (0 to 100), add `s × weight` to each mapped family. Normalise so `p` sums to 1. If a fragrance has no accords, build `p` from its notes with equal weight per note.
2. `facets` = a 6-value vector. Each facet's value = (sum of strengths of accords tagged with it) / (sum of all accord strengths). Range 0 to 1.
3. `harshness` = clamp(Σ pᵢ × familyHarshnessᵢ + Σ facet_f × nudge_f, 0, 1).
4. `strength` (integer 1 to 4):
   - If the fragrance has 50 or more longevity votes plus sillage votes: convert each vote distribution to a 0 to 1 weighted mean (weakest bucket = 0, strongest = 1), average the two, and bin: `<0.25 → 1`, `<0.5 → 2`, `<0.75 → 3`, else `4`.
   - Otherwise fall back to concentration: EDC or Eau Fraîche = 1, EDT = 2, EDP = 3, Parfum, Extrait, or Elixir = 4. Unknown = 2.
   - Store which source you used in `strength_source`.
5. Season tags and day/night tags come from the dataset's season and time-of-day votes. Store each as a share from 0 to 1 (`winter, spring, summer, fall, day, night`).

### 3.5 Scoring

Ring distance between families i and j: `d = min(|i - j|, 14 - |i - j|)`, range 0 to 7.

Affinity tables (in `scoring.yaml`):

| d | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| enhance | 1.0 | 0.9 | 0.7 | 0.45 | 0.25 | 0.15 | 0.1 | 0.05 |
| soften | 0.2 | 0.4 | 0.6 | 0.8 | 0.9 | 0.85 | 0.75 | 0.6 |

Base score for base A and partner B:

```
base(A, B) = Σᵢ Σⱼ pAᵢ × pBⱼ × M_goal[d(i, j)]
```

Precompute the 14 × 14 matrix `M_goal[d(i,j)]` once so this becomes `pA · M · pB`.

Goal rules:

- **Enhance:** score = base. If strength(B) > strength(A) + 1, multiply by 0.8 (the partner takes over).
- **Soften:** drop B if harshness(B) ≥ harshness(A). Otherwise score = base × (1 + harshness(A) - harshness(B)). If strength(B) < strength(A) - 1, multiply by 0.7 (the partner gets buried).

Scores get normalised to 0 to 100 within each base fragrance's list for display. Every constant above lives in `scoring.yaml`. Nothing gets hardcoded.

**Notes** use the same formula. A note's profile comes from `note_map.csv`, its harshness from section 3.4 step 3. Multi-note input: average the input notes' profiles and harshness. Exclude input notes from results. Return single notes only. The API computes note scores at request time (150 notes is cheap).

**Fragrances** get precomputed: about 300 × 299 × 2 rows in `pair_scores` with a rank per (base, goal).

### 3.6 Sanity tests the pipeline must pass

Write these as pytest cases:

- `d(13, 0) == 1`, `d(0, 7) == 7`, `d(3, 10) == 7`.
- Profiles sum to 1 within 1e-6.
- Enhance score of a fragrance with itself beats its score with any fragrance whose dominant family sits at distance 4 or more.
- For Armaf Club de Nuit Intense Man, Soften: at least 7 of the top 10 partners have Amber, Soft Amber, or Floral Amber, or a `sweet` or `powdery` facet above 0.2. If this fails, print the top 10 and stop. Tejas will tune.
- Soften never returns a partner with equal or higher harshness.

---

## 4. Data pipeline (Python, offline)

Tejas downloads the Decant Kaggle dataset ("Fragrantica Perfumes: Ratings, Notes, Votes & More", kaggle.com/datasets/ledecanteur/fragrantica-perfumes) into `pipeline/raw/`.

1. `inspect_dataset.py`: print the schema, column names, nested field shapes, and 3 sample rows. **Do not assume column names anywhere. Read them here first** and write a short `pipeline/DATASET_NOTES.md` describing the fields you will use.
2. `ingest.py`: filter to the top 300 fragrances by total rating votes across men's, women's, and unisex. Drop rows missing both accords and notes. Output a clean parquet file.
3. `profiles.py`: build `p`, facets, harshness, strength, season and day/night shares.
4. `scoring.py`: ring distance, matrix build, pair scoring, goal rules. Pure functions, fully unit tested.
5. `precompute.py`: all fragrance pairs for both goals, ranks included.
6. `load.py`: upsert everything into Postgres in one transaction. Re-runnable.

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
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  gender TEXT,                        -- men, women, unisex
  release_year SMALLINT,
  concentration TEXT,
  image_url TEXT,
  community_rating REAL,
  rating_votes INTEGER,
  profile REAL[14] NOT NULL,
  facets JSONB NOT NULL,              -- {"sweet":0.3,...}
  harshness REAL NOT NULL,
  strength SMALLINT NOT NULL CHECK (strength BETWEEN 1 AND 4),
  strength_source TEXT NOT NULL,      -- votes | concentration
  seasons JSONB NOT NULL,             -- {"winter":0.4,...}
  daynight JSONB NOT NULL,            -- {"day":0.3,"night":0.7}
  search_vector TSVECTOR
);
CREATE INDEX fragrances_search_idx ON fragrances USING GIN (search_vector);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  profile REAL[14] NOT NULL,
  facets JSONB NOT NULL,
  harshness REAL NOT NULL
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

Migration `002_accounts.sql` (pass 2):

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
| GET | `/api/fragrances?q=&gender=&family=&page=` | Full-text search on name and brand, 24 per page |
| GET | `/api/fragrances/:slug` | Full detail: notes by layer, accords, family profile, strength, tags, rating |
| GET | `/api/notes?q=` | Autocomplete |
| POST | `/api/pairing/notes` | Body `{ notes: string[], goal }`. Returns ranked notes with score 0-100 and the dominant family of each |
| GET | `/api/pairing/fragrances/:slug?goal=&page=&owned=` | Ranked partners from `pair_scores`. `owned` = comma list of IDs to flag |
| GET | `/api/pairing/fragrances/:slug/rank/:partnerSlug?goal=` | Returns `{ rank, total, score }` for the "#38 of 299" search |
| GET | `/api/families` | The 14 families for the About page and profile card |

### Pass 2

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup` | email, display name, password ≥ 10 chars |
| POST | `/api/auth/login` | Rate-limit 5 attempts per 15 min per IP + email |
| POST | `/api/auth/logout` | Clears cookie |
| GET | `/api/auth/me` | Current user or 401 |
| GET/PUT/DELETE | `/api/collection/:fragranceId` | status own or want |
| POST | `/api/collection/import` | Guest import on sign-in |
| GET/PUT | `/api/profile/taste` | Read and edit the taste profile |
| POST | `/api/chat` | See section 8 |
| POST | `/api/concierge` | See section 9 |
| GET/POST/PUT/DELETE | `/api/fragrances/:id/reviews` | One review per user per fragrance |
| PUT | `/api/pair-ratings` | Store only |

Auth: bcrypt cost 12. JWT signed with `JWT_SECRET`, 7-day expiry, in an httpOnly, Secure, SameSite=Lax cookie. Add `helmet` and a CORS allowlist from `CORS_ORIGIN` (production value: `https://scense.name`).

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
| `/` | Pairing. Tabs: Notes or Fragrance. Goal toggle: Enhance or Soften. Results list with score bars, "Owned" badges, an "Owned only" filter, and a search box that jumps to any fragrance's rank |
| `/browse` | Catalogue grid with search and filters |
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
- Pull the colours and fonts into Tailwind v4 theme tokens in `index.css` so every page shares them.
- Pages without a design (browse, fragrance page, chat, concierge, collection, about) reuse the same tokens and components.
- Treat the export's data as placeholders: the hardcoded matches, Unsplash images, and example copy. Real data comes from the API and `image_url`.
- Keep the existing rules: works at 375px, keyboard accessible, no layout shift on results load.

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
| M6 | Production deploy | Live HTTPS site; deploy on push to `main`; nightly backup runs |

### Pass 2
| # | Milestone | Done when |
|---|---|---|
| M7 | Accounts and guest import | Signup, login, logout, import; auth tests pass |
| M8 | Reviews, pair ratings, collection API | Guests blocked; one review per user per fragrance |
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
