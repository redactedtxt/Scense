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
- **Updated by B41:** `/` is now a welcome page whose largest card leads to layering; the pairing page moved to `/pair`.
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
- **Updated by B41:** the site opens on a home page (still no login wall) with layering as its primary card.

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
- **Updated by B36:** visitors now keep several chats; the 8 messages a day are one budget shared across them.

### 26. Site-wide daily cap on guest conversations
- **Why:** A guest can clear their browser and get a fresh allowance. The site-wide cap stops one visitor from running up the bill.
- **Updated by B36:** the cap counts distinct guests per day, not conversations.

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
- **The catalogue reaches production through `scripts/seed-prod.ps1`.** The Kaggle files are gitignored, so only the laptop can run the pipeline. The script dumps the six catalogue tables from the local database (inside the container, so accented names aren't re-encoded by PowerShell), copies the dump to the server, and loads it with `TRUNCATE ... CASCADE` and the data in one transaction. It can be rerun after any `tune`. **Before pass 2 goes live this must change:** the CASCADE would also empty collections, reviews, and pair ratings. Fixed in M7 by B32 (an in-place merge, not `load.py` over a tunnel).
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
- **Superseded by B32:** the TRUNCATE ... CASCADE load is gone; the id check, gzip, keepalives, and count check stay.

### B30. Known limitation: different-leading accords look less alike than they smell (2026-10-18)
- **What we saw:** in Creed Aventus's Enhance list at 1,000 fragrances, Essential Parfums Fig Infusion (#5) and Le Labo The Matcha 26 (#6) sit just above Armaf Club de Nuit Intense Man (#7), though people who know the three would expect CDNIM higher.
- **The numbers** (raw Enhance similarity to Aventus, display score in brackets): Fig Infusion 0.8923 (94.7), The Matcha 26 0.8897 (94.5), CDNIM 0.8880 (94.3). The gap is 0.004, or 0.4 points of 100, so ranks 5 to 7 are a tie, not an ordering.
- **Why:** Aventus leads Fruity (0.281) and CDNIM leads Citrus (0.295; Aventus has 0.127). The Edwards wheel puts Fruity and Citrus three steps apart, where the Enhance table gives 0.1, so the family part alone scores CDNIM 0.885 against Fig Infusion 0.969 and The Matcha 26 0.961 (those two lead Woods and Fruity, close to Aventus's Woods, Dry Woods, Woody Amber, and Soft Amber). The smoky facet recovers part of it: CDNIM 0.219 against Aventus 0.212, while the other two have none, so the facets alone score CDNIM 0.924 against 0.554 and 0.590. But the six facets are a small share of the 20-value vector (0.071 of Aventus's 0.320 squared length), and the two effects nearly cancel. The cause is in the data: the dataset's top accord is `fruity` 100 for Aventus and `citrus` 100 for CDNIM, and those map to different families.
- **Decision:** leave `enhance.facet_weight` at 1.0 (Tejas's call). Nothing else changed.
- **Why not raise it:** it rewrites the Enhance list of every fragrance, not just this one, and B17 chose 1.0 on purpose. At 2.0 the Aventus list becomes Black Saffron, Cedrat Boise, La Yuqawam Homme, Fantomas, Oud Maracujá, CDNIM, Bibliothèque, Jasmin et Cigarette, CH Men, Ombré Leather Parfum (CDNIM #6, Fig Infusion #13, The Matcha 26 #12), which tilts it toward leather. At 3.0 CDNIM is #5 and the other two fall to #23 and #20. Tuning a weight to land one expected answer is the wrong reason to move it. Soften is unaffected either way: it uses families only, so CDNIM's Soften list does not change.
- **Planned fix:** pass 2 pair ratings (decision 11). Ratings are stored but not used in scores yet. Once enough people rate Enhance pairs, a pair like Aventus and CDNIM can be corrected from what wearers say instead of from accord names.
- **Revisit when:** pair ratings have enough volume to learn from, or another well-known pair looks wrong for the same reason (different leading accords, same character).

### B31. M7: accounts, the collection API, and guest import (2026-10-19)
- **The collection API moved from M8 into M7** (Tejas's call, option A). If M7 shipped sign-in alone, a signed-in visitor's Own and Want clicks would still save only to the browser. Now `lib/collection.ts` is the one place that switches: the guest store while signed out, the account API while signed in. No page knows which. M8 keeps reviews and pair ratings. Rejected: shipping M7 with "Sign in" hidden until M8 (two milestones reviewed and released at once).
- **Migration `003_accounts.sql` creates all five pass 2 tables** as SPEC section 5 lists them, plus the `citext` extension, so the reseed test can prove none of them is touched.
- **One extra endpoint: `GET /api/collection`** lists the whole collection in the guest store's item shape (id, slug, name, brand, image, dominant family, status, saved time), so `/me` and the "Owned" badges draw both modes from one shape. `GET /api/collection/:id` answers `{ fragranceId, status }`, with `status: null` when the bottle isn't saved. `PUT` with an unknown fragrance id is a 404.
- **Trust proxy is 1 hop** (`TRUST_PROXY_HOPS`), not `true`. Caddy is the only proxy and replaces any incoming `X-Forwarded-For` with the address it saw. With 1 hop Express takes the rightmost entry, so even a proxy that appended to a forged header would still give the real address. `true` would take the leftmost, forgeable entry. Tested with supertest, forged headers included, and once through a real Caddy container in front of the dev API: seven attempts, each with a different forged header, were blocked from the sixth.
- **Rate limits** use a small in-memory sliding-window limiter (`middleware/rateLimit.ts`) with an injectable clock, not `express-rate-limit`. One API container makes memory enough; a second container would need Redis.
  - Login: 5 attempts per 15 minutes per IP + lowercased email, counting every attempt, as the spec words it.
  - Signup: 5 per hour per IP (Tejas's addition). The server runs on Standard CPU credits and each signup costs a bcrypt hash, so a signup loop could drain the credits and throttle the whole site. The signup limit runs before validation, so malformed requests count too.
  - All four numbers live in `api/src/config.ts` as environment settings with those defaults. Over a limit the API answers 429 `rate_limited` with `Retry-After`.
  - Known gap: limits are per IPv6 address, not per /64 block. The server has no IPv6 address today (DNS holds A records only).
- **Passwords:** `bcryptjs` (pure JS, no native build on Alpine) at cost 12 (`BCRYPT_COST`; tests use 4). Passwords are 10 characters up to 72 bytes, because bcrypt silently ignores anything past 72 bytes. A login with an unknown email still runs a bcrypt compare against a dummy hash, so response time doesn't reveal which emails have accounts, and both failures return one message. Signup does reveal a taken email (409); without email verification there is no way around that.
- **Sessions:** a `jose` HS256 JWT holding only the user id, 7 days (`SESSION_DAYS`), in an httpOnly, Secure, SameSite=Lax cookie named `scense_session`. `JWT_SECRET` must be at least 32 characters, or the API refuses to start. Production's is 64 (runbook E1). Dev sets `COOKIE_SECURE=false` because the dev server is plain HTTP. `helmet` is on, and CORS allows only `CORS_ORIGIN` (comma-separated) with credentials. CSRF protection is SameSite=Lax plus JSON-only bodies.
- **Known limitation, accepted for a portfolio demo: logout does not revoke the token.** `POST /api/auth/logout` deletes the cookie from that browser. A copy of the token stolen before then stays valid until its 7-day expiry. **The fix at scale:** a `token_version` integer on `users`, copied into the token when it's signed and checked against the database on each request. Logout ("sign out everywhere") or a password change bumps the version, and every older token fails at once. The cost is one indexed lookup per request.
- **Guest import:** `POST /api/collection/import` takes up to 2,000 `{ fragranceId, status, addedAt? }` items in one INSERT. A bottle already in the account keeps the account's status. Unknown ids are skipped. A saved time in the future is clamped to now, and the response counts `imported` and `skipped`. After a successful import the browser's list is emptied. The guest id stays (pass 2's LLM caps count by it), and so does the taste profile, which M9 will import.
- **The import offer** appears after signup or login if the browser holds guest bottles: "Add N bottles" or "Not now". "Not now" keeps them in the browser, and `/me` offers again while signed in, until the visitor imports or dismisses it for that visit.
- **Web:**
  - `/signup` and `/login` are one `AuthPage` in two modes, built from the existing tokens (kicker, display heading, panel, gold button, the search boxes' bottom-rule inputs). The sign-up page says in one line that there is no email verification or password reset.
  - `?next=` returns the visitor where they were. Only on-site paths are accepted, so a crafted link can't redirect to another site. A signed-in visitor who opens `/login` or `/signup` is sent on.
  - The header's top-right shows "Sign in" (Figma `.sign-in`), or the user's name and "Sign out".
  - Signed-in Own/Want clicks update the screen at once, then send PUT/DELETE requests one at a time per bottle, so quick double clicks can't arrive out of order. A failure refetches the list, and a 401 drops back to guest mode.
  - While the session is still loading, the buttons are disabled and the lists read as empty, so a click can't land in the wrong store. The storage-blocked banner shows only to guests.
- **Dev note:** after adding API dependencies, `docker compose up --build` keeps the old `node_modules` volume. Use `docker compose up -d --build --renew-anon-volumes api` once. Production is unaffected (no volumes).

### B32. The catalogue reseed never deletes user data (2026-10-19)
- **Problem (B22):** `seed-prod.ps1` loaded with `TRUNCATE ... CASCADE`, which also empties every table with a foreign key to `fragrances`: collections, reviews, pair ratings.
- **Decision:** the catalogue travels in a separate `seed` schema and is merged in place.
  - `scripts/seed/stage.sql` copies the eight catalogue tables into `seed.*` locally, and `pg_dump --schema=seed` ships them.
  - On the server, one transaction drops any leftover `seed` schema, loads the dump, and runs `scripts/seed/merge.sql`.
  - The merge first refuses a seed that lacks any production fragrance with the same id and slug. This check repeats the script's own in SQL, so it can't be bypassed.
  - It then updates fragrances by id and inserts new ones. None is ever deleted.
  - It empties and refills the pipeline-only tables (pair scores, notes and their links, accords, aliases) with `TRUNCATE` *without* CASCADE. If a user table ever references one of them, the load fails loudly instead of emptying that table.
  - Finally it moves both id sequences past the highest id and drops the `seed` schema.
- **Tests:** `pipeline/tests/test_seed_merge.py` builds a scratch database with a small catalogue and one user with rows in all five pass 2 tables. It checks that a reseed (renamed bottle, new bottle, new pair scores, changed notes and aliases) leaves every user row identical while the catalogue changes. It also checks that a seed missing a production fragrance is refused with nothing changed, and that the old TRUNCATE ... CASCADE would have emptied the collections. The `scratch_database` fixture moved to `conftest.py` and now applies every migration.
- **Checked end to end:** the script's exact dump and load commands ran against a copy of the dev database standing in for production, with a user, collection rows, and a review added. The 44 MB dump loaded in 31 s on the laptop. The user rows survived, a stale row was corrected, and the `seed` schema was gone. The ssh/scp wrapping was not run against the real server; the first real run tests it.
- **Rejected:** running `load.py` over an SSH tunnel (it needs the Kaggle-derived parquet and the pipeline's Python environment on the laptop, and would hold a tunnel open for the whole load); `ON DELETE RESTRICT` on the user tables (it would only turn the data loss into a failed load).

### B33. M8: written reviews and pair ratings (2026-10-21)
- **Migration `004_reviews.sql`, not an edit to 003.** 003 is live. 004 adds `updated_at` to `reviews` (for an "Edited" mark) and to `pair_ratings` (the later learning step will want to know how recent a rating is), and an index on `reviews (fragrance_id, created_at DESC, id DESC)` for the newest-first list; the UNIQUE index starts with `user_id`, so it can't serve that.
- **Endpoints:** `GET /api/fragrances/:id/reviews?page=` is public, 10 per page, newest first, and also returns `mine` (the viewer's own review wherever it sits in the list) so Edit works without paging. `POST` creates the user's one review (a second is 409 `review_exists`), `PUT` edits it (404 `no_review` if there is none), `DELETE` removes it (204 even if there was none). PUT and DELETE take no review id: they act on the caller's own review of that fragrance, so nobody can address someone else's. An unknown fragrance id is a 404.
- **One extra endpoint: `GET /api/pair-ratings?baseId=&goal=`** returns the user's ratings for one result list. SPEC section 7 lists only PUT; without a read the card could not show the user's rating when they come back. `PUT /api/pair-ratings` takes `{ baseId, partnerId, goal, stars }` and upserts, so rating again changes the rating. A fragrance can't be rated as its own partner (400). The PUT does not check that the pair is in `pair_scores`: a card only offers listed pairs, and a rating of any real pair is still an opinion worth keeping.
- **Review rules:** 1 to 5 whole stars and text that is not blank after trimming (a written review needs words; the stars alone are what pair ratings are for). Up to 2,000 characters counted as Postgres counts them (code points), so 2,000 emoji fit; the web counter counts the same way. A NUL character is refused with a 400, because Postgres text can't store it.
- **Plain text, never HTML.** The body is stored exactly as typed (no escaping on the server, which would show `&lt;` to readers) and rendered as a React text child, which the browser treats as characters. `whitespace-pre-line` keeps line breaks without any HTML. A web test renders a review containing `<script>` and an `<img onerror>` and checks the text is visible, no such element exists, and nothing ran; the API and integration tests check the text round-trips unchanged.
- **Rate limits per user**, with the existing in-memory limiter, after `requireUser` so the key is the user id (a shared office address must not lock out everyone behind it): review writes (POST, PUT, DELETE together) 10 per hour; pair-rating writes 120 per hour (one small upsert each, and people click through many cards). Reads are not limited. All four numbers are environment settings in `api/src/config.ts` (`REVIEW_LIMIT_MAX`, `REVIEW_LIMIT_WINDOW_MINUTES`, `PAIR_RATING_LIMIT_MAX`, `PAIR_RATING_LIMIT_WINDOW_MINUTES`). The pair-rating limit was not asked for; it is generous and only stops a script.
- **Web, fragrance page:** a "From wearers" section under the detail panels (and so under the dataset's community rating). Left, a box with the form (signed in, no review), "Your review" with Edit and Delete (Delete asks once inline), or for guests a disabled-looking "Sign in to review" button that is a link to `/login?next=<this page>`. Right, the list with stars, display name, date, an "Edited" mark (only after the first minute), a "You" tag on your own, and "Show more" paging. The sign-in link logic moved from the header into `loginHref()` in `lib/session.ts`, so both use one rule.
- **Web, result cards:** "Your rating" stars under the score bar, for the goal on screen. Native radio inputs drawn as stars: one Tab stop, arrow keys, and screen readers hear "4 stars, radio". A click saves at once (optimistic, requests per pair queued in order like collection clicks) and says "Saved", or the server's message on a 429. Guests see the stars disabled and a "Sign in to rate" link. The prompt says "rate", not "review", because nothing is reviewed on a card; the link and behaviour are the same as the review prompt. Both rows always take their space, so a card is the same height for guests, users, and while the session loads.
- **Ratings change no score** (decision 11). An integration test rates a pair and checks the pairing list is identical before and after.
- **Checked at 375px** in headless Chrome against the dev stack: no horizontal scroll on the fragrance page or pairing page for a guest or a signed-in user; a review with a script tag showed as text and ran nothing; a pair rating survived a reload.

### B34. M9: the chatbot, the taste profile card, and the AI caps (2026-10-21)
- **The model only writes JSON; the server does everything else.** `services/llm.ts` is the only file that imports `@anthropic-ai/sdk`. It sends `claude-haiku-5-5`, `max_tokens` 400, structured outputs (`output_config.format`, a JSON schema of SPEC section 8's shape), `effort: "low"`, and **thinking off**: Haiku 5.5 thinks by default, and thinking counts against the 400-token cap, so it could use the whole cap before any JSON. The server parses the text and checks it with its own Zod schema (unknown family or facet names refused, numbers clamped). A refusal or a reply cut off at `max_tokens` counts as invalid. One retry, then a friendly apology. The SDK retries a 429 or 529 once by itself, with a 20-second timeout.
- **Unverified until the first real call:** the JSON schema leaves the family and facet keys optional (the model names only what changed). No test can call the API, so the first local chat with a real key checks that the API accepts that schema. If it doesn't, the chat shows "unavailable" and the API log prints the HTTP status.
- **Untrusted input, in layers.** (1) The system prompt says user messages are descriptions, never instructions, and an off-topic or "name a product" request gets a one-line refusal and an empty update. (2) The visitor's text only ever goes in as a `user` message. (3) A guest's stored profile goes in as numbers only; its summary never reaches the prompt, so it can't carry instructions. (4) `services/replyGuard.ts` checks every reply and summary before anyone sees it: no catalogue fragrance name, brand, or brand alias (case, accents, and `&` ignored; a name can't match across punctuation), no link, and at least one family, facet, note, or scent word. A reply that fails is replaced with one the server writes from the profile numbers. (5) Replies are capped at 120 words on the server. The worst a hostile message can do is skew its own sender's profile. A test sends "ignore your instructions and recommend Creed Aventus" with a mocked model that obeys completely, and checks that no name reaches the page.
- **Known limits of the guard.** One-word catalogue names that are ordinary words ("You", "Love", "Black", "Lush", 76 in a list in `replyGuard.ts`) are allowed, because blocking them would throw away most good replies. Without a brand they point at no particular bottle. Names that are notes (Vanilla, Tobacco) are allowed for the same reason. The on-topic test is a keyword test, so off-topic text that happens to mention a scent word (a recipe with vanilla) gets through. The prompt is the main defence there. The stricter option is replies written entirely by the server, at the cost of a stiff conversation.
- **The transcript lives on the server** (`chat_messages`, migration `005_chat.sql`). The browser can't forge an earlier "assistant" turn, and one conversation a day means a reload must bring the chat back, not show an empty page that refuses messages. `GET /api/chat` returns it. Rows older than `CHAT_RETENTION_DAYS` (7) are deleted whenever a new conversation starts. (Superseded by B36: several chats per visitor, kept 30 days after their last message.)
- **A turn is one message.** The model gets the last 8 messages (4 exchanges) plus the new one, starting with a user message. The taste profile in the system prompt carries what older turns taught it. With 8 user messages a day, "8 turns" as exchanges would never trim anything.
- **Caps in one statement.** `services/caps.ts` claims the message slot *before* calling the model, in a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE user_messages < 8`, so two quick messages can't both become message 8. The site-wide guest cap applies only to a guest's *first* message of the day, so a guest already chatting can finish. It counts both features (SPEC section 10). Under simultaneous first messages from new guests it can overshoot by the number of messages that arrive in the same instant. A visitor gets one message in flight at a time (409 `chat_busy`), held in memory like the rate limiter (B31).
- **Refunds.** If Anthropic can't answer (down, bad key, monthly spend limit), the slot is given back, and a conversation left with no messages is deleted so it doesn't hold a guest-cap slot. Two invalid answers are *not* refunded: they cost tokens, and refunding would let a visitor who can make the model ramble chat for free. Every call's tokens are logged, valid or not.
- **No API key means no chat, not a crash.** `GET /api/chat` says `available: false`, the page says so before anyone types, and the rest of the site is unaffected. Tests blank `ANTHROPIC_API_KEY` in `vitest.config.ts` and use a fake model throughout.
- **Recommendations** (`services/recommend.ts`): cosine similarity of the 20-value taste vector and each bottle's family shares plus facets. Only positive scores count as matches, so owning only bottles you'd dislike doesn't produce a "match". Up to 3 owned, then up to 3 new ones scoring above the best owned. The server recommends when the model says `ready_to_recommend`, and also on message 8, so nobody leaves empty-handed. The 1,000 vectors and every name are cached in memory for an hour.
- **Taste profile storage:** guests in the browser store (`scense.guest.v1`, cleaned on read: known keys only, weights clamped), users in `taste_profiles`. `GET/PUT /api/profile/taste` are for users only. A hand edit rebuilds the summary from the numbers, so the card never shows a line that no longer fits.
- **Guest import carries the profile.** `POST /api/collection/import` takes an optional `tasteProfile`. It fills an account with no profile, and an account that already has one keeps it (as with bottles, B31). The response says `imported`, `kept`, or `none`. The browser's profile is cleared after the import either way, and the offer says so beforehand. A profile alone, without bottles, is enough to show the offer.
- **The card:** top 3 likes and top 2 dislikes across families and facets together, with words for strength (Loves, Likes, Leans toward; Avoids, Dislikes, Not keen on). Weights under ±0.2 are too faint to list. Edit mode has 20 native range inputs, from -1 to 1 in steps of 0.1, operable by keyboard.
- **Admin report:** `GET /api/admin/usage?days=30` with an `X-Admin-Token` header, compared in constant time. With `ADMIN_TOKEN` blank the endpoint is a 404. It returns per-day conversations, guest conversations, messages, tokens, and an estimated cost, plus month-to-date totals (the month Anthropic's spend limit counts). Prices are environment settings (`LLM_INPUT_USD_PER_MTOK` 0.10, `LLM_OUTPUT_USD_PER_MTOK` 0.50, Haiku 5.5 list prices on 2026-10-21). The console stays the real bill.
- **Every number is an environment setting** in `api/src/config.ts`, with the spec's defaults: model, max tokens, timeout, 8 messages, 8 history turns, 500-character messages, 120-word replies, the guest cap, retention, and prices. A blank value means "use the default", because the deploy writes every variable into `.env` and `""` would otherwise read as 0.
- **Dev:** `docker-compose.yml` passes `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`, and `GUEST_DAILY_CONVERSATION_CAP` from the repo-root `.env`, which git ignores. Production already had all three secrets wired (B22).
- **Web test timeout:** `findBy*` now waits up to 5 s (`web/src/tests/setup.ts`). The ninth test file made the first Reviews test take about 1.6 s under parallel load, over the 1-second default, on every run.
- **Cost:** an 8-message conversation is about 15,000 input and 1,600 output tokens, or roughly $0.002. The worst case (500-character messages, 400-token answers, every call retried) is about $0.009. Recheck against `/api/admin/usage` after real use.

### B35. M9 fixes from the first real chat test (2026-10-21)
- **Picks are introduced, not offered.** The prompt says that when `ready_to_recommend` is true the picks appear under the reply, so it ends with one short lead-in and never asks whether the visitor wants recommendations. The server checks too (`finishReply` in `services/chat.ts`): when picks are shown and the reply's last sentence is a question offering them (an offer phrase such as "would you like" plus something offered, such as "recommendations" or "bottles"), that sentence becomes "Here are a few picks from the catalogue that fit." Other closing questions ("Do you like spicy notes too?") stay.
- **Bottles a visitor names count.** The model's JSON gains `mentioned_fragrances`: each name the visitor typed, copied as written, marked `liked` or not. The server keeps only names that really appear in the message, so the model can't add a bottle of its own, and looks each one up with the catalogue search (`bestMatch` in `services/search.ts`, moved out of `routes/fragrances.ts`). The search tries the prefix search with aliases as typed, then without the connector words "and", "by", "from" ("Myrrh and Tonka" is "Myrrh & Tonka"), then the typo fallback. Several matches go to the most voted bottle.
  - Liked bottles become one strong profile update. Their 20-value vectors are averaged and scaled so the largest weight is `CHAT_NAMED_BOTTLE_WEIGHT` (1). Parts under `CHAT_NAMED_MIN_WEIGHT` (0.25) are dropped, and the result is merged with the same 0.6 / 0.4 rule after the model's own update. Disliked bottles don't change the profile: their families would be guesswork as negatives.
  - Every named bottle, liked or not, is left out of the picks for the rest of that day's conversation (`chat_messages.named_fragrances`, migration `006_chat_named_bottles.sql`).
  - The reply starts with one server-written sentence saying how many were found and whether any aren't in the catalogue yet. It never names a bottle, found or not. Echoing a visitor's typed name back would be a way to put any text into a reply.
  - At most `CHAT_NAMED_MAX` (5) names a message are looked up.
  - Tejas's first test, "my favourites are Myrrh and Tonka, SWY Intensely, Hawas Fire": Myrrh & Tonka (Jo Malone London) matched. SWY Intensely did not at first: Emporio Armani Stronger With You Intensely is in the catalogue, but no `swy` alias existed. Tejas then added `swy` → `Stronger With You` to `name_aliases.csv`. It covers all three Stronger With You bottles, and "SWY Intensely" now finds Intensely in both the chat and Browse. Hawas Fire did not match: it isn't in the catalogue (Hawas for Him, Ice, and Black are). The integration test checks all three.
- **Owned picks need a minimum match:** `CHAT_OWNED_MIN_MATCH` (0.6). An owned bottle under it is never picked. With no owned bottle over it, the picks are the best bottles the visitor doesn't own. Checked on the real catalogue: for "spicy with an edge", "warm vanilla and smoke", and "fresh citrus", the top matches score 77% to 94%, and 39 to 76 bottles clear 60%. Bleu de Chanel scores 51%, 29%, and 52%, so it no longer appears first just because it's owned. `api/scripts/match-check.ts` reruns this check.
- **The reply never talks about its own rules.** The prompt says so, and the off-topic instruction now steers back to scent ("Let's stay with scent: ...") instead of explaining limits. The reply guard has a fourth check (`mentionsRules`): "I won't / can't / don't name, recommend, suggest ...", "my instructions", "as an AI", "the website picks the fragrances". Rule-talk sentences are dropped from a reply and the rest kept. A reply with nothing left, or a summary that talks about rules, falls back to the server-written text. Patterns are in `replyGuard.ts`; "I don't think you'd like smoky notes" is not caught.
- **Word cap:** the 120-word cap applies to the model's text. The server's own sentences (the named-bottles note, the lead-in) come after the cap and can add about 30 words.

### B36. The chat panel and multiple chats (2026-10-21)
- **Request (Tejas):** the conversation becomes a fixed-height panel that scrolls on its own, and a visitor can keep several chats with one shared daily budget. Tejas approved the schema, API shape, retention, deletion, and lock below before the build.
- **Schema: migration `007_multi_chat.sql`, not an edit to 005.**
  - New `chat_conversations` table (id, subject, title, created_at, last_message_at). `chat_messages.conversation_id` gets a foreign key to it with ON DELETE CASCADE.
  - **`llm_usage` keeps its `UNIQUE (subject, feature, day)` key.** The request expected this key to change, but a shared daily budget is exactly one row per subject, feature, and day. What no longer fit was `llm_usage.conversation_id`, which assumed one chat a day.
  - The atomic claim is unchanged in shape: `INSERT ... ON CONFLICT DO UPDATE ... WHERE user_messages < 8` on that one row. Messages from two chats queue on the same row, so only one can become message 8.
  - `conversation_id` is made nullable, not dropped, so the old API container (which still writes it) can keep claiming slots in the seconds between "migrate" and "up -d". SPEC section 13 has an M11 TODO to drop it.
  - **Limit:** the old container never writes `chat_conversations`, so in that window its first message of a brand-new conversation fails the new foreign key (a 500 for that one message, with the slot not refunded); continuing an existing conversation works. For the same reason, rolling back to a pre-007 API image after this migration breaks new chats: roll back code and migration together, or not at all.
- **Existing chats keep working.** The migration backfills one chat per stored transcript, owned by its `llm_usage` subject and titled from its first user message by the same rule as the API. A transcript with no owner is deleted; none is expected. Checked on the dev database: both existing chats (one guest, one user) came through with the right owner and dates, the 66-character first message was cut to "I love warm vanilla scents but hate anything too fresh or…", and the running API listed the guest's old chat straight after.
- **New chats are free.** "New chat" creates nothing on the server. A first message without `conversationId` gets a new id, and the chat row is written in the same statement as its first exchange, after the model answered. A refunded first message (Anthropic down) leaves no empty chat. The same statement moves an existing chat's `last_message_at`.
- **Ownership.** Every read, post, and delete filters on the subject. Someone else's chat, a deleted or expired chat, and a malformed id all get the same 404 `no_chat`, so ids can't be probed. A post to a missing chat is refused before a message slot is claimed. DELETE answers 204 either way.
- **Titles** come only from the visitor's first message: whitespace collapsed, at most 60 characters, cut at a word break (`titleFrom` in `services/conversations.ts`). The model's text never reaches a title. A title may still contain a bottle name the visitor typed: those are their own words, shown back only to them, as plain text.
- **Per chat, shared, and per visitor:**
  - Per chat: history (the last 8 messages) and the excluded named bottles. Both were already looked up by `conversation_id`, so they needed no change.
  - Shared: the taste profile.
  - Per visitor: the in-memory one-message-in-flight lock (409 `chat_busy`). Two messages in two chats at once would read the same profile, and one merge would be lost. The daily count doesn't rely on this lock. An integration test runs the claim from two API instances (two separate locks) against one database.
- **The guest cap counts guests.** `count(DISTINCT subject)` over today's guest rows, and a guest with a row for *any* feature today counts as already in. A guest who uses chat and the concierge therefore counts once. Before, they would have counted twice, which the new test proves (it fails if the count goes back to `count(*)`). The env name `GUEST_DAILY_CONVERSATION_CAP` is kept so the GitHub secret and server `.env` need no change. The known overshoot for simultaneous brand-new guests (B34) is unchanged.
- **Retention: 30 days after a chat's last message** (`CHAT_RETENTION_DAYS` default 7 → 30), the same for guests and users. Counting from the last message means a chat in use doesn't vanish. Expired chats are deleted with their messages whenever any visitor starts a new chat (an indexed DELETE). With a chat list, the old 7 days would have emptied most of the list within a week. Nightly backups keep a deleted chat up to 14 more days. `llm_usage` holds counts and subject ids, never text, and is not purged. The chat list's footer states "30 days" in the web code; if the env value changes, change that line too.
- **Deletion by the visitor**, guest or user: a × on each chat in the list, then one inline "Delete this chat? Delete / Keep". No refund: the budget lives in `llm_usage`, so deleting a chat can't buy messages back.
- **Admin report split:** per day, `visitors` (distinct subjects), `guests` (distinct guests, what the cap counts), `chatsStarted`, `userMessages`, tokens, and cost. The month total drops visitors (one person on three days isn't three visitors). `chatsStarted` is counted from `chat_conversations`, so days older than the retention period undercount as their chats are deleted.
- **API:** `GET /api/chat` returns the budget and the list (most recently used first). `GET /api/chat/:id` returns one chat. `POST /api/chat` takes an optional `conversationId` and returns `conversation`. `DELETE /api/chat/:id` deletes a chat.
- **Web layout:**
  - The panel's height is `100dvh` minus the header and the page's own padding.
  - Below 901px the panel itself has that height and the taste card sits under it, folded behind a "Your taste profile" button. From 901px the grid row has that height and the card column scrolls on its own.
  - The chat list is the panel's left column from 1280px (Tailwind's `xl`). Below that it is a drawer over the conversation, opened by "Chats (N)" and closed by Close, Escape, or picking a chat. At 901–1279px three columns left the conversation about 390px wide.
  - One component instance serves every width (CSS classes switch), so tests and screen readers never meet two copies.
  - `interactive-widget=resizes-content` in the viewport meta makes Android shrink the layout viewport, and so `dvh`, when the keyboard opens. iOS Safari overlays the keyboard and scrolls the focused box into view instead; that wasn't checked on a real phone.
  - The open chat is in the URL (`?c=<id>`). No id is a new chat, which is also where the nav's Chat link lands.
- **Scrolling:** the message area has its own scrollbar.
  - New messages scroll into view while the visitor is within 48px of the bottom. Otherwise they stay put and a "New messages ↓" button appears.
  - Sending always scrolls down. A failed send, which removes the pending message, offers nothing.
  - Scrolling happens in a layout effect, so nothing flashes.
  - The scroll box is `position: relative`. Without it, the absolutely positioned screen-reader labels ("You:", "Assistant:") escaped its clipping and stretched the page by the whole conversation's height (1,811 px instead of 932 px at 1366 × 800). Found in the browser, not by a test.
- **Smaller changes:**
  - Recommendation cards always use the compact row layout (56px bottle, text beside), three across once the conversation area is 36rem wide (a container query, not a screen width). Tall cards would fill most of a fixed-height panel.
  - The page intro moved into the empty chat.
  - The message box is 2 rows with no resize handle.
  - On phones the counter drops "characters left", so the counter and Send share one row.
  - The loading state reserves the panel's height, so the footer doesn't jump.
- **Tests:**
  - API unit: new chat, title never from the model, foreign chat refused before a slot is claimed, list, one chat, 404s, delete without refund.
  - Integration (real Postgres): shared budget across three chats (the 9th refused in an old chat, the newest, and a brand-new one), history per chat, guest cap counting guests across three chats, a guest counted once across features, the race (five simultaneous claims at 7 used give exactly one 8th; two API instances posting to two chats give one 200 and one 429), delete with cascade and no refund, 30-day purge, refund leaving no empty chat, profile shared across chats.
  - Web: list order and dates, reopening with the shared count, continue vs new chat bodies, delete, gone chat, title as text, profile fold, and the three scroll rules with faked box sizes.
  - Each new cap test was checked to fail when its rule is broken.
- **Checked in the browser** against the dev stack at 1366 × 800, 1024 × 700, and 375 × 812, using a seeded test guest: list, reopen, delete, drawer, fold, no sideways scroll, page height fixed. One real send timed out: the dev container couldn't reach Anthropic ("no connection or timed out" after 40 s). The refund kept the count at 5, and the page showed the unavailable message. A reply arriving while scrolled up was therefore checked only by the web test.
- **Not done:** a guest's chats stay with the guest id after sign-in. The import offer moves bottles and the taste profile, not chats. Moving chats would need the import to rewrite `subject` on chats the browser can prove it owns.

### B37. M10: the concierge (2026-10-22)
- **It reuses the chat's machinery.** Same tables (`chat_conversations`, `chat_messages`), same atomic message claim, same reply guard, same one-message-in-flight lock, same panel components. Migration `008_concierge.sql` adds:
  - `chat_conversations.feature` (`chat` or `concierge`, default `chat`, so the old container's writes during a deploy stay chats);
  - `chat_conversations.slots` (the outing's validated slots);
  - `chat_messages.options` and `pick_reasons`.
  - Every conversation query now filters on feature, so a chat id never opens, continues, or deletes as an outing, and the reverse. Rejected: copying the two tables (two retention purges and two ownership checks to keep in step).
- **Slots need the visitor's own words.** The model returns each slot as `{ value, evidence }`, where evidence is a quote from the visitor's messages in this outing. The server keeps a value only if its quote really appears in what the visitor typed, ignoring case, accents, curly quotes, and end punctuation (`applyExtraction` in `services/concierge.ts`). A guess with no quote, or a quote the visitor never typed, is dropped, and the slot gets asked about. The model can fill or change a slot, never clear one. The prompt lists what "follows directly" means ("dinner at 8" means night, "freezing" means winter, "chilly" is not enough) and says never to guess projection from the occasion.
  - **Limit:** the quote proves the words were said, not that the inference is right. "a hike" quoted as evidence for `indoor` would pass. The prompt is the defence there.
- **Chips belong to the server.** SPEC section 9 has the model return `missing`, `next_question`, and `question_options`. Instead:
  - The server computes `missing` itself and always asks about the first missing slot, in a fixed order: occasion, time of day, season, setting, projection.
  - The chips are fixed: Low/Medium/High, Day/Night, Indoor/Outdoor, the four seasons with the current Toronto season first, and the 8 occasions.
  - The model only suggests wording (`next_question`), plus a `question_slot` naming the slot it asks about. Its wording is used when that is the server's next slot and the question passes the guard: no product, link, or rule talk, one line ending in "?", at most `CONCIERGE_QUESTION_MAX_WORDS` (30). Otherwise the server asks in its own words.
- **A chip answer skips the model.** A message that is exactly one of the open question's chips ("Night", "fall") fills that slot with no model call and no tokens. It still counts as a message.
- **Season chips:** Toronto's season comes from whole months in `occasions.yaml` (`season_months`: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall). The chips then follow the year from the current season (Fall, Winter, Spring, Summer in October).
- **The score** is SPEC section 9's formula. Every number is in `pipeline/config/occasions.yaml`: score weights, projection bands and credits, occasion family weights. Both cosines are floored at 0. With no taste profile, every bottle gets 0 for the taste term, so it changes no order.
- **Two things in the spec's score to review:** both decided in B38.
  - The season shares sum to 1 across the four seasons, so one season's share across the 1,000 runs only from about 0.06 to 0.43 (10th to 90th percentile; the largest any bottle has is 0.67). The night share runs from 0.16 to 0.68, and projection fit is 0, 0.5, or 1. So the season term, despite the largest weight (0.30), spreads the totals about as much as the day/night term (0.20), and both less than projection and occasion. Dividing each share by the bottle's largest season share would give season the pull its weight suggests. Measured from the pipeline's catalogue file.
  - `setting` (indoor or outdoor) is asked for but has no term in the score, so today it changes nothing. Options: raise the projection band one step for outdoor, or give it a weight. Both are Tejas's call.
- **Candidates:** the visitor's Own list (the guest store's ids for guests, the `collection` table for users). If the list is empty, or holds only ids the catalogue no longer has, the whole catalogue is used and the reply says so in one server line: "Your Own list is empty, so these come from the whole catalogue." With one or two owned bottles, the concierge shows one or two picks, with no catalogue fillers. Want is never used.
- **One sentence per pick, from facts only.** The second model call gets no name, brand, or slug. Per pick it gets: the occasion and its fit, the season and its vote share, the time of day and its share, the setting, strength (1 to 4), the wanted projection and whether the bottle is inside it, its families with at least 10% share (up to 3), and its facets at 0.2 or more (thresholds in `occasions.yaml` under `facts`). Each sentence is checked (`checkReason` in `services/pickReasons.ts`) and replaced by a server sentence built from the same facts if it fails:
  - the reply guard's product, link, and rule-talk checks (not its on-topic check);
  - one sentence, at most `CONCIERGE_REASON_MAX_WORDS` (40) words;
  - every number is one of that pick's numbers;
  - every family, facet, season, time-of-day, setting, and occasion word belongs to that pick or outing;
  - no note name, and none of "hours", "longevity", "lasts", "compliments", "price", "iconic", or similar claims the facts can't support.
  - A test holds the server's own sentence to the same check, for every projection case.
  - **Known limits:** plain adjectives ("elegant", "cosy") aren't checked; they claim nothing measurable. A negated mention ("not too sweet" on a bottle with no sweet facet) fails and falls back, which is safe but loses a good sentence.
- **Budget:** `CONCIERGE_MAX_USER_MESSAGES` (8), a separate `llm_usage` row per subject and day (`feature = 'concierge'`), claimed by the same `reserveMessage` statement before any model call. The guest cap is unchanged: it counts distinct guests across both features, so a guest who uses both counts once.
  - Anthropic down at the slot-filling call: the message is refunded, as in the chat.
  - Down at the sentence call: the picks still show, with the server's sentences, and the message counts.
  - Every call's tokens are logged.
- **To decide (settled in B38):** whether the 8th message forces a result, and whether chip taps count.
- **Admin report:** `chatsStarted` now counts chats only, and new `outingsStarted` and `conciergeMessages` columns cover the concierge, per day and per month. `userMessages` stays the total of both features.
- **Settings:** `CONCIERGE_MAX_USER_MESSAGES`, `CONCIERGE_QUESTION_MAX_WORDS`, `CONCIERGE_REASON_MAX_WORDS`, and `OCCASIONS_CONFIG_PATH` in `api/src/config.ts`, all with defaults, so production needs no new secret. The API image now copies `pipeline/config/occasions.yaml` next to `scoring.yaml`. The file is checked at startup: an unknown family name, weights that don't sum to 1, or a missing occasion stop the API.
- **Unverified until the first real call:** the extraction schema marks an unfilled slot's value with `anyOf` and `null`, next to an `enum`. No test can call the API. If Anthropic rejects the schema, the concierge shows "unavailable" and the API log prints the HTTP status.
- **Web:** `/concierge`, with "Concierge" in the nav after Chat.
  - The page reuses the chat panel: `ChatList`, `ChatInput`, and `MessageList` take their wording as props, and `PanelBar` moved to `pages/chat/PanelBar.tsx`.
  - The open outing is in the URL as `?o=<id>`.
  - Chips appear only under the latest question, and only while a message can be sent (B38: they stay usable after the typed budget is used).
  - The right column holds the outing card: the five slots ("—" while missing) and where the picks come from. Below 901px it sits under the panel, unfolded, because it is short.
- **Same as the chat (B36):** outings are deleted 30 days after their last message (one purge for both features), visitors can delete their own, titles are the visitor's first message, and a guest's outings stay with the guest id after sign-in.

### B38. Tejas's calls on the concierge after M10 review (2026-10-22)
- **Setting counts: outdoors raises projection one step.** The projection band moves up `outdoor_projection_steps` (1) strength steps for an outdoor outing, capped at 4: outdoor low wants 2–3, medium 3–4, high 4 only. Indoor changes nothing. The pick's facts say `projection_raised_for_outdoors`, and the server's own sentence adds "raised a step for outdoors".
- **Shares are rescaled before scoring.** `share_scaling: min_max` in `occasions.yaml` maps each season's share, and each of day and night, to 0..1 across the whole catalogue (the lowest bottle 0, the highest 1), so the 0.30 and 0.20 weights mean what they say. `none` restores the raw shares.
  - The ranges come from the whole catalogue, not the candidates, so a bottle's score doesn't change with what else the visitor owns (tested).
  - The model's facts keep the raw vote shares ("38% of season votes say fall"): those are what a sentence can truthfully say. Only the score uses the rescaled numbers.
  - If every bottle had the same share there would be no spread, and the term scores 0 for all.
- **Chip taps are free.** A message that is exactly one of the open question's chips, in an existing outing, claims no slot and calls no model for the slot. Only typed messages count against the 8. Typing a chip's exact word ("night") is indistinguishable from tapping it, so it is free too. A chip word as the first message of a new outing is a typed message: no chips have been shown yet.
  - A free chip that completes an outing still makes the sentence call. Its tokens are logged by an upsert, which creates the day's row with 0 messages when there is none (an outing continued on a new day). Such a row also counts the guest toward the site-wide guest cap.
  - After the 8 typed messages, the input closes but the chips keep working; the server's 429 and the page both say so.
- **The day's last typed message forces a result.** When it leaves slots missing, they are assumed: the current Toronto season, night from 5 p.m. Toronto time (day before), medium projection, indoor (all in `occasions.yaml` under `defaults`, the season from `season_months`). One server line lists them: "This was today's last message, so I assumed day, fall season, indoor, and medium projection."
  - **Occasion has no default in Tejas's list, so a missing occasion is not assumed.** Occasion fit is then 0 for every bottle, which leaves it out of the ranking, and the line says "no occasion, so occasion fit isn't scored". Pick a default occasion instead if preferred.
  - The assumed values are not stored as the outing's slots; the outing card still shows what the visitor actually said.
  - Two invalid model answers on the last message still end in a result, from the slots known so far plus the defaults.
- **The server's own sentence** is now shorter ("Mostly Woody Amber, sweet and spicy; 38% of season votes say fall, 71% of day-or-night votes say night; strength 3 of 4, inside the medium projection range."), so it fits the 40-word limit even with the outdoor clause. It says "projection range", not "you asked for", because on a forced result the projection may be assumed.
- **No default occasion** (Tejas's call after the real-key test): a forced result leaves occasion fit out, as above.
- **Panel buttons are icons on phones.** Below 641px the list button shows a list icon and the count, and the "new" button a plus; their accessible names keep the words ("Outings (2)", "New outing"), so the title has room. The chat shares the bar, so it changed too. From 641px the buttons show their words as before.
- **"outside" is no longer an outdoor word** in the sentence check: "outside the wanted range" is about projection, and flagged good sentences.
- **occasions.yaml reviewed:** wedding is now Soft Floral 0.8, Floral 0.6, Woods 0.6, Citrus 0.5, Aromatic Fougère 0.4, Floral Amber 0.4, Soft Amber 0.4; formal_event's Mossy Woods 0.7 → 0.5; night_out's Soft Amber 0.4 → 0.6. The CHECK markers are cleared.
- **Checked:** the API suite with the Postgres integration tests (268 passing, none skipped), pytest, and the page in the browser against the dev stack at 1366 × 800 and 375 × 812 with a seeded test guest (no model calls): the outing list, a finished outing's picks and sentences, a free chip tap (the database showed the count and tokens unchanged), no sideways scroll, and the page height fixed. Migration 008 ran on the dev database; its 4 existing chats became `feature = 'chat'`.

### B39. M11: smoke tests, a test catalogue in CI, accessibility, and the README (2026-10-22)
- **A small test catalogue, committed.** CI has no Kaggle files and can't run the pipeline, and the full catalogue is 44 MB. `db/test-catalogue.sql.gz` (250 KB) holds 125 bottles: the 100 most voted, ids 1 to 10, and every bottle a test looks up by name (Aventus, Club de Nuit Intense Man, Cool Water, MYSLF, Myrrh & Tonka, the Stronger With You bottles, Hawas, and so on), plus the two most voted of each brand the alias and accent tests search for. Ids and slugs are the real ones. All notes, families, and aliases come along. `scripts/test-catalogue/stage.sql` picks them into a `seed` schema of the same shape as `scripts/seed/stage.sql`, so CI loads it with the production `merge.sql` (`scripts/test-catalogue/load.sh`): the seed path gets exercised on every push.
  - **Pair lists are cut to the subset, not rescored.** Each list keeps the full catalogue's order, renumbered 1..N, and its scores are rescaled so the best partner is 100 again (the stored score is the display score, B13).
  - **`\restrict` lines are removed.** pg_dump 16.10 and later wraps a dump in `\restrict`/`\unrestrict`, which older psql clients refuse. They protect against a malicious server's dump; this file is ours and reviewed in git.
  - **Rebuild** with `scripts/build-test-catalogue.ps1` after a pipeline change the tests should see.
- **CI now runs the integration tests.** The API job has a `postgres:16` service with the catalogue loaded and sets `TEST_DATABASE_URL`, so the 54 tests that used to skip run there (268 in all). Its password is a CI-only placeholder, not a secret.
  - **Two bugs surfaced on the first run, both fixed:**
    - **Guest import with the same bottle twice.** "The first entry wins" had relied on the order the JOIN returned rows, which changes with the query plan. The 125-row table got a different plan from the 1,000-row one, and the second entry won. The import now picks the first entry explicitly (`WITH ORDINALITY` and `DISTINCT ON`).
    - **A race between test files.** The chat and concierge guest-cap tests both count "distinct guests today" in one database; run in parallel, one file's new guests landed between the other's count and its check. With a test database, Vitest now runs files one at a time (`fileParallelism`), about 43 s instead of 26 s. Without one, files stay parallel.
- **Smoke tests in `e2e/`** (its own `package.json`, like `api/` and `web/`), Playwright 1.64, Chromium only. Four tests: pair a fragrance and switch the goal; sign up and save a bottle (checked after a reload, so it came from the account); one chat; one outing (a typed message, then a free chip tap, then picks). SPEC listed three; signing up was added at Tejas's request.
  - **What runs:** the real API (`npm start`) and the production web build (`vite preview`, which proxies `/api` like the dev server) against the test catalogue, on their own ports (API 3100, web 4173), so they never touch the dev stack.
  - **The model is a local fake** (`e2e/mock-anthropic.mjs`) that answers `POST /v1/messages`, told apart by the JSON schema the API asks for. The real `llm.ts`, caps, reply guard, and pick code all run. New setting `ANTHROPIC_BASE_URL` (blank means Anthropic) points the SDK at it. The API gets a fake key too, so if the base URL were ever ignored, Anthropic would answer 401, and nothing would be billed. The tests read the fake's call counts to prove the chat and the concierge really went through it, and that the chip tap made no slot call.
  - **CI job `e2e`:** its own Postgres service and catalogue load, then the tests. On failure, the HTML report and traces are uploaded for 7 days.
- **Lighthouse accessibility** (13.5.0, mobile and desktop, on the production build with the test catalogue). The chat and the concierge were measured holding a real conversation and a finished outing, not empty. Before → after:

  | Page | Before | After |
  |---|---|---|
  | Pairing, with results | 93 | 100 |
  | Pairing, empty | 100 | 100 |
  | Browse | 100 | 100 |
  | Fragrance | 93 | 100 |
  | Chat | 96 | 100 |
  | Concierge | 93 | 100 |

  The fixes:
  - **The `dim` text colour went from #77736c (3.8:1 on panels) to #8a857d** (4.7:1 on the bottle frame, 4.9:1 on panels, 5.4:1 on the page; AA is 4.5:1). This is a deliberate step away from the Figma export (decision 36): every summary, tag, and caption is a little brighter.
  - **Text in `faint` or `ghost` moved to `dim`:** the footer's data credit, the chat list's 30-day note, score captions, inactive tabs, the "Sign in to review" link, and the two × buttons. `ghost` is gone; `faint` is now only for input placeholders and the decorative "NO." above ranks.
  - **The rank finder's idle line** ("#— of 999") was faded with 25% opacity (1.4:1). It now uses quiet colours instead.
  - **Rank numbers** were an `aria-label` on a `div` with no role, which screen readers may ignore. They're now hidden text ("Rank 1").
  - **Links inside sentences** (the fragrance page's About link, the outing card's collection link) are underlined, so colour isn't the only cue.
  - **The logo link** lost its `aria-label` ("Scense home"), which didn't contain its visible text. Its name is now "Scense".
  - Not in CI: the scores were measured once by hand, with a throwaway script. **Revisit when** the design changes; Lighthouse CI could hold the line.
- **Migration 009 drops `llm_usage.conversation_id`**, the contract half of B36's expand-and-contract change. 007 and 008 have each been live through a deploy, and nothing has read or written the column since 007. Dropping a column only marks it dropped, so the lock is brief. SPEC section 5's `001_init.sql` listing no longer shows the column.
- **"Zero-downtime" is about the schema, not the restart.** Expand-and-contract means old and new code both work against the schema mid-deploy. `docker compose up -d` still recreates the API container, which costs a few seconds of failed requests. The README says "zero-downtime schema changes" for that reason.
- **README:** written for a 60-second read. The screenshot (`docs/images/pairing.jpg`) is the dev stack with the full catalogue, Club de Nuit Intense Man on Soften. It was taken with Fragrantica's image host (`fimgs.net`) blocked, so it shows the drawn placeholder bottles (B19), not their photos (Tejas's call). The live site only hotlinks the photos; committing a picture of them would put copies of Fragrantica's images into a public repo, which their unconfirmed licence (decision 15, B19) doesn't cover. The architecture diagram is Mermaid, which GitHub draws.
- **Secret scan before going public** (all 23 commits, every added line, every filename ever added; no scanner was installed, so it was a pattern scan): no keys, tokens, private keys, passwords, or `.env` files. Every committed value is a placeholder, a dev default, or a test fixture. Not secrets, but public once the repo is: the server's IP (in the runbook and `seed-prod.ps1`; DNS already publishes it), the backup bucket's name, and the author email in every commit.

### B40. Schema warm-ups after a cold-schema timeout in production (2026-10-26)
- **What happened.** A production chat message timed out, and the next try answered at once. The failed call was the first structured-output call after the chat's schema had gone cold. Anthropic compiles each JSON schema the first time it sees it and keeps the result for 24 hours after its last use; a call that must compile first can take long enough to pass the old 20-second `LLM_TIMEOUT_SECONDS`. The site's traffic is low, so a schema can sit unused for a day and go cold at any time.
- **The fix: warm-ups** (`api/src/services/warmup.ts`). Once at startup and then every `LLM_WARMUP_HOURS` (20), the API sends one tiny call per schema: the chat's, the concierge's slot reading, and the concierge's pick sentences for 1, 2, and 3 picks (each count is a different schema, so a different cache entry; fewer than 3 picks happens when a visitor owns fewer bottles). Each call passes the very schema object the real calls send, a three-word system prompt, `{}` as the message, and `max_tokens: 1`. 20 hours leaves four hours of margin before the 24-hour expiry.
  - **No visitor pays.** Warm-ups never claim a message. Their tokens go to `llm_usage` under subject `system:warmup` (with the `chat` or `concierge` feature, so no migration is needed). The guest cap counts only `guest:` subjects and each budget is keyed by its own subject, so neither sees them. The admin report leaves them out of `visitors`, keeps them in the token totals, and shows `warmupEstimatedUsd` per day and for the month.
  - **Failures never hurt the API.** Warm-ups start after `listen` and are never awaited. A failed call is logged and only the failed schemas are tried again every `LLM_WARMUP_RETRY_MINUTES` (15) until they succeed or the next full run starts. A failed token write is logged and not retried (the schema is warm either way). The timers are `unref`'d.
  - **Off when there is nothing to warm or nothing to bill:** no `ANTHROPIC_API_KEY`, `LLM_WARMUP_HOURS=0`, or a test run (`VITEST` or `NODE_ENV=test`). The Playwright smoke tests set `LLM_WARMUP_HOURS=0`, since warm-ups would race their call counts on the fake.
- **Backstop: `LLM_TIMEOUT_SECONDS` 20 → 45.** If a schema is cold anyway (Anthropic evicts early, or a deploy changes a schema and a visitor beats the startup warm-up), the call now waits long enough to compile instead of failing. With the one SDK retry, the worst case is 90 seconds before "unavailable"; a dead connection still fails in milliseconds.
- **Cost:** about 1–2 cents a month. The five schemas are about 4,300 characters of JSON, roughly 1,300 tokens; allowing for the prompt and any format instructions Anthropic adds, call it at most 3,000 input tokens and 5 output tokens a run. 36 runs a month plus one per deploy or restart (about 45) is about 135,000 input tokens: $0.014 at $0.10 per million, and the output is a rounding error. An outage adds retries, but calls that fail are not billed. The admin report shows the real number.
- **Revisit when** a new structured-output schema is added: it must go into `warmupSchemas()` too (the test there lists them all).

### B41. Quality of life changes before the LinkedIn launch (2026-10-27)
The last polish before the site is posted on LinkedIn, where most visitors arrive cold, on a phone, from a link preview.
- **A home page at `/`; pairing moved to `/pair`.** A visitor from a post doesn't know what Scense does yet, and the pairing page assumed they did. The home page is one line ("Welcome to Scense.") and five cards: Layer, Chat, Concierge, Browse, Collection, each with a title, one line, and a button, plus a "How the scoring works" link to `/about`. Layer is the primary card: the largest, the only one with a gold border and a filled gold button, and the only one with a picture (two drawn bottles, decoration only). Decisions 2 and 6 still hold in spirit: layering is the first thing offered, and there is still no login wall.
  - **All five cards fit above the fold at 375×812, 768×1024, and 1366×768.** From 901px Layer is the tall left column beside a 2×2 grid; below that it spans the width above the grid. On phones the four smaller cards stay two across, with shorter lines, no kicker, and no arrow on the button so labels never wrap.
  - **Each card is one link.** The button's `::after` covers the card, so a click anywhere follows it, but only the button is a tab stop and its text is the link's name.
  - **The nav item is "Layer", not "Pair"**, so it matches the card and the page's own words ("what to layer with them"). The logo links home.
- **Old links still work.** Links shared before the move point at `/?f=...`. The home page sends any URL carrying a pairing param (`f`, `mode`, `goal`, `notes`) to `/pair` with the same query string (`<Navigate replace>`, so Back doesn't bounce). Other params, such as a tracking tag LinkedIn or a newsletter adds, don't count, so they never hide the home page. Done in the browser, not Caddy: the single-page app already serves `/` from `index.html`, and one rule in one place is easier to test. `pairHref()` builds every "Pair this" link.
- **Brighter body copy.** The `soft` token (the serif intros, About body text, card lines, 28 uses in 17 files) went from the export's `#969189` to `#aca79e`: 6.3:1 → 8.2:1 on the page (`#0b0b0a`), 5.7:1 → 7.5:1 on panels (`#171715`), past AAA's 7:1. It stays a clear step below `text` (`#ede6d8`): 1.9:1 between them, so the hierarchy holds. `muted` (nav, `#8f8b83`) and `dim` (fine print, `#8a857d`) are unchanged.
- **Accent words are bold, not italic.** Cormorant's italic is thin at body sizes and read as decoration. A new `accent` utility (gold-pale, weight 700, no italic) replaces the italic gold in every place it was used: the page titles on Pair ("second scent."), Browse ("every bottle."), About ("one wheel."), Collection ("and want."), Sign in and Sign up ("collection.", "in."), and Not found ("here."), plus About's body terms "profile", "facets", and "gentler" (its `Em` helper). The home title's "Scense." uses it too. Cormorant Garamond's 700 weight is now loaded (the page sets `font-synthesis: none`, so it would otherwise fall back to 600).
  - **Left italic on purpose:** the logo's "S" (a brand mark, gold and italic; the favicon matches it), and two italic captions that are not in an accent colour (the score caption and the chat's "thinking" line, both `dim`). The formula's variables are italic by maths convention and drawn in the text colour, not gold.
- **The About page's ring distance, rebuilt** (`pages/about/RingDistance.tsx`).
  - **The formula is typeset with MathML**, which Chrome, Edge, Firefox, and Safari all draw natively, in the system maths font (Cambria Math on Windows, STIX Two Math on Apple). KaTeX was rejected: a few hundred KB of script, styles, and fonts for one formula. React renders MathML but its JSX types don't list the elements, so `src/mathml.d.ts` declares the five used.
  - **Plain words for i and j** (each family's position on the ring, 0 to 13 clockwise from Soft Amber) and **a worked example** that follows the selected family: "Soft Amber (0) to Fruity (10): |0 − 10| = 10 steps one way, 14 − 10 = 4 the other, so 4 steps the short way round." Until the visitor points at a family, the partner is ten steps clockwise, so the example shows why the formula takes the minimum.
  - **The ring:** each label sits just outside its own node (anchored left, right, or centred by which side of the ring it's on), lines run from the selected family to every other, the selected node is larger with a gold edge and a bold label, and every node is a keyboard button (Tab, then Enter or Space) with a gold focus ring around the node. A legend explains brightness (its wording flips with Enhance and Soften), colour (each family's tint, not a score), and the number (steps from the selected family).
  - **Phones get a list, not the ring.** Below 641px the ring's labels would be too small to read, so the same data shows as a ranked list of buttons: closest first for Enhance, farthest first for Soften. Tapping one measures from it.
  - **Still no affinity numbers** (B20). The brightness curves are drawn shapes only; the legend uses words. The real tables stay in `scoring.yaml`.
  - **The digits sit outside the buttons**, in their own hidden layer. Inside, axe counted them as visible text that the button's label didn't start with (`label-content-name-mismatch`), which matters to voice-control users.
- **Link previews.** `index.html` carries Open Graph and Twitter card tags (title "Scense: fragrance layering, ranked", one-sentence description, image, alt text), since crawlers don't run JavaScript. The image (`web/public/og-image.png`, 1200×630) is the home page itself, rendered by Playwright at 1600×840 CSS pixels and 0.75 scale with Fragrantica's image host blocked. The home page only draws placeholder bottles, so no Fragrantica photo is in it (as with the README screenshot, B39). Regenerate it by hand when the home page changes; nothing in CI does.
- **Favicon.** `favicon.ico` (32 and 48 px), `favicon.png`, and `apple-touch-icon.png` (180 px, on the page colour, since iOS fills transparency with black or white), rendered from the logo mark: the gold-ringed italic "S" in Cormorant Garamond on ink.
- **Lighthouse accessibility** (13.5.0, mobile and desktop, production build, test catalogue; chat and concierge holding a real conversation and a finished outing, Collection holding a bottle): **100 on every page**: Home, Pairing (empty, with results, notes), Browse, Fragrance, Chat, Concierge, Collection, About, Sign in, Sign up, and Not found. Measured by hand with a throwaway script, as in B39.
- **Tests:** `HomePage.test.tsx` (the cards and their links, the nav, the old-link redirect, a tracking tag not redirecting) and `AboutPage.test.tsx` (the typeset formula, the worked example, selecting by click and by keyboard, the legend switching with the goal, the phone list's order). Pairing tests now load `/pair`, except one that loads an old `/?f=` link on purpose. The first smoke test starts on the home page and follows the Layer card.

### B42. Feedback round 1: price guidance, the note pyramid, picks beyond the Own list, and brand pages (2026-10-28)
From a friend's testing. SPEC section 13 lists it as M13.
- **What price data the dataset has.** No prices. Each bottle has a value-for-money vote histogram (`price_value_b1..b5`, 1 overpriced to 5 great value). All 1,000 catalogue bottles have 198 to 22,444 such votes (median 1,873). Eight descriptions mention a launch price, in mixed currencies and years; they are not used.
- **Two kinds of price guidance, neither a price.**
  - **Value for money:** the mean of the votes and how many there were, hidden under `price.min_value_votes` (100) in `scoring.yaml`. Nothing is hidden today; it is a guard for a bigger catalogue, like `min_strength_votes`.
  - **An approximate tier,** `$` to `$$$$`: a band of typical retail for a 100 ml bottle in CAD, under 75, 75 to 150, 150 to 300, over 300 (`price.tier_edges_cad`). It comes from two reviewed files, never from the model: `brand_tiers.csv` gives every catalogue brand a default, and `tier_overrides.csv` moves a line (the dataset's `collection`, such as Tom Ford `Private Blend`) or one bottle (its slug) to another tier. A slug row wins over a line row. The tiers are estimates of Canadian retail, not looked up from a shop.
  - **Tejas's review:** Lanvin and Laura Biagiotti went to `$`, every other draft row stayed, and the `# CHECK` markers are cleared. He asked for `$$$$` rows for Armani Privé, Gucci The Alchemist's Garden, Dolce&Gabbana's Velvet Collection, Givenchy L'Atelier, and Burberry Signatures if the catalogue holds any: it holds none. The dataset has them (as `Armani Prive`, `ARMANI PRIVE The Thousand and One Nights Collection`, `Armani Prive Les Eaux`, `Armani Privé Les Éditions Couture`; `Gucci The Alchemist's Garden`; `The Velvet Collection`; `L’Atelier de Givenchy`; `Burberry Signatures`), but their most voted bottles have 90 to 2,538 votes, under the 3,579 the catalogue starts at. Add the rows if the catalogue grows.
  - **Split:** 136 bottles at `$`, 243 at `$$`, 441 at `$$$`, 180 at `$$$$`.
  - **Checks:** ingest fails on a catalogue brand with no tier (like an unmapped accord) and prints a note for an override that matches no bottle; a pytest checks every override matches today.
- **Storage: migration 010.** `fragrances` gains `collection`, `price_tier`, `value_votes`, and `value_score`; `notes` gains `image_url`. All can be empty (`value_votes` defaults to 0), so the deploy migrates first and the old container keeps working. **They stay empty until the next reseed** (`scripts/seed-prod.ps1`, whose `merge.sql` now carries them), and until then the site shows no tier, no value line, and drawn note icons. The test catalogue was rebuilt with them and now keeps Tom Ford's and Lattafa's two most voted bottles too.
- **The API** returns `price` (`{ tier, minCad, maxCad }`) and `value` (`{ score, votes }`) on every fragrance it shows: lists, the detail page, pairing partners, and chat and concierge picks. The band edges come from `scoring.yaml`, so the page's tooltip can't drift from the config.
- **On the page.** The tier is a small "`$$$` approx." button: hover, focus, or a tap shows the band ("A 100 ml bottle is usually about 150 to 300 CAD. A rough tier, not a price."), and Escape closes it. Its accessible name is set with `aria-label` so every browser reads "Approximate price tier $$$ approx." (jsdom ran the visible spans together without the space). It sits beside "Value for money 3.2/5 · 1,873 votes" on fragrance pages, result rows, Browse cards, and chat and concierge picks. The fragrance page adds "Check current prices", a Google Shopping search for brand and name in a new tab (`noopener noreferrer`); the query holds nothing about the visitor.
- **The chat's budget.** The model's JSON gains `budget`: `kind` (`none`, `max` with `max_cad`, `affordable`, `luxury`, or `any`) and `evidence`. As with the concierge's slots (B37), the server keeps it only when the evidence is the visitor's own words in that message, so the model can't invent one. It is stored with the chat (`chat_conversations.slots`, empty for chats until now) and lasts until the visitor states another; "price doesn't matter" clears it.
  - **What it does:** "under $100" favours `$` fully and `$$` by the share of its band under 100 (75 to 150, so a third: its cheaper end); "cheap" or "affordable" favours `$` and `$$`; "luxury" or "niche" favours `$$$$`. A bottle outside the budget keeps `1 - price.budget_pull` (0.3) of its score, so a much better match can still appear: a preference, not a filter. It reorders only bottles the visitor doesn't own (the owned ones are already bought) and never changes the match percentage shown.
  - **The server says so** in one sentence of its own, in tier symbols only: "Noted your budget: picks now lean toward $ and the cheaper end of $$ bottles (approximate tiers)."
  - **The model never states a price.** The prompt says so, and the reply guard has a fifth check (`statesPrice`): an amount of money ("$120", "90 dollars", "CAD 150", "€80") or a run of tier symbols (`$$`). It covers chat replies and summaries, concierge questions, and pick sentences, which fall back to the server's own text. A lone `$` is allowed.
- **The concierge: beyond the Own list.** Two optional slots, never asked about, filled from the visitor's quoted words like the others or by a chip:
  - `source: catalogue`, from "something I don't have" or the **"Show picks I don't own"** chip under Own-list picks. Picks then come from the catalogue minus the Own list, and the reply and outing card say so. A typed request goes straight to catalogue picks.
  - `budget` (`$` to `$$$$`, meaning up to that tier, or `any`). **A deviation from the request:** it asked for an optional budget question with chips. A question before the picks would add a step and contradict "straight to catalogue picks", so the budget chips (`$`, `$$`, `$$$`, `$$$$`, `Any`) appear under catalogue picks instead, and tapping one reruns them. Each budget chip's spoken name is "Budget up to $$, approximate". On Own-list picks a budget changes nothing.
  - Both chips are free, like every chip (B38). Which chips apply follows from the outing (Own-list picks offer the catalogue; catalogue picks offer budgets), so nothing about the last reply is stored. The outing card shows "Budget: Any" until one is set. A forced result (the day's last message) keeps both slots.
- **Warm-ups (B40).** Two structured-output schemas changed, the chat's (`budget`) and the concierge's extraction (`budget` and `source` slots). Both are the very objects `warmupSchemas()` already sends, so they are warmed at startup and every 20 hours with no new entry. No new schema was added. The first warm-up after the deploy compiles them before a visitor is likely to arrive; the 45-second timeout covers the gap.
- **The note pyramid.** Three tiers, narrow at the top: Top ("the first impression, for roughly the first 15 to 30 minutes"), Heart ("the main character, over the next few hours"), Base ("the dry-down that lasts longest"). A fragrance without layers gets one "All notes" row that says so. Each note is a chip tinted by its dominant family (neutral for an unmapped note) with Fragrantica's 120 px note icon (`fimgs.net/mdimg/sastojci/t.{id}.jpg`), hotlinked like the bottle photos (B19), so the same licence caveat applies. The icon's 28 px frame is fixed, so nothing moves as icons load. A missing or refused icon becomes a family-tinted drop.
  - **Where the icons come from:** only the JSONL has `notes[].image_id`, so ingest now streams the 550 MB file, parsing only catalogue lines (each starts with its id). A note listed under a variant spelling borrows that variant's picture when the canonical name has none. All 619 catalogue notes have one.
- **Browse photos in true colour.** Browse cards drop the sepia filter and the multiply blend, which dulled the photos. **The paper tone went too:** without the blend, the photos' own white backgrounds would sit as white boxes on paper, so the frame is white and meets the photo with no seam. Elsewhere photos keep the paper look. Each frame has a 1 px outline in the accent gold (`gold-pale`, the bold accent words' colour) at 45%, full on hover and focus.
  - **The card is no longer one big link:** its name's link stretches over the card (`::after`), so a click anywhere still opens the bottle, while the brand link and the tier button sit above that layer. A link can't hold another link or a button.
- **Placeholder bottles on one baseline.** The home page's decorative pair had frames of different heights (the second was 82% of the first), and the drawing centres itself in its frame, so the two bottles differed in height and baseline. Both now share one frame size. Every other placeholder already sits in a frame of fixed size.
- **Brand pages.** `/browse?brand=<brand>` is Browse filtered to one brand, headed with its name, with the same search, filters, and sort, and a link back to all brands. The API's `brand` parameter accepts the brand as the dataset spells it (case and accents ignored: "hermes" is Hermès) or a `brand_aliases.csv` alias ("YSL"), so every spelling lands on one page, and it returns the catalogue's spelling for the heading. An unknown brand is a 404 `unknown_brand` with a plain message on the page. Brand names link there on the fragrance page, result rows, Browse and Collection cards, the selected-bottle strip, and chat and concierge picks. **Not linked:** the two search dropdowns, whose rows are listbox options (they can't hold links), and the page title.
- **Tests.** Pipeline: `test_price.py` covers the tier files, the order of brand, line, and slug rules, value votes, and note pictures; the seed-merge test now checks the new columns. API: `price.test.ts` covers bands, value votes, budget fits, the evidence rule, budget-weighted picks for both features, and the price guard; route tests cover the chat's budget, the concierge's chips, and the brand filter; integration tests check real tiers, note pictures, and brand aliases. Web: `FeedbackRound1.test.tsx` covers the tier tooltip, the prices link, brand pages, the pyramid, and the icon fallback.
- **Tap targets (WCAG 2.5.8).** The first Lighthouse pass scored 97 on Browse, brand pages, pairing results, and the fragrance page. Brand links are small text right above a name link. Padding them to 24 px only moved the problem: their tap area reached into the row above and crowded its Want and Own buttons. So the brand link keeps its natural size and gets clear space instead (the rule's spacing exception): at least 8 px down to the name link (`mt-2`), and pairing result rows gain 20 px of padding top and bottom from 641 px (the export had none), because the price line can make a row taller than its 142 px minimum. The tier button is 24 px tall. The pyramid's tier lines moved from `dim` to `soft`, since `dim` fell below 4.5:1 on the two darker tier fills.
- **The web suite's per-test limit rose from 5 s to 15 s** (`vitest.config.ts`). `findBy*` already waits up to 5 s (B34), so with 13 files in parallel a test that signs up, imports, and reloads could fail at exactly 5 s. Four did, every full run on this machine, and passed alone.
- **Lighthouse accessibility** (13.5.0, mobile and desktop, production build, test catalogue; the chat and concierge measured holding a conversation and a finished outing): **100 on all 14 pages**, the new brand page included (Home, Pairing empty, with results, and notes, Browse, a brand page, Fragrance, Chat, Concierge, Collection, About, Sign in, Sign up, Not found), with no failing audit. Measured by hand, as in B39 and B41.
