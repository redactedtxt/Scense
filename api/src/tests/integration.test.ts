import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { orderByClause, SORTS } from "../services/catalogue.js";
import { matrices, settings } from "./helpers.js";

// Runs the real SQL against a Postgres that `python pipeline/src/run.py pipeline` has
// loaded. Skipped when TEST_DATABASE_URL is not set, so CI (which has no database)
// still passes. Locally:
//   TEST_DATABASE_URL=postgres://scense:scense_dev@localhost:5432/scense npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("against the loaded catalogue", () => {
  const pool = new pg.Pool({ connectionString: url });
  const app = createApp(pool, matrices, settings);
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

  type Item = { id: number; name: string; brand: string; gender: string; ratingVotes: number };
  const search = async (params: Record<string, string>) => (await request(app).get("/api/fragrances").query(params)).body;

  describe("search aliases (DECISIONS B23)", () => {
    it("finds a brand by its abbreviation: ysl, jpg, mfk", async () => {
      const cases = [["ysl", "Yves Saint Laurent"], ["JPG", "Jean Paul Gaultier"], ["mfk", "Maison Francis Kurkdjian"]];
      for (const [alias, brand] of cases) {
        const body = await search({ q: alias! });
        expect(body.fuzzy).toBe(false);
        expect(body.total).toBeGreaterThan(0);
        for (const item of body.items as Item[]) expect(item.brand).toBe(brand);
      }
    });

    it("finds D&G, whose abbreviation has punctuation, without Acqua di Giò", async () => {
      const body = await search({ q: "d&g" });
      expect(body.total).toBeGreaterThan(0);
      for (const item of body.items as Item[]) expect(item.brand).toBe("Dolce&Gabbana");
    });

    it("finds MYSLF by the spelling people use, alone and with a brand alias", async () => {
      const alone = await search({ q: "myself" });
      expect((alone.items as Item[]).map((i) => i.name)).toEqual(["MYSLF Eau de Parfum"]);
      const both = await search({ q: "ysl myself" });
      expect(both.fuzzy).toBe(false);
      expect((both.items as Item[]).map((i) => i.name)).toEqual(["MYSLF Eau de Parfum"]);
    });

    it("still finds bottles by their real names and keeps prefix matching", async () => {
      expect((await search({ q: "myslf" })).total).toBe(1);
      expect((await search({ q: "yves saint" })).total).toBe((await search({ q: "ysl" })).total);
    });

    it("finds the community shorthand: bdc, adg, cdnim, tv, lmw, and the Margiela brand name", async () => {
      const names = async (q: string) => ((await search({ q })).items as Item[]).map((i) => i.name);
      expect(await names("bdc")).toEqual(expect.arrayContaining(["Bleu de Chanel", "Bleu de Chanel Parfum"]));
      expect(await names("adg")).toEqual(expect.arrayContaining(["Acqua di Gio", "Acqua di Giò Profumo"]));
      expect(await names("cdnim")).toEqual(["Club de Nuit Intense Man"]);
      expect(await names("tv")).toEqual(["Tobacco Vanille"]);
      const lmw = await names("lmw");
      expect(lmw).toEqual(expect.arrayContaining(["Le Male", "Le Male Elixir"]));
      expect(lmw).not.toContain("Ultra Male");
      for (const item of (await search({ q: "margiela" })).items as Item[]) expect(item.brand).toBe("Maison Martin Margiela");
    });

    it("stores both alias files in the database", async () => {
      const brands = await pool.query("SELECT alias FROM brand_aliases WHERE alias IN ('YSL', 'JPG', 'D&G')");
      expect(brands.rowCount).toBe(3);
      const names = await pool.query("SELECT name_word FROM name_aliases WHERE alias = 'myself'");
      expect(names.rows[0].name_word).toBe("MYSLF");
    });
  });

  describe("accent folding (unaccent)", () => {
    it("finds accented names and brands from accent-free spellings, as exact matches", async () => {
      const cases: [string, (i: Item) => boolean][] = [
        ["tresor", (i) => i.name.startsWith("Trésor")],
        ["chloe", (i) => i.brand === "Chloé"],
        ["hermes", (i) => i.brand === "Hermès"],
        ["lancome", (i) => i.brand === "Lancôme"],
        ["estee lauder", (i) => i.brand === "Estée Lauder"],
        ["gio", (i) => i.name.startsWith("Acqua di Gi")],
      ];
      for (const [q, expected] of cases) {
        const body = await search({ q });
        expect(body.fuzzy, q).toBe(false);
        expect((body.items as Item[]).some(expected), q).toBe(true);
      }
    });

    it("still finds an accented spelling typed with the accent", async () => {
      expect((await search({ q: "trésor" })).total).toBe((await search({ q: "tresor" })).total);
    });
  });

  describe("typo fallback (pg_trgm)", () => {
    it("finds near-misses when full-text search finds nothing", async () => {
      const sauvage = await search({ q: "sauvge" });
      expect(sauvage.fuzzy).toBe(true);
      expect((sauvage.items as Item[]).some((i) => i.brand === "Dior" && i.name.startsWith("Sauvage"))).toBe(true);

      const baccarat = await search({ q: "bacarat rouge" });
      expect(baccarat.fuzzy).toBe(true);
      expect((baccarat.items as Item[])[0]!.name).toMatch(/^Baccarat Rouge 540/);
    });


    it("returns nothing for text that is nothing like a bottle", async () => {
      expect(await search({ q: "xqzvwk" })).toMatchObject({ fuzzy: true, total: 0, items: [] });
    });

    it("stays off when the text matches a bottle that the filters excluded", async () => {
      expect(await search({ q: "sauvage", gender: "female" })).toMatchObject({ fuzzy: false, total: 0 });
    });

    it("applies the gender filter to near-misses", async () => {
      const body = await search({ q: "sauvge", gender: "female" });
      for (const item of body.items as Item[]) expect(item.gender).toBe("female");
    });
  });

  describe("browse sort (DECISIONS B24)", () => {
    const allRows = async () =>
      (await pool.query("SELECT id, rating_votes AS v, community_rating AS r FROM fragrances")).rows as {
        id: number;
        v: number;
        r: number;
      }[];
    const ids = (body: { items: Item[] }) => body.items.map((i) => i.id);

    it("Most popular is the default: rating votes, high to low", async () => {
      const body = await search({});
      expect(ids(body)).toEqual(ids(await search({ sort: "popular" })));
      const votes = (body.items as Item[]).map((i) => i.ratingVotes);
      expect(votes).toEqual([...votes].sort((a, b) => b - a));
      expect(votes[0]).toBe(Math.max(...(await allRows()).map((r) => r.v)));
    });

    it("Least popular: rating votes, low to high", async () => {
      const body = await search({ sort: "least-popular" });
      const votes = (body.items as Item[]).map((i) => i.ratingVotes);
      expect(votes).toEqual([...votes].sort((a, b) => a - b));
      expect(votes[0]).toBe(Math.min(...(await allRows()).map((r) => r.v)));
    });

    it("Highest rated ranks by the weighted rating, checked against an independent calculation", async () => {
      const all = await allRows();
      const mean = all.reduce((sum, r) => sum + r.r, 0) / all.length;
      const m = settings.ratingWeightVotes;
      const weighted = (r: { v: number; r: number }) => (r.v * r.r + m * mean) / (r.v + m);
      const expected = [...all]
        .sort((a, b) => weighted(b) - weighted(a) || b.v - a.v || a.id - b.id)
        .slice(0, 24)
        .map((r) => r.id);
      expect(ids(await search({ sort: "highest-rated" }))).toEqual(expected);
    });

    it("Highest rated does not put a few-votes perfect score first", async () => {
      // A temp table named "fragrances" shadows the real one for this connection only,
      // so the real ORDER BY runs on rows we control.
      const client = await pool.connect();
      try {
        await client.query("CREATE TEMP TABLE fragrances (id int, rating_votes int, community_rating real)");
        await client.query(`INSERT INTO fragrances VALUES
          (1, 5, 5.0), (2, 20000, 4.6), (3, 30000, 4.4), (4, 20000, 3.4), (5, 20000, NULL)`);
        const order = async (sort: (typeof SORTS)[number]) =>
          (await client.query(`SELECT id FROM fragrances f ORDER BY ${orderByClause(sort, settings)}`)).rows.map((r) => r.id);
        // Raw rating would put bottle 1 first; with 5 votes it is pulled toward the mean.
        expect(await order("highest-rated")).toEqual([2, 3, 1, 4, 5]);
        expect(await order("popular")).toEqual([3, 2, 4, 5, 1]);
        expect(await order("least-popular")).toEqual([1, 2, 4, 5, 3]);
      } finally {
        await client.query("DROP TABLE IF EXISTS pg_temp.fragrances");
        client.release();
      }
    });

    it("keeps the sort across pages and with a search", async () => {
      const first = ids(await search({ sort: "least-popular" }));
      const second = ids(await search({ sort: "least-popular", page: "2" }));
      expect(new Set([...first, ...second]).size).toBe(48);
      const dior = (await search({ q: "dior", sort: "least-popular" })).items as Item[];
      const votes = dior.map((i) => i.ratingVotes);
      expect(votes).toEqual([...votes].sort((a, b) => a - b));
    });
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
