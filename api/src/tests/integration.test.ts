import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { matrices } from "./helpers.js";

// Runs the real SQL against a Postgres that `python pipeline/src/run.py pipeline` has
// loaded. Skipped when TEST_DATABASE_URL is not set, so CI (which has no database)
// still passes. Locally:
//   TEST_DATABASE_URL=postgres://scense:scense_dev@localhost:5432/scense npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("against the loaded catalogue", () => {
  const pool = new pg.Pool({ connectionString: url });
  const app = createApp(pool, matrices);
  afterAll(() => pool.end());

  const slugOf = async (name: string) => {
    const res = await request(app).get("/api/fragrances").query({ q: name });
    return res.body.items[0].slug as string;
  };

  it("searches by name and brand with prefix matching, most voted first", async () => {
    const res = await request(app).get("/api/fragrances?q=cool wat");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) expect(`${item.brand} ${item.name}`.toLowerCase()).toContain("cool");
    const votes = res.body.items.map((i: { ratingVotes: number }) => i.ratingVotes);
    expect(votes).toEqual([...votes].sort((a, b) => b - a));
  });

  it("pages the whole catalogue 24 at a time and filters by gender and family", async () => {
    const all = await request(app).get("/api/fragrances");
    expect(all.body).toMatchObject({ total: 300, pageSize: 24, totalPages: 13 });
    expect(all.body.items).toHaveLength(24);
    const last = await request(app).get("/api/fragrances?page=13");
    expect(last.body.items).toHaveLength(300 - 12 * 24);

    const women = await request(app).get("/api/fragrances?gender=female");
    for (const item of women.body.items) expect(item.gender).toBe("female");
    const woods = await request(app).get("/api/fragrances?family=woods");
    for (const item of woods.body.items) expect(item.dominantFamily).toBe("Woods");
  });

  it("returns a fragrance with 14 profile shares that sum to 1, notes, and accords", async () => {
    const res = await request(app).get(`/api/fragrances/${await slugOf("Cool Water")}`);
    expect(res.status).toBe(200);
    const shares = res.body.familyProfile.map((f: { share: number }) => f.share);
    expect(shares).toHaveLength(14);
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 4);
    expect(res.body.accords.length).toBeGreaterThan(0);
    expect(Object.values(res.body.notes).flat().length).toBeGreaterThan(0);
  });

  it("autocompletes mapped notes only", async () => {
    const res = await request(app).get("/api/notes?q=vanil");
    expect(res.body.items.map((i: { name: string }) => i.name)).toContain("Vanilla");
    const unmapped = await pool.query("SELECT name FROM notes WHERE NOT mapped LIMIT 1");
    const found = await request(app).get("/api/notes").query({ q: unmapped.rows[0].name, limit: 50 });
    expect(found.body.items.map((i: { name: string }) => i.name)).not.toContain(unmapped.rows[0].name);
  });

  it("ranks notes for both goals and rejects an unmapped note", async () => {
    for (const goal of ["enhance", "soften"]) {
      const res = await request(app).post("/api/pairing/notes").send({ notes: ["Vanilla", "Rose"], goal });
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0]).toMatchObject({ rank: 1, score: 100 });
      const names = res.body.results.map((r: { note: string }) => r.note);
      expect(names).not.toContain("Vanilla");
      expect(names).not.toContain("Rose");
    }
    const unmapped = await pool.query("SELECT name FROM notes WHERE NOT mapped LIMIT 1");
    const bad = await request(app).post("/api/pairing/notes").send({ notes: [unmapped.rows[0].name], goal: "enhance" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("unmapped_note");
  });

  it("lists Enhance partners: 299 of them, best first, owned flagged", async () => {
    const base = await slugOf("Aventus");
    const first = await request(app).get(`/api/pairing/fragrances/${base}?goal=enhance`);
    expect(first.body).toMatchObject({ total: 299, page: 1, totalPages: 13 });
    const ranks = first.body.items.map((i: { rank: number }) => i.rank);
    expect(ranks).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));

    const topId = (await pool.query("SELECT id FROM fragrances WHERE slug = $1", [first.body.items[0].slug])).rows[0].id;
    const owned = await request(app).get(`/api/pairing/fragrances/${base}?goal=enhance&owned=${topId}`);
    expect(owned.body.items[0].owned).toBe(true);
    expect(owned.body.items[1].owned).toBe(false);
    expect(first.body.items[0].id).toBe(topId);
  });

  it("filters to owned partners across the whole list, not just page 1", async () => {
    const base = await slugOf("Aventus");
    // Rank 1 and the last-ranked partner: the last one is never on the first page.
    const firstPage = await request(app).get(`/api/pairing/fragrances/${base}?goal=enhance`);
    const lastPage = await request(app).get(`/api/pairing/fragrances/${base}?goal=enhance&page=13`);
    const top = firstPage.body.items[0];
    const bottom = lastPage.body.items.at(-1);
    const res = await request(app).get(
      `/api/pairing/fragrances/${base}?goal=enhance&owned=${bottom.id},${top.id}&ownedOnly=true`,
    );
    expect(res.body).toMatchObject({ total: 299, matching: 2, totalPages: 1 });
    expect(res.body.items.map((i: { rank: number }) => i.rank)).toEqual([1, 299]);
    expect(res.body.items.every((i: { owned: boolean }) => i.owned)).toBe(true);
  });

  it("returns ids in the fragrance list and detail", async () => {
    const list = await request(app).get("/api/fragrances?q=cool wat");
    const detail = await request(app).get(`/api/fragrances/${list.body.items[0].slug}`);
    expect(Number.isInteger(list.body.items[0].id)).toBe(true);
    expect(detail.body.id).toBe(list.body.items[0].id);
  });

  it("rank endpoint agrees with the list, and answers too_harsh for dropped Soften partners", async () => {
    const base = await slugOf("Club de Nuit Intense Man");
    const list = await request(app).get(`/api/pairing/fragrances/${base}?goal=soften`);
    const { total } = list.body;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(299);

    const partner = list.body.items[2];
    const ranked = await request(app).get(`/api/pairing/fragrances/${base}/rank/${partner.slug}?goal=soften`);
    expect(ranked.body).toEqual({ status: "ranked", rank: 3, total, score: partner.score });

    // A fragrance Soften dropped: it is in the catalogue but has no pair_scores row for this base.
    const dropped = await pool.query(
      `SELECT f.slug FROM fragrances f, fragrances b
        WHERE b.slug = $1 AND f.id <> b.id
          AND NOT EXISTS (SELECT 1 FROM pair_scores ps
                           WHERE ps.base_id = b.id AND ps.partner_id = f.id AND ps.goal = 'soften')
        LIMIT 1`,
      [base],
    );
    const harsh = await request(app).get(`/api/pairing/fragrances/${base}/rank/${dropped.rows[0].slug}?goal=soften`);
    expect(harsh.status).toBe(200);
    expect(harsh.body).toEqual({ status: "too_harsh", total });
  });

  it("Enhance rank covers every other fragrance", async () => {
    const base = await slugOf("Aventus");
    const other = await slugOf("Cool Water");
    const res = await request(app).get(`/api/pairing/fragrances/${base}/rank/${other}?goal=enhance`);
    expect(res.body).toMatchObject({ status: "ranked", total: 299 });
    expect(res.body.rank).toBeGreaterThanOrEqual(1);
    expect(res.body.rank).toBeLessThanOrEqual(299);
  });

  it("returns the 14 families", async () => {
    const res = await request(app).get("/api/families");
    expect(res.body.items.map((f: { name: string }) => f.name)[0]).toBe("Soft Amber");
    expect(res.body.items).toHaveLength(14);
  });
});
