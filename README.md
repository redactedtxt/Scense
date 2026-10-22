# Scense

**Scense ranks which fragrances to layer with the one you own: to amplify it, or to soften its edge.**
Live at **[scense.name](https://scense.name)**. No sign-up needed.

![The pairing page: Club de Nuit Intense Man, Soften, with its top three partners ranked](docs/images/pairing.jpg)

Pick a bottle and a goal, and Scense ranks the rest of its 1,000-fragrance catalogue as layering partners, with a score you can trace back to the math. There's also a catalogue to browse, a chatbot that turns "I like warm, spicy things" into a taste profile, and a concierge that picks tonight's bottle from your collection.

## How the pairing engine works

**The fragrance wheel.** Perfumers sort scents into 14 families on a ring, the Michael Edwards fragrance wheel: Soft Amber, Amber, Woody Amber, Woods, and on around to Floral Amber. Each fragrance becomes a 14-slice profile on that ring, built from its community-voted accords, plus six facets the wheel lacks (sweet, creamy, powdery, spicy, smoky, sharp) and a harshness score.

**Enhance vs Soften.**
- **Enhance** means "more of what you have." Families close together on the ring score high, so a fragrance's nearest matches are its near-clones.
- **Soften** means "tone it down." Families across the ring score high, only partners gentler than the base qualify, and a partner much weaker than the base is marked down because it would get buried.

**The eigenvalue fix.** Enhance scores pairs through a 14 × 14 table of how well each pair of families match. My first table had a negative eigenvalue (−0.054). In plain words, it wasn't a true similarity: for 94 of 300 fragrances, some other bottle scored higher with the fragrance than the fragrance did with itself. Retuning the table made it positive definite (smallest eigenvalue +0.2). Now a fragrance always matches itself best, and a test fails the build if a future tweak breaks that.

A Python pipeline precomputes all 1.5 million pair scores, so "Baccarat Rouge 540: #38 of 999" is one indexed query. **[The About page](https://scense.name/about)** walks through it with a diagram.

## Architecture

```mermaid
flowchart LR
  browser[Browser] -->|HTTPS| caddy
  subgraph ec2["One AWS EC2 instance (Docker Compose)"]
    caddy["Caddy<br/>TLS + the web build"] -->|/api| api["API<br/>Node 24 + Express"]
    api --> db[("PostgreSQL 16")]
    backup["Backup job<br/>nightly pg_dump"] --> db
  end
  api -.->|chat and concierge only| claude["Anthropic API<br/>Claude Haiku 5.5"]
  backup -->|"instance role:<br/>one bucket prefix only"| s3[("S3<br/>14-day retention")]
  gha["GitHub Actions<br/>lint, typecheck, unit +<br/>integration + Playwright tests"] -->|images| ghcr["GitHub Container<br/>Registry"]
  gha -->|"SSH: pull, migrate,<br/>up -d, health check"| ec2
  ghcr -.->|docker pull| ec2
```

## Tech stack

| Layer | Choice |
|---|---|
| Web | React 19, TypeScript, Vite, TanStack Query, Tailwind CSS v4 |
| API | Node 24, Express, Zod validation, `pg` |
| Data pipeline | Python 3.12, pandas, pytest (offline: cleaning, scoring, precompute) |
| Database | PostgreSQL 16 (full-text search, `pg_trgm` typo matching, `unaccent`) |
| AI | Claude Haiku 5.5 through the official Anthropic SDK, structured JSON outputs |
| Tests | Vitest + Supertest, Testing Library, pytest, Playwright |
| Infra | Docker, Docker Compose, Caddy, GitHub Actions, AWS EC2 and S3 |

**The DevOps work:**
- **CI/CD.** Every push runs lint, typechecks, and the API, web, and pipeline tests. API integration tests and Playwright smoke tests run against a throwaway Postgres loaded with a small test catalogue. A push to `main` reruns all of that, builds three Docker images, pushes them to GHCR, deploys to EC2 over SSH, and fails the job if `/api/health` isn't 200 within 60 seconds.
- **Docker.** Separate images for Caddy (with the web build baked in), the API, and the backup job. The server holds only a compose file and an `.env` that the deploy rewrites from GitHub secrets each time.
- **Least-privilege IAM.** The server has no AWS keys. Its instance role can put, get, and list objects under one prefix of one bucket, and an S3 lifecycle rule handles deletion, so a compromised server can't erase old backups.
- **Migrations.** Plain SQL files run by `node-pg-migrate`. The deploy migrates *before* starting new containers, so new code never meets an old schema.
- **Zero-downtime schema changes (expand-and-contract).** When chats moved to their own table, migration 007 only made the old column nullable, so the old container could keep writing it during the deploy. Migration 009 drops it now that no running container can still need it.
- **Backups.** A nightly `pg_dump`, checked with `pg_restore --list` before upload, plus a restore script.

## How the AI stays safe and cheap

- **The model never names a fragrance.** It only turns words into weights ("stings the nose" → spicy). The server scores the catalogue and picks every bottle. In the concierge, the model never even sees a bottle's name, only its facts. Before any reply is shown, the server checks it, and replaces any reply that names a catalogue bottle or brand, holds a link, or wanders off topic.
- **Server-side caps.** Each visitor gets 8 messages per feature per day, claimed in one atomic SQL statement *before* the model is called, so two quick messages can't both be the 8th. A site-wide cap allows 100 guests a day. Every call is limited to 400 output tokens and the last 8 messages of history.
- **Cost.** An 8-message chat is about 15,000 input and 1,600 output tokens, roughly **$0.002**. The worst case, with every message at the length limit and every call retried, is under a cent. Tests and CI use a fake model and never call Anthropic.

## Run it locally

You need Docker, Node 24, and Git Bash on Windows.

```bash
git clone https://github.com/redactedtxt/Scense.git && cd Scense
docker compose up -d --build                  # Postgres, API on :3000, web on :5173
(cd api && npm ci)
DATABASE_URL=postgres://scense:scense_dev@localhost:5432/scense PSQL_CONTAINER=scense-db-1 \
  bash scripts/test-catalogue/load.sh         # migrations + a 125-bottle sample catalogue
```

Open http://localhost:5173. For the full 1,000 bottles, download the [Decant dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes) into `pipeline/raw/` and run `python pipeline/src/run.py pipeline`. For the chat and concierge, put an `ANTHROPIC_API_KEY` in a repo-root `.env` (see `.env.example`).

**Tests.** Run `npm test` in `api/` and `web/`, and `pytest` in `pipeline/`. The API's integration tests run when `TEST_DATABASE_URL` points at a database loaded as above. For the Playwright smoke tests, create a test database with `docker exec scense-db-1 createdb -U scense scense_test`, load it the same way (with `scense_test` at the end of the URL), then run `npm ci && npx playwright install chromium && npm test` in `e2e/`.

## Known limitations

- **Fruity and Citrus sit three steps apart on the wheel**, so two fragrances that smell alike but lead with different accords score lower than people expect. Example: Club de Nuit Intense Man (led by Citrus), a well-known Aventus alternative, lands #7 in Creed Aventus's (led by Fruity) Enhance list, effectively tied with #5 and #6. The planned fix is learning from the pair ratings users already leave.
- **Logging out doesn't revoke the session token.** It clears the cookie, but a copy stolen earlier stays valid until its 7-day expiry. The fix at scale is a token version on each user.
- **Bottle photos are hotlinked from Fragrantica.** If they stop loading, the page draws a tinted placeholder bottle instead. They'd need replacing or licensing before this charged anyone.

## Credits

Fragrance data comes from the Fragrantica community via the [Decant dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes) on Kaggle. Scense isn't affiliated with Fragrantica.

Scense was built with AI assistance (Claude Code). I designed, reviewed, and tested every milestone. The reasoning behind each decision is in [DECISIONS.md](DECISIONS.md).
