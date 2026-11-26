import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { toPrefixQuery } from "../services/search.js";
import { auth, matrices, settings } from "./helpers.js";

// Security audit regressions that need real Postgres (DECISIONS B43). Skipped without
// TEST_DATABASE_URL, like the other integration tests; CI sets it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("security regressions against Postgres", () => {
  const pool = new pg.Pool({ connectionString: url });
  const app = createApp(pool, matrices, settings, auth);
  afterAll(() => pool.end());

  it.each(["ŉ", "ŉ test", "⑴ cool", "½", "Æsir", "ß", "℡", "Ⅻ", "a'b", "' OR 1=1 --", "\\", "a:* & !b"])(
    "browses %j without a server error",
    async (q) => {
      const res = await request(app).get("/api/fragrances").query({ q });
      expect(res.status).toBe(200);
    },
  );

  // Every letter and digit in the Basic Multilingual Plane, folded by Postgres's own
  // unaccent rules and then turned into a tsquery the way the API does it. Before B43 the
  // folding happened after the query was built, and "ŉ" broke the tsquery syntax.
  it("builds a valid tsquery from every letter and digit unaccent can fold", async () => {
    const chars: string[] = [];
    for (let code = 0x20; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      if (/[\p{L}\p{N}]/u.test(char)) chars.push(char);
    }
    // Chunks of 20 characters, one "word" of each, so every character is tried as the
    // start of a word, inside a phrase, and next to the others.
    const texts: string[] = [];
    for (let i = 0; i < chars.length; i += 20) texts.push(chars.slice(i, i + 20).join(" "));
    const folded = (await pool.query("SELECT unaccent(t) AS f FROM unnest($1::text[]) WITH ORDINALITY AS u(t, n) ORDER BY n", [texts]))
      .rows.map((r) => r.f as string);
    const queries = folded.map(toPrefixQuery).filter((q): q is string => q !== null);
    // to_tsquery raises on any syntax error, failing the whole statement.
    const { rows } = await pool.query("SELECT count(to_tsquery('simple', q))::int AS n FROM unnest($1::text[]) AS q", [queries]);
    expect(rows[0].n).toBe(queries.length);
  }, 30_000);

  it("refuses a second account for the same email, in any case, at once", async () => {
    const email = `b43-${Date.now()}@example.test`;
    const body = (address: string) => ({ email: address, displayName: "B43", password: "correct horse battery" });
    // Six signups at once, from six addresses so the signup rate limit doesn't interfere.
    const results = await Promise.all(
      [email, email.toUpperCase(), email, email, email, email].map((address, i) =>
        request(app).post("/api/auth/signup").set("X-Forwarded-For", `192.0.2.${i + 1}`).send(body(address)),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [email]);
    expect(rows[0].n).toBe(1);
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });
});
