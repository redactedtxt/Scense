# DECISIONS.md

Every major decision on this project, why we made it, what we rejected, and when to revisit it. Use this file to prepare for interviews: each entry answers "why did you build it this way?"

---

## Product

### 1. Portfolio piece first, built to grow
- **Decision:** Build for a recruiter's 60-second look, with a structure that can grow into a real product.
- **Why:** The near-term goal is a software or DevOps internship. A focused, working demo beats a sprawling half-finished one.
- **Rejected:** Launching as a public product with thousands of fragrances, moderation, and paid hosting.
- **Revisit when:** Real users start arriving.

### 2. Pairing as the centerpiece
- **Decision:** The layering engine gets the homepage and the most polish.
- **Why:** No existing site ranks layering partners with a score you can explain. It's the feature that makes the project original, and it rests on real math you can walk through in an interview.
- **Rejected:** Leading with the chatbot. Chatbots are common in portfolios and harder to show off in a minute.

### 3. Layering only, with two goals: Enhance or Soften
- **Decision:** "Pairing" means spraying two scents at once. You pick Enhance (amplify the base) or Soften (tone it down).
- **Why:** The project started from a real problem: Club de Nuit Intense Man runs harsh, and no guide explained what to layer it with. Two goals keep the interface simple and map onto the fragrance wheel's neighbour and opposite rule.
- **Rejected:** One universal score (hides the user's intent), a longer goal list like brighten or sweeten (more to tune in a week), and spray ratios (no data to back them).

### 4. Notes return notes, fragrances return fragrances
- **Decision:** No mixing result types. Multi-note input returns single notes.
- **Why:** Mixed lists confuse the reader. Note combinations explode: 150 notes make over 11,000 pairs, and the results get hard to read.

### 5. Rank only, no layering instructions
- **Decision:** Results show a rank and a score. No spray order or spray counts.
- **Why:** Nothing in the data supports a spray ratio. Inventing one would undermine trust in the rest of the ranking.

### 6. Open on the pairing page in guest mode
- **Decision:** No login wall. "Sign in" sits in the corner.
- **Why:** A recruiter facing a signup screen often leaves. Guest mode already covers Own and Want, so the wall cost visitors and bought nothing.
- **Rejected:** A login-first screen with a "Try the demo" button. It was the original plan, changed after review.

### 7. Guest mode stored in the browser
- **Decision:** Guests get a UUID and a profile in localStorage. No shared demo account on the server.
- **Why:** Each visitor gets a private sandbox. A shared server account would collect every recruiter's clicks and need a nightly reset job.
- **Tradeoff:** Guest data stays on one device and vanishes if the browser clears storage.

### 8. Guests can use Own and Want, but cannot review or rate pairs
- **Why:** Reviews and ratings need an accountable author. Blocking guests stops spam without moderation tools.

### 9. Show the taste profile, and let users edit it
- **Decision:** A visible card shows what the chatbot learned ("You lean toward warm spicy notes").
- **Why:** It shows a recruiter the AI translation, the wheel mapping, and the data model in one glance. Users can also fix a wrong guess.
- **Rejected:** A hidden profile. It was the original plan, changed after review because it hid the project's best moment.

### 10. Show community ratings now, written reviews in pass 2
- **Decision:** Every fragrance page shows the dataset's community rating and vote count. Written reviews arrive in pass 2.
- **Why:** A portfolio site gets few real users, so a reviews section would read "No reviews yet" on almost every page and look unfinished.

### 11. Collect pair ratings, but don't feed them into scores yet
- **Why:** A handful of ratings would add noise. Collecting now builds a dataset for a later learning step and gives an interview story about where the model goes next.

### 12. Concierge suggests from the Own list, or the whole catalogue if it's empty
- **Why:** The concierge answers "what should I wear tonight," so it picks from bottles you have. An empty collection falls back to the catalogue so a new user still gets an answer. Want stays out because you can't wear it tonight.

### 13. Concierge takes free text and asks follow-ups
- **Why:** Typing "dinner downtown, cold night, date" feels natural. The AI asks one question at a time for anything missing, like projection, instead of showing a long form.

### 14. Dropped wear-history tracking
- **Why:** It needed a logging flow and added complexity for little demo value.

---

## Data

### 15. Use the Decant Kaggle dataset
- **Decision:** All fragrance facts come from a Fragrantica-derived dataset published on Kaggle.
- **Why:** It wins on accuracy. Fragrantica's accords, longevity, sillage, and season data come from thousands of community votes. LLM-drafted notes mix up flankers, such as the regular and Intense versions of a scent.
- **Rejected:** LLM-drafted data (inaccurate), live scraping (against Fragrantica's terms), the Noteboxd API (50 free calls a day makes seeding 300 fragrances take six days).
- **Risk:** The dataset's license could not be confirmed. Fine for a portfolio. Replace or license the data before charging anyone.
- **Courtesy:** The footer credits Fragrantica as the data source.

### 16. Starter catalogue of 150 to 300 fragrances, all genders
- **Superseded by B27:** the catalogue is now the 1,000 most-voted fragrances.
- **Why:** That size covers most popular searches and keeps a one-week build manageable. Women's scents give Soften more partners, since a rose or powdery floral can round off a harsh woody scent.

### 17. Strength from longevity and sillage votes only
- **Decision:** Strength on a 1 to 4 scale comes from community longevity and sillage votes, binned with cutoffs in `scoring.yaml`. There is no concentration fallback.
- **Why:** Concentration alone rates Club de Nuit Intense Man, an EDT, as moderate, though it performs like a parfum. The votes fix that. The dataset has no concentration field, and every catalogue fragrance has thousands of votes, so a fallback would never run.
- **Revisit when:** The catalogue grows to include low-vote fragrances (the 50-vote guard in ingest will fail first).

### 18. Concierge tags from the dataset's season and day/night votes
- **Why:** Real votes beat rules we would write ourselves.

---

## Pairing model

### 19. Base the model on the Michael Edwards fragrance wheel
- **Decision:** 14 families on a ring. Ring distance drives the scores: close families enhance, far families soften.
- **Why:** The trade uses this wheel as its standard classification, and it gives an explainable model with no training data needed.
- **Limit:** The wheel classifies scents. It doesn't prove a pair smells good. The numbers are a starting point that gets tuned by hand.

### 20. Add facets to patch the wheel's gaps
- **Decision:** Six facets (sweet, creamy, powdery, spicy, smoky, sharp) sit on top of the 14 families.
- **Why:** The wheel has no gourmand family, no spicy family, and no intensity axis. The chatbot needs "you like spicy," and Soften needs a harshness value.

### 21. Precompute fragrance pairs, compute note pairs live
- **Why:** About 179,000 precomputed rows make the "#38 of 299" lookup a single indexed query. 150 notes are cheap enough to score per request. (At 1,000 fragrances the table has 1,498,500 rows; B27.)

### 22. Every tunable number lives in a config file
- **Why:** Tuning happens by spraying real combinations and adjusting numbers. Config files make that a one-line change and a rerun, with no code edits.

---

## AI

### 23. The model translates words, the database picks fragrances
- **Decision:** The LLM turns descriptions into family and facet weights as JSON. The server scores the catalogue.
- **Why:** The model can't invent a fragrance or misstate its notes. Recommendations stay explainable.
- **Rejected:** Mining Reddit live per message (slow, costly, Reddit locked down its API in 2023). A one-time offline Reddit glossary remains a stretch goal.

### 24. Claude Haiku 5.5
- **Why:** Small and cheap, and turning a description into structured weights doesn't need a larger model.

### 25. One conversation per feature per user per day, 8 messages max
- **Why:** The first plan (2 messages a day) broke both features, since the concierge asks follow-ups and chat takes several turns. Separate allowances let a recruiter try both features in one visit while keeping costs low.

### 26. Site-wide daily cap on guest conversations
- **Why:** A guest can clear their browser and get a fresh allowance. The site-wide cap stops one visitor from running up the bill.

---

## Engineering

### 27. React, Node, Python, PostgreSQL
- **Why:** Tejas has shipped React and Node before. The Node API serves the app. Python runs offline jobs only (data cleaning, scoring, precompute), since pandas suits that work and a second live backend would double deploy effort.

### 28. Build auth in-house
- **Decision:** bcrypt password hashes, JWT in an httpOnly cookie.
- **Why:** About a day of work, and it gives interview material on hashing, sessions, and cookie security.
- **Rejected:** AWS Cognito. It saves little time once setup and debugging count.

### 29. DevOps-heavy deploy: Docker, GitHub Actions, one EC2 instance
- **Why:** The project targets DevOps internships too. A real CI/CD pipeline shows more than a one-click host.
- **Rejected:** Amplify plus Elastic Beanstalk (simpler, shows less).

### 30. PostgreSQL in a container on the same EC2 instance
- **Why:** RDS bills monthly once free credits run out, and a portfolio link that dies in six months looks worse than none. A container cuts the cost and still shows the DevOps work. Nightly backups go to S3.
- **Revisit when:** Real users arrive. Move to RDS then.

### 31. Two build passes
- **Decision:** Pass 1: catalogue, pairing engine, guest mode, deploy pipeline. Pass 2: accounts, chatbot, concierge, written reviews.
- **Why:** Pass 1 alone makes a complete demo. If the week runs short, the live site still works.

### 32. AI writes the code, Tejas reviews it
- **Why:** It fits the week. The risk: interviewers ask you to explain and change your project live. The plan builds in "explain it back" checks after each milestone, and the README states the project was built with AI assistance.

### 33. Renamed the app to Scense (2026-10-14)
- **Why:** The name matches the domain. The GitHub repo is named `scense`.

### 34. Bought scense.name as the production domain (2026-10-14)
- **Why:** A short, memorable address for the portfolio link, with `www.scense.name` redirecting to it.

### 35. Switched from Node 20 to Node 24 (2026-10-14)
- **Why:** Node 20 reached end of life in April 2026, and the laptop, Docker images, CI, and server now share one version.

### 36. Designed the pairing page in Figma Make (2026-10-14)
- **Why:** A fixed visual target stops the AI inventing a look, and the export runs on the same React and Tailwind stack.
- **Consequence:** The frontend moves from React 18 to React 19 and from Tailwind CSS to Tailwind v4 (via `@tailwindcss/vite`) to match the export. The export lives in `design/figma-make/` as a reference, not app code.

---

## Build-time decisions

Claude Code adds entries here when it makes a call the spec didn't cover.

### B1. M0 scaffold choices (2026-10-14)
- **Two npm projects, no workspaces.** `api/` and `web/` each have their own `package.json` and lockfile. Simplest option, and each Docker image installs only what it needs.
- **`app.ts` added to the API.** `createApp(db)` builds the Express app from a database object, so tests pass a fake one. `index.ts` only reads config and starts listening.
- **TypeScript 5.9, not 7.** `typescript-eslint` support for the newest major is not guaranteed; 5.9 is what the Figma export uses.
- **Dev-only database password default** (`scense_dev`) in `docker-compose.yml`, so `docker compose up` works without a `.env`. Production uses a real secret.
- **Placeholders for later milestones:** `docker-compose.prod.yml` (comment only), `deploy.yml` (manual trigger, echoes "not built yet"), and the Caddyfile copied from SPEC.md.
- **Windows has no `make`.** `docker compose up --build` is the equivalent of `make dev`.

### B2. M1 mapping drafts (2026-10-14)
- **Mapping CSVs have a fourth `check` column.** SPEC 3.3 asks for `# CHECK` marks but lists three columns. A separate column keeps the other three clean to parse.
- **Read the CSV, not the JSONL, in the pipeline.** It has every field we need and loads far faster.
- **`accord_map.csv` covers the 59 accords in the top 300**, not all 92. Ingest should fail loudly on an unmapped accord instead of skipping it.
- **`note_map.csv` ties and variants:** superseded by B8 (variants are merged; ties go to the larger summed weight).

### B3. Dropped concentration and strength_source (2026-10-14)
- **Decision:** No `concentration` column, no concentration fallback, no `strength_source`; concentration labels are removed from the pairing page.
- **Why:** The dataset has no concentration field, so the fallback could never run and the label could never be filled in.

### B4. Our own slugs: brand-name-year (2026-10-14)
- **Decision:** Slug = lowercase kebab-case `brand-name-year` (`davidoff-cool-water-1988`), year omitted if unknown, dataset id appended only when brand, name, and year all collide inside the catalogue.
- **Why:** The dataset's slug is not unique (two Cool Waters), and a readable slug makes better URLs than an id. Collisions are checked inside the 300 rows so a slug never changes because of an unrelated fragrance.

### B5. Strength cutoffs live in scoring.yaml (2026-10-14)
- **Decision:** `strength_cutoffs: [0.46, 0.54, 0.62]` in `scoring.yaml`, approved by Tejas. They split the top 300 into 75 / 78 / 72 / 75 and put Club de Nuit Intense Man at strength 4.
- **Why:** The spec's fixed 0.25/0.5/0.75 bins put only 14 of 300 fragrances at strength 4, and not Club de Nuit Intense Man.

### B6. Store dataset values, show friendly labels (2026-10-14)
- **Decision:** The database stores `male`, `female`, `unisex`, and `autumn`. The UI shows Men, Women, Unisex, and Fall.
- **Why:** Storing the dataset's own values avoids a translation step in the pipeline; the label mapping lives in one place in the web app.

### B7. Spec example changed to Baccarat Rouge 540 (2026-10-14)
- **Decision:** The "#38 of 299" example uses a fragrance in the top 300.
- **Why:** Les Sables Roses has 2,239 votes and is not in the catalogue, so the example could not be reproduced.

### B8. Note variants merged through note_aliases.csv (2026-10-14)
- **Decision:** Spelling and origin variants map to one canonical note in `pipeline/config/note_aliases.csv`; `note_map.csv` holds 150 canonical notes. Tied candidates at the cutoff go to the larger summed note weight. Tejas approved all merges and added Orris Root and Orris into Iris (Iris is now in 52 of 300 fragrances); Myrrh topped the map back up to 150.
- **Why:** Note pairing would otherwise rank "Vanilla", "Vanille", and "Bourbon Vanilla" as three different partners.

### B9. No sharp facet on the citrus accord (2026-10-14)
- **Decision:** `sharp` stays on the `metallic` and `aldehydic` accords only, plus the Lemon, Grapefruit, Lime, Bitter Orange, Galbanum, and Aldehydes notes.
- **Why:** Tagging every citrus accord would raise the harshness of all citrus-led fragrances, including mild ones.

### B10. Mapping files keep a `check` column the pipeline ignores (2026-10-14)
- **Decision:** `accord_map.csv` and `note_map.csv` carry a fourth `check` column with `# CHECK` remarks. Loaders read named columns only.
- **Why:** The reviewer's notes live next to the rows they are about, without mixing into the data.

### B11. Mapping review completed (2026-10-14)
- **Decision:** Tejas reviewed every `# CHECK` row. Carnation and Anise gained the spicy facet, Opoponax gained sweet, and `aldehydic`/Aldehydes now use Soft Floral:0.6;Floral:0.2;Citrus:0.2. All CHECK markers were cleared.
- **Why:** The reviewed rows are settled; the `check` column stays empty for future remarks.

### B12. M2 supporting files and Windows commands (2026-10-15)
- **Extra files beyond the M2 list:** `ingest.py` (SPEC section 4 step 2; `make pipeline` needs it), `pipeline_config.py` (loads and validates every config file), and `run.py` (one entry point). The config module is not named `config.py` because `pipeline/config/` is a folder and Python could import the folder instead.
- **No `make` on Windows.** `python pipeline/src/run.py pipeline|tune|migrate` does what `make pipeline|tune|migrate` does; the Makefile calls the same script. Run it with the pipeline virtual environment (`pipeline\.venv`).
- **Pipeline output goes to `pipeline/build/catalogue.parquet`** (gitignored). Nested fields are stored as JSON strings so the file has no pyarrow-specific nesting. `pyarrow` is a new dependency.
- **Catalogue tests skip when the parquet is missing.** The raw Kaggle file is gitignored, so CI runs the pure tests only; the catalogue tests run locally after `pipeline`.

### B13. Scoring details the spec left open (2026-10-15)
- **Display score = score / best score in that base's list x 100** (not min-max), so 100 is the best partner and ratios between partners are kept. Ranks come from the raw score; ties break by catalogue order.
- **A fragrance is never its own partner**, so Enhance has 299 rows per base. Soften has fewer: partners as harsh or harsher are dropped, and a base with no gentler partner has an empty list. `pair_scores` therefore has 134,550 rows, not about 179,000.
- **"Dominant family" = the largest share in `p`**; a tie goes to the lower ring position. The Club de Nuit test checks the dominant family against Amber, Soft Amber, and Floral Amber.
- **Note facets are 1 or 0** (tagged or not) before the harshness formula. A fragrance built from notes alone (never happens in the top 300) averages its mapped notes' profiles and facets.
- **Duplicate note variants are merged per layer.** The same note in both top and base layers stays in both.
- **Unmapped notes are stored too:** superseded by B16.
- **`search_vector` is a `simple` tsvector**, filled by `load.py`. The API search in M3 must use the same `simple` configuration. It now also holds aliases: B23.
- **Two alias targets are deliberately unmapped:** Pine Needles and Tiare Flower fell outside the 150-note cutoff.

### B14. Enhance score is normalised by self-similarity (2026-10-15)
- **Decision:** Enhance base score = `pA·M·pB / sqrt(pA·M·pA × pB·M·pB)`. Soften's formula is unchanged.
- **Why:** Enhance means "more of what you have", so a fragrance and its near-clones should score highest. The plain formula failed the SPEC 3.6 self-score test for 94 of 300 fragrances (1,197 pairs), because diffuse profiles scored higher with a more concentrated partner than with themselves. The SPEC 3.6 test stays as written and now passes.
- **Effect:** superseded by B17, which kept the normalisation and changed the rest of Enhance.
- **Rejected:** Weakening the test to compare only whole-profile-distant partners (kept the model, but would have left a score that rewards concentration).

### B15. Soften list totals vary, and a dropped partner gets an answer (2026-10-15)
- **Decision:** The rank search shows the real list size ("#12 of 214"). A partner that Soften dropped returns a `too_harsh` result, not a missing rank.
- **Why:** Soften drops partners as harsh or harsher than the base, so "of 299" would be false and a bare "no rank" would look like a bug. Recorded in SPEC.md section 7 for M3.

### B16. Every note is stored; only mapped notes are paired (2026-10-15)
- **Decision:** `notes` holds every note in the catalogue (394 today: 150 mapped, 244 not). `mapped` marks the ones in `note_map.csv`; profile, facets, and harshness are null for the rest, enforced by a CHECK constraint. `fragrance_notes` links all of them. Note pairing and note autocomplete use mapped notes only.
- **Why:** The fragrance page must show a fragrance's full pyramid, but unmapped notes have no wheel profile.
- **Migration:** `001_init.sql` was edited in place (nothing was deployed); the dev database was dropped and recreated.

### B17. Enhance retuned for near-clones (2026-10-15)
Diagnosed with Club de Nuit Intense Man, a well-known Aventus alternative, which sat at #221 of 299 in Aventus's Enhance list. Five variants were tried in memory before choosing (A: no penalty, B: sharper table, C: facets, D: B + C, E: all three); E put Club de Nuit at #2 and Afnan Supremacy Collector's Edition, another Aventus alternative, at #5. Both SPEC 3.6 tests passed under every variant.
- **Removed the Enhance strength penalty.** A stronger near-clone amplifies the base, which is what Enhance means. The ×0.8 takeover rule predates that definition, and it alone pushed Club de Nuit (strength 4 vs Aventus 2) from similarity 0.94 to about #221; removing only the penalty moved it to #49.
- **Sharpened the Enhance table to 1.0, 0.6, 0.3, 0.1, 0, 0, 0, 0.** With the old table (1.0 ... 0.05) scores were flat: 35 of 299 partners above 0.95 similarity to Aventus, median 0.87, so one small multiplier reshuffled the list. The old matrix also had a negative eigenvalue (−0.054), so "a fragrance scores highest with itself" held only by luck of the data. The new matrix's smallest eigenvalue is +0.2, and a test now requires the Enhance matrix (and the 20×20 kernel) to stay positive definite.
- **Facets joined fragrance similarity** (14 families + 6 facets, `enhance.facet_weight: 1.0`, each facet matched only to itself). Aventus and Club de Nuit differ in their lead family (Fruity vs Citrus) but share their character: smoky 0.21 vs 0.22 and a sweet facet. Families alone missed that.
- **Notes stay on families only.** A note's facets are 0 or 1, so on the same scale as family shares they would outweigh the families and rank notes by facet tag alone.

### B18. M3 API choices the spec left open (2026-10-15)
- **Note scoring reads `pipeline/config/scoring.yaml` at startup** (new `SCORING_CONFIG_PATH`, default `../pipeline/config/scoring.yaml`; new dependency `yaml`). One file feeds both the pipeline and the API, so tuning a number cannot leave note scores and fragrance scores disagreeing. The API Dockerfile copies the file into the image (build context is now the repo root, with `api/Dockerfile.dockerignore` keeping the upload small), so production needs no mount. In dev, `docker-compose.yml` still bind-mounts `pipeline/config` read-only over that copy so a tuning edit shows up without a rebuild.
- **Notes have no strength, so Soften's "buried partner" penalty is skipped for notes.** Everything else (drop if not gentler, boost by the harshness gap) matches the fragrance rules.
- **Endpoints that use mapped notes only:** `GET /api/notes` and `POST /api/pairing/notes`. An unmapped note in a pairing body returns 400 `unmapped_note`; a name we have never heard of returns 400 `unknown_note`. The fragrance detail endpoint still returns unmapped notes (flagged `mapped: false`) so the pyramid is complete.
- **Rank endpoint:** `ranked` carries `rank`, `total`, `score`; `too_harsh` carries `total`. Asking for a fragrance's rank against itself returns 400 `same_fragrance` (it is in no list). An unknown slug on either side is a 404.
- **JSON field names are camelCase** (`ratingVotes`, `dominantFamily`); stored values stay as the dataset gives them (`male`, `autumn`).
- **Search is prefix-matching** ("cool wat" finds Cool Water) using the `simple` text-search config that `load.py` used; results are ordered by rating votes. `family` filters on the dominant family by name, case-insensitive; an unknown family is a 400.
- **Lists are 24 per page.** Pairing list pages use the same size. Note pairing returns every ranked note in one response (at most 149).
- **Scores are rounded to one decimal** in responses; ranks come from the unrounded values.
- **Up to 10 input notes** per pairing request, 300 ids in `owned`.
- **Tests:** unit and fake-database endpoint tests run everywhere (CI included). `integration.test.ts` runs the real SQL against the loaded catalogue and is skipped unless `TEST_DATABASE_URL` is set. CI has no database yet; adding a Postgres service plus `pipeline` load to CI is a later option.

### B19. Bottle images are hotlinked from Fragrantica, with a drawn fallback (2026-10-15)
- **Decision:** For the portfolio demo, each fragrance's `image_url` (Fragrantica's image server, `fimgs.net`) loads directly in the browser. If an image fails to load, the page draws a placeholder bottle tinted by the fragrance's dominant family, in the same fixed-size frame, so nothing moves.
- **Why:** The dataset already carries an image URL for all 300 fragrances, and a catalogue without bottles looks unfinished. The fallback covers the day Fragrantica blocks hotlinking (images are requested with `referrerPolicy="no-referrer"`, which avoids the most common referrer check).
- **Risk:** Same as the dataset (decision 15): the images are Fragrantica's. **Replace or license them before charging anyone.**
- **Look:** The photos are bottles on white. On the dark design they sit on a muted paper tone (`--color-paper`) with `mix-blend-mode: multiply` and the export's sepia filter, shown whole (`object-contain`) rather than cropped.

### B20. M4 frontend choices the spec left open (2026-10-15)
- **Pairing state lives in the URL** (`/?mode=notes&notes=Rose,Vanilla&goal=enhance`, `/?f=<slug>&goal=soften`). Every result is a shareable link, and "Pair this" on a fragrance page is just a link. With no params the page opened on Club de Nuit Intense Man, Soften (the project's origin story, decision 3), and Notes mode on Bergamot and Vanilla; B25 supersedes that and keeps only the Soften default. The Figma default of Bergamot and Oud was dropped because Oud is not a mapped note.
- **Nav shows only pages that exist** (Pair, Browse, About). Chat, Concierge, Collection, and Sign in join the header when their milestones land, rather than linking to empty pages now.
- **Want/Own buttons are deferred to M5.** Done in M5 (B21).
- **The "Owned only" switch is hidden until M5 adds Own buttons** (Tejas's call at M4 review). Superseded by B21: the switch is back and `OWN_BUTTONS_READY` is gone.
- **"Owned only" filters the partners loaded so far**, not the whole list. Superseded by B21: the server filters with `ownedOnly`.
- **The pairing and catalogue APIs return no numeric `id`.** Superseded by B21: list, detail, and pairing responses now carry `id`.
- **Results load 24 at a time with "Show more"** (fragrances: the API's pages; notes: the full list sliced in the browser). Skeleton rows use the same grid and frame sizes as real rows, and a goal or base change keeps the old list on screen (dimmed) until the new one arrives, so loading moves nothing.
- **Placeholder copy replaced with real data or accurate text.** The hero intro now describes what the app does; the "Pairing Journal 01" box shows the live catalogue count; the rank finder's idle state shows "Your bottle #— of N" with the real list size.
- **Breakpoints match the export:** Tailwind's `sm` starts at 641px and `md` at 901px, the export's two `max-width` switches.
- **Family tints** (14 colours for placeholders, the wheel chart, and family dots) are new tokens, since the export has none. They sit in an `@theme static` block because code reads them by name and Tailwind would otherwise drop them.
- **The About page shows no affinity numbers.** The tables live in `scoring.yaml` and no endpoint exposes them; copying them into the page would let the two drift. The page explains the rules in words and shows one live rank (Club de Nuit Intense Man in Aventus's Enhance list) from the API.
- **New web dependencies:** `react-router` (v8, data router for scroll restoration), `@tanstack/react-query`, and `@testing-library/user-event` (dev).

### B21. M5 guest mode choices the spec left open (2026-10-15)
- **"Owned only" is filtered by the server.** New `ownedOnly=true` query flag on `GET /api/pairing/fragrances/:slug`: the SQL keeps only partners whose id is in `owned`, so an owned bottle at rank 255 shows up even though page 1 holds ranks 1 to 24. Ranks stay the full-list ranks, `total` stays the whole list ("of 299"), and a new `matching` field counts the filtered rows; `totalPages` follows `matching`. `ownedOnly` is spelled `true`/`false` because Zod's boolean coercion turns the string "false" into true. Recorded in SPEC.md section 7.
- **`id` added** to `/api/fragrances` items, `/api/fragrances/:slug`, and the pairing `base` and `items`.
- **Owned ids only go to the API when "Owned only" is on.** Otherwise pressing Own on a result card would change the query key and refetch every loaded page. The "Owned" badge on a card reads the guest store instead of the API's `owned` flag, so it appears instantly. The API's flag still works for any client that sends `owned`.
- **A bottle is in one list at a time** (Own or Want, never both), matching the pass 2 `collection` table's one row per user and fragrance. Pressing the other button moves it; pressing the lit button removes it.
- **The guest store keeps a small snapshot per bottle** (id, slug, name, brand, image URL, dominant family), so `/me` draws its cards with no API call and no new "fetch by ids" endpoint. Pass 2's import only needs the ids. The snapshot can go stale only if the pipeline renames a fragrance.
- **Storage key `scense.guest.v1`.** The suffix lets a later shape change skip old data instead of misreading it. Malformed entries are dropped one by one rather than wiping the list; unreadable JSON starts a fresh guest.
- **The banner shows when a read or any later write fails**, not only on first load (a full disk can fail a write mid-visit). It is not dismissible and sits under the header on every page. The store keeps working in memory for the visit.
- **Guest UUID falls back to `crypto.getRandomValues`** when `crypto.randomUUID` is missing (it only exists on HTTPS and localhost, and the dev server opened by LAN address is plain HTTP).
- **Two tabs stay in sync** through the browser's `storage` event.
- **Want/Own on result cards sits in a row under the tags**; on the fragrance page it sits beside "Pair this". Buttons keep a fixed label with `aria-pressed`, and card buttons name the bottle ("Own Eclaire") for screen readers.
- **`/me` tabs reuse the pairing page's keyboard tabs**, moved into `components/ui.tsx` as `TextTabs`. The open tab lives in the URL (`/me?tab=want`). No taste profile card until the pass 2 chatbot.
- **The API dev container polls for file changes** (`CHOKIDAR_USEPOLLING: "true"` in `docker-compose.yml`), like the web container. Windows bind mounts send no file events, so `tsx watch` never restarted and edits needed `docker compose restart api`. tsx's bundled chokidar reads the variable, so no code or script change was needed.
- **Want/Own buttons are not on Browse grid cards.** The request named fragrance pages and result cards. Each Browse card is one big link, so buttons there would need the card restructured. Easy to add later.

### B22. M6 production deploy choices the spec left open (2026-10-16)
- **Manual AWS, DNS, and GitHub setup is in `docs/DEPLOY_RUNBOOK.md`.** Tejas followed it; the admin key is `ScenseKeyPair.pem`, the bucket is `scense-backups-ts-1016`.
- **Backups use the EC2 instance role, not access keys.** The IAM policy allows put, get, and list under `postgres/` in the one bucket, plus aborting a failed upload. No AWS key exists to leak, which is why section 12 has no AWS key secret. The metadata hop limit is 2 so a container can reach the role's credentials.
- **14-day retention is an S3 lifecycle rule**, not a cleanup step in the job, so the server cannot delete backups even if it is broken into.
- **Backup job:** its own image (`backup/`, from `postgres:16-alpine` so `pg_dump` matches the server, plus `aws-cli`), cron at 3 a.m. America/Toronto. Each run dumps to a file in custom format, checks it with `pg_restore --list`, then uploads it, so a half-finished dump never reaches S3. `restore.sh` lists dumps or restores one in a single transaction. Busybox cron starts jobs with an empty environment, so the entrypoint saves the job's variables to a root-only file that the job reads first.
- **Caddy gets its own image** (`caddy/Dockerfile`, from the repo root) with the web build and the Caddyfile baked in, so the server holds only `docker-compose.prod.yml` and `.env`. Certificates sit in a named volume, because asking Let's Encrypt again on every deploy would hit its rate limits.
- **The API image now carries `db/migrations`** at `/db/migrations`, so `npm run migrate` works with nothing mounted.
- **GitHub secrets are the only copy of each value.** Every deploy rewrites `/opt/scense/.env` (mode 600) from them, and stops before changing anything if a secret is empty. Each container gets only the variables it uses. The compose file requires only the image names (`${VAR:?}`), because CI builds images from the same file with no secrets.
- **Deploy order:** CI (`ci.yml`, now also callable as a reusable workflow) → build and push three images tagged with the commit SHA to GHCR → copy the compose file → write `.env` → pull → start db → migrate in a one-off API container → `up -d` → health check from the runner (12 tries × 5 s). The spec's order put migrate after `up -d`; migrating first means new code never meets an old schema. `ci.yml` no longer triggers on pushes to `main`, since deploy runs it there, so the suite runs once per push. Deploys are serialised with a concurrency group.
- **Private images:** the repo is private, so the server logs in to GHCR with the deploy job's own `GITHUB_TOKEN` (it expires when the job ends) and logs out after pulling. No extra secret.
- **SSH to EC2 is open to any address, key-only.** GitHub-hosted runners have no fixed IPs. Host-key pinning (`fingerprint` on the SSH action) is a later option.
- **Container logs are capped** at 3 × 10 MB per container (Docker keeps them forever by default) and images older than 72 hours are pruned on each deploy, to protect the 20 GB disk. The server has a 2 GB swap file.
- **The catalogue reaches production through `scripts/seed-prod.ps1`.** The Kaggle files are gitignored, so only the laptop can run the pipeline. The script dumps the six catalogue tables from the local database (inside the container, so accented names aren't re-encoded by PowerShell), copies the dump to the server, and loads it with `TRUNCATE ... CASCADE` and the data in one transaction. It can be rerun after any `tune`. **Before pass 2 goes live this must change:** the CASCADE would also empty collections, reviews, and pair ratings. The likely fix is running `load.py`'s upserts over an SSH tunnel.
- **`POSTGRES_PASSWORD` cannot be changed by editing the secret.** Postgres reads it only when the volume is first created; a change needs `ALTER ROLE` inside the database too.
- **New folders beyond the SPEC layout:** `caddy/`, `backup/`, `scripts/`, `docs/`.


### B23. Search understands abbreviations and misspellings (2026-10-18)
Real visitors typed "ysl myself" and "jpg" and got nothing. Two layers fix it: aliases for the names people use, and a typo-tolerant fallback for everything else.
- **Two alias files, loaded into the database.** `pipeline/config/brand_aliases.csv` (`alias, brand`: YSL, JPG, D&G, DG, CDG, MFK, PDM, TF, MMM, Margiela, CK, DKNY, LV, ADP, V&R, plus spellings like Bulgari and Paco Rabanne) and `name_aliases.csv` (`alias, name_word`: `myself` → MYSLF, the shorthand bdc, adg, cdnim, tv and lmw, plus blue/Bleu, savage/Sauvage, edp/Eau de Parfum and others). Both have a `check` column; Tejas reviewed every row and the markers are cleared (as in B11). Both load into `brand_aliases` and `name_aliases` tables (migration `002_search_aliases.sql`).
- **The aliases ride inside `search_vector`.** `load.py` rebuilds each vector in SQL from name, brand, the brand's aliases, and the aliases whose `name_word` appears in the name. The phrase test is `to_tsvector(name) @@ phraseto_tsquery(name_word)`, so the match and the vector use one parser; "J'adore" and "Eau de Parfum" are cut into words identically on both sides. "ysl myself" then needs no special query code: it is two ordinary prefix terms.
- **Punctuated aliases are phrases.** A typed chunk with punctuation inside ("d&g") becomes an adjacent-word phrase, and inside a phrase a one-letter word must match exactly. Without that, "d&g" matched every bottle with a D word and a G word, including "Acqua di Giò" (`d:*` matches "di"). The cost: "angel's share" no longer matches "Angels' Share" by full-text search; the typo fallback catches it instead.
- **The typo fallback is pg_trgm.** When full-text search finds nothing, a bottle matches if every typed word has a word in its `search_vector` with `similarity() >= 0.3` (`search.fuzzy_min_similarity` in `scoring.yaml`; 0.3 is pg_trgm's own default). Results are ordered by total closeness, then votes, and the API answers `fuzzy: true` so Browse can say "No exact match for ... Showing N close matches". One-letter typed words are ignored, and at most six words are compared.
- **It only runs when the text matches nothing at all.** If "sauvage" matches bottles that the gender filter excluded, the API returns an empty list, not near-misses: a second query checks the text without the filters first.
- **No trigram index.** The comparison reads about 2,000 words for 300 bottles, so a sequential scan is instant, and a GIN index would not serve the per-word `similarity()` test anyway. **Revisit when** the catalogue grows by orders of magnitude.
- **Weak matches exist.** "sauvge" also returns Wood Sage & Sea Salt at the bottom (similarity just over 0.3 to "sage"). Raise the threshold if that bothers Tejas; at 0.95 nothing fuzzy matches, which the tests confirm.
- **Accents are folded with `unaccent`** (Tejas's call at review; added to migration 002 before it shipped). `load.py` unaccents the text it turns into `search_vector` (name, brand, aliases, and the phrase test for name aliases), and the API unaccents the typed text in the prefix query and in the typo comparison. So "tresor" finds Trésor, "chloe" finds Chloé, and "gio" finds Acqua di Giò as exact matches, with or without the accent typed. The alias rows that only stripped accents (Hermes, Chloe, Lancome, Estee Lauder, gio) were removed. A name alias may be written with accents (`adg` → Acqua di Giò). Because the vector is unaccented, the typo fallback also compares unaccented words.
- **Rejected:** compacting aliases to one token ("dg") and teaching the API to do the same (the API would need to know every alias); looking aliases up from the tables per request (an extra query on every keystroke, or a cache to invalidate); fuzzy matching on every search (it would bury exact results).
- **Migration numbering:** this took `002` (it creates `pg_trgm` and `unaccent`), so pass 2's accounts migration becomes `003_accounts.sql` (SPEC sections 2 and 5 updated). `scripts/seed-prod.ps1` now ships the two alias tables with the catalogue, and the new migration reaches production through the normal deploy.
- **Added at review:** `bdc` → Bleu de Chanel (3 bottles), `adg` → Acqua di Giò (3), `cdnim` → Club de Nuit Intense Man (1), `tv` → Tobacco Vanille (1), `lmw` → Le Male (3, not Ultra Male), and the brand alias Margiela → Maison Martin Margiela (4). All matched the catalogue spelling.
- **CDG matched nothing at 300; superseded by B27.** Comme des Garçons was not in the top 300. The row stays for when the catalogue grows; `load.py` prints a note for it, and a test lists it as a deliberate absentee.

### B24. Browse sort, and a weighted rating for "Highest rated" (2026-10-18)
- **Decision:** Browse gets a Sort control: Most popular (rating votes, high to low, the default), Least popular, Highest rated. The URL carries `sort=least-popular` or `sort=highest-rated`; the default stays out of the URL like an empty filter, and an unknown value is ignored. Changing the sort goes back to page 1. The API validates `sort` (400 on an unknown value) and orders with a fixed list of ORDER BY strings.
- **Weighted rating:** `(votes × rating + m × mean) / (votes + m)`. A bottle with few votes and a perfect score is pulled toward the mean, so it cannot top the list. `mean` is the average rating over the whole catalogue, not the filtered list, so a bottle's score does not move when a filter changes. A bottle with no rating sorts last.
- **The constant (now 6,000; B27):** `browse.rating_weight_votes: 10000` in `scoring.yaml`, read by the API only. About the catalogue's median (12,200 votes; range 8,200 to 36,900), so a bottle needs roughly 10,000 votes before its own rating counts as much as the average. Checked on the real data: raw rating puts The Most Wanted Parfum (4.60 stars, 11,664 votes) first; the weighted rating puts Le Male Le Parfum (4.59, 28,689 votes) first. 5,000 left the raw order nearly intact; 20,000 sorted close to popularity.
- **Why `scoring.yaml`:** the API image already copies that one file, so no Dockerfile or compose change. Its header says the last two sections need an API restart, not a pipeline run.
- **Today every bottle has 8,000+ votes**, so the few-votes case is a guard for a bigger catalogue; the test proves it on a scratch table (5 votes at 5.0 stars lands third, not first).
- **Rejected:** sorting by raw rating (the problem the request names); a minimum-votes cutoff (hides bottles instead of ranking them); precomputing the score in the pipeline (a constant change would need a rerun, and the mean would live in two places).
- **Revisit when:** the catalogue includes low-vote bottles; then recheck `m`.

### B25. The pairing page opens empty (2026-10-18)
- **Decision:** With no `?f=` in the URL the page shows an empty search box and, in the results area, the normal heading with "Nothing to rank yet." and a short prompt ("Pick a fragrance above to see what to layer with it, or switch to Notes to start from a note or two"). Notes mode shows "Pick a note or two above to see which notes layer with them." and picks no notes. A shared `/?f=<slug>` link still preloads that fragrance. The Soften goal default stays.
- **Why:** Watching real visitors, a preselected Club de Nuit Intense Man and Bergamot + Vanilla looked like a choice already made for them. An empty start asks them to choose their own.
- **Notes mode wording** stays about notes only (SPEC section 11): it never mentions fragrances, and a test checks that.
- **Supersedes** the first bullet of B20 (the default base and default notes). The About page's example link still passes `?f=`, so it is unaffected.
- **The selected-bottle strip is hidden until a bottle is chosen** (it used to show a loading skeleton). Picking one adds the strip and the results at once.

### B26. Bottle thumbnails in the fragrance dropdowns (2026-10-18)
- **Decision:** The pairing base picker and the rank finder show a 30 × 40 px bottle thumbnail beside each name. It is the same `BottleImage` component as the result cards, so it loads the same photo and, when a photo is missing or refused, draws the same family-tinted bottle (B19).
- **No layout jump:** the thumbnail's frame has a fixed size and holds a paper-toned background until the photo is drawn, so the list is the same height before and after photos load. The images load lazily, so a closed list fetches nothing.
- **Alt text is empty** because the name is right beside the picture, as on the cards.
- **Not added to the Notes picker** (notes have no bottle), **or to Browse**: its search box filters the grid and has no suggestion list.

### B27. The catalogue grows from 300 to 1,000 (2026-10-18)
- **Decision:** `catalogue_size: 1000`, the 1,000 fragrances with the most rating votes. The 1,000th has about 3,579 votes. `min_strength_votes` goes from 50 to 1,000, so the ingest guard now fires well before strength becomes unreliable.
- **Why 1,000 and not a vote floor:** floors of 500, 250, or 100 votes would admit 8,211, 14,292, or 26,313 fragrances, and the pair table grows with the square (67 million rows at 8,211). Resampling each bottle's real longevity and sillage votes flips its strength bin about 2% of the time at 4,000 or more strength votes, 3% at 1,000 to 4,000, 7% at 500 to 1,000, and 20% at 50 to 100. The 1,000's lowest is 1,613 strength votes, about 2.5%.
- **Size:** `pair_scores` is 1,498,500 rows (999,000 Enhance, 499,500 Soften) against 134,550. The database is about 200 MB against 42 MB, precompute takes about 15 s against 1.2 s, and the seed file is 44 MB (14 MB gzipped) against 4 MB. Measured on the laptop; the EC2 timing is an estimate.
- **Strength cutoffs kept** (Tejas's call). The split is 308 / 279 / 224 / 189 at 1,000: less-voted bottles are rated as weaker. The first 300 keep 75 / 78 / 72 / 75, and a test checks both. Retuning would have changed the strength, and so the Soften results, of bottles that already had them.
- **Notes: the 150 stay, 17 are added (167).** Every further note used in 10 or more of the 1,000 fragrances got a draft row that Tejas reviewed (Tea, Fruity Notes, Styrax, Green Mandarin, Papyrus, White Flowers, Mango, Angelica, Chamomile, Marshmallow, Passionfruit, Blood Orange, Hibiscus, Peru Balsam, Pomegranate, Vanilla Orchid, Milk). Re-picking the top 150 would have swapped out 14 reviewed rows. Note coverage of all note mentions: 87.7% with 150 notes and no new aliases, 90.5% with 167 notes and the new aliases.
- **Accords:** 14 new accords (73 in all). `Champagne` and `Pear` keep the dataset's capital letter, because ingest looks accords up by exact name.
- **Aliases:** 44 new note aliases (spelling, origin, and form variants, such as Vetyver, Madagascar Vetiver, and Black Tea into Tea). Tejas removed one draft, Brazilian Redwood into Brazilian Rosewood: they are different woods.
- **CDG fixed:** the dataset spells it "Comme des Garcons" with no cedilla, so the alias row (and the old "deliberate absentee" exemption) could never match. The row now uses the dataset spelling, matches 3 bottles, and the absentee set is empty.
- **Highest-rated weight:** `browse.rating_weight_votes` 10,000 to 6,000, because the median vote count fell from about 12,200 to about 5,900. B24's rule (about the median) is unchanged.
- **Small code changes:** the `owned` id list cap rose from 300 to 2,000 (a guest cannot own more bottles than exist); the About and Browse pages no longer state a count; the integration tests read the catalogue size instead of hardcoding 300 and 299.
- **The typo search was left alone.** It compares every word without an index and takes about 12 ms for one typed word at 1,000 fragrances (B23 said to revisit at orders of magnitude).
- **Revisit when:** the catalogue passes a few thousand fragrances. The pair table then needs a different shape (top-N per base only), and the seed becomes a bigger job.

### B28. Existing fragrance ids are pinned (2026-10-18)
- **Decision:** `pipeline/config/pinned_ids.csv` lists the id and slug of the 300 original fragrances. `load.py` inserts those with their pinned ids; new fragrances take the next id from the sequence (301 up). `ingest.py` and `load.py` both refuse a catalogue that no longer contains a pinned slug.
- **Why:** guests' saved Own and Want lists are ids in their browsers, and so is the snapshot's slug. Production kept ids so far only because the load matches existing rows by slug. A fresh database, a rebuilt laptop, or a disaster recovery would have handed out ids in vote order, and the 1,000 interleave new bottles among the old ones, so every saved list would have pointed at the wrong bottles.
- **Checked:** all 300 slugs survive at 1,000, in the same order, with no new collisions (slugs are checked inside the catalogue only; none of the new 700 collides with the original 300).
- **Tests:** the pins file is valid; every pinned slug is in the catalogue; the loader refuses a catalogue that drops one; and a test creates an empty database, loads the 1,000 in reversed order, and checks that all 300 keep their ids and the new ones sit above them, then loads again and checks nothing moved. With the pinning switched off that test fails. A further test checks the dev database.
- **The sequence** is moved past the highest pinned id before any insert, and `seed-prod.ps1` resets the `fragrances` and `notes` sequences after loading, because a data-only dump does not carry them.

### B29. seed-prod.ps1 at 1,000 fragrances (2026-10-18)
- **Id check before anything is truncated:** every fragrance in production must exist locally with the same id and slug. If not, the script stops with the first differences. An empty production passes.
- **Gzip and keepalive:** the dump is gzipped inside the container (44 MB to 14 MB) and unzipped on the server; `ssh` and `scp` send keepalives (every 30 s) so a quiet connection is not dropped during the load.
- **Sequence reset** for `fragrances` and `notes` after the load, and a count check: production's `fragrances,pair_scores` counts must equal the local ones, or the script fails.
- **The lock:** TRUNCATE holds an exclusive lock for the whole transaction, so catalogue and pairing requests wait (they do not fail) until it commits. About 3 seconds at 300 fragrances; an estimated 1 to 3 minutes at 1,000 on the t3.small. Run it when the site is quiet.
- **Not tested against the real server:** the id check, gzip, load, sequence reset, and count check were each run against a scratch local database; the ssh quoting was only parsed, not run. The first real run is the test.
- **Still true:** B22's warning that TRUNCATE ... CASCADE must change before pass 2 accounts go live.
