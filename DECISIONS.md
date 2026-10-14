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
- **Why:** That size covers most popular searches and keeps a one-week build manageable. Women's scents give Soften more partners, since a rose or powdery floral can round off a harsh woody scent.

### 17. Strength from longevity and sillage votes, with concentration as the fallback
- **Decision:** Strength on a 1 to 4 scale comes from community votes. Fragrances with under 50 votes fall back to concentration.
- **Why:** Concentration alone rates Club de Nuit Intense Man, an EDT, as moderate, though it performs like a parfum. The votes fix that. Under 50 votes, the averages get noisy.

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
- **Why:** About 179,000 precomputed rows make the "#38 of 299" lookup a single indexed query. 150 notes are cheap enough to score per request.

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
