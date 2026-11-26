# Security

Scense is a portfolio project: a fragrance catalogue with accounts, reviews, and two AI features, running on one EC2 instance. This page says what it protects, against whom, how, and how to report a problem. DECISIONS.md B43 records the November 2026 audit behind it.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for a security problem.

Include what you found, the steps to reproduce it, and what an attacker could do with it. You'll get an answer within a week. Scense is maintained by one person, so the fix may take longer than the answer; you'll hear how it is going.

Please test only against your own local copy (`docker compose up` runs the whole stack). Don't test against `scense.name`: no load testing, scanning, brute forcing, or attempts to reach other people's data. It is a small server with real users.

## What is worth protecting

| Asset | Where it lives | Why it matters |
|---|---|---|
| Account emails and password hashes | `users` table | Personal data; password reuse makes hashes valuable |
| Reviews, collections, pair ratings, taste profiles | Postgres | One user's data must never be readable or editable by another |
| Chat and concierge transcripts | `chat_messages`, kept 30 days | What visitors typed, guests included |
| Session signing key (`JWT_SECRET`) | GitHub secret, server `.env` | Whoever holds it can sign in as anyone |
| Anthropic API key and budget | GitHub secret, server `.env` | Abuse costs money |
| Nightly backups | S3, reached through the EC2 instance role | They contain all of the above |
| The deploy pipeline | GitHub Actions, the deploy SSH key | Whoever controls it controls the server |

## Who we defend against

- **Anonymous visitors and scripts** sending crafted requests: injection, forged sessions, oversized or malformed input, abuse of the AI budget.
- **Signed-in users** trying to reach another user's data.
- **Hostile text aimed at the model** (prompt injection), from a visitor's own messages.
- **Malicious web pages** trying to act with a visitor's cookie (CSRF), frame the site, or run script in it (XSS).
- **A compromised dependency or GitHub Action.**

Out of scope: an attacker who already has a shell on the server or the AWS account, denial of service by sheer traffic volume, and Fragrantica's image host misbehaving.

## How each threat is handled

**Sessions.** An HS256 JWT holding only the user id, in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, valid for 7 days. One function (`readSession`) verifies the signature, the algorithm, and the expiry. The API refuses to start with a `JWT_SECRET` under 32 characters. Logout deletes the cookie but doesn't revoke the token (a known limit, DECISIONS B31).

**Passwords.** bcrypt at cost 12. Signup is limited to 5 per hour per address, login to 5 attempts per 15 minutes per address and email. A login for an unknown email still runs a bcrypt compare, so timing reveals nothing.

**Access control.** Every account route takes the user id from the session and never from the request. Chats and outings are filtered by their owner on every read, write, and delete, and someone else's id gets the same 404 as a missing one. Guests are identified by a random UUID that unlocks only their own chats and outings.

**Injection.** Every SQL statement uses parameters. Sort orders come from a fixed list. Search text is reduced to letters and digits, after accents are folded, before it becomes a full-text query. A NUL character anywhere in a request, or an id larger than Postgres can store, is a 400 before any query runs.

**Cross-site attacks.** React renders all user and model text as text, and no code uses `dangerouslySetInnerHTML`. CORS allows only `https://scense.name`. State changes need a JSON body, which a cross-site form can't send, and `SameSite=Lax` keeps the cookie off cross-site POSTs. Caddy sends a strict Content-Security-Policy (scripts, styles, and fonts from this site only; images also from Fragrantica), HSTS, `nosniff`, `X-Frame-Options: DENY`, a Referrer-Policy, and a Permissions-Policy.

**The AI features.** The model has no tools, never sees the catalogue, and only fills in JSON. The server picks every fragrance. Everything the model writes passes a guard before anyone sees it: no fragrance or brand names, no links, no prices, and no talk about its own instructions. Anything that fails is replaced with text the server writes itself. A guest's free text never reaches a system prompt. Spending is capped per visitor (8 messages a day per feature), per day for all guests together, and at 5 new guest ids a day per network address.

**Server-side requests.** The API's only outbound call is to Anthropic, at an address from its own configuration. It never fetches a URL a visitor supplies. As a second layer, a firewall rule stops every container except the backup job from reaching the EC2 metadata service and its credentials.

**Infrastructure.** Only ports 22 (key-only SSH), 80, and 443 are open. Postgres listens on the Docker network only. The API container runs as an unprivileged user with production dependencies only, and no container mounts the Docker socket. Backups go to a bucket that blocks public access, written by an instance role that can't delete them (a lifecycle rule does, after 14 days).

**Supply chain and secrets.** Every GitHub Action is pinned to a commit SHA and kept current by Dependabot. Workflow tokens are read-only unless a job needs more. Secrets exist only as GitHub secrets and in the server's mode-600 `.env`. CI never calls the real Anthropic API.

**Logs.** Nothing logs passwords, tokens, emails, review text, or messages. A server error logs its route, its Postgres error code, and its stack frames, never the values involved.
