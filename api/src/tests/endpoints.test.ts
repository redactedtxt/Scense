import request from "supertest";
import { describe, expect, it } from "vitest";
import { searchWords, toPrefixQuery } from "../services/search.js";
import { orderByClause, SORTS } from "../services/catalogue.js";
import { appWith, profileAt, settings } from "./helpers.js";

// These tests use a fake database, so they check HTTP behaviour: validation, status
// codes, JSON shapes. The SQL itself is checked in integration.test.ts.

const FAMILY_NAMES = ["Soft Amber", "Amber", "Woody Amber", "Woods", "Mossy Woods", "Dry Woods", "Aromatic Fougère",
  "Citrus", "Water", "Green", "Fruity", "Floral", "Soft Floral", "Floral Amber"];
const familyRows = FAMILY_NAMES.map((name, id) => ({ id, name, harshness: 0.3 }));

describe("GET /api/families", () => {
  it("returns the 14 families in ring order", async () => {
    const { app } = appWith([[/FROM families/, familyRows]]);
    const res = await request(app).get("/api/families");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(14);
    expect(res.body.items[13]).toEqual({ id: 13, name: "Floral Amber", harshness: 0.3 });
  });
});

describe("GET /api/notes", () => {
  const row = { name: "Vanilla", family: "Soft Amber" };

  it("returns mapped notes with their dominant family", async () => {
    const { app, calls } = appWith([[/FROM notes n/, [row]]]);
    const res = await request(app).get("/api/notes?q=van");
    expect(res.body.items).toEqual([{ name: "Vanilla", dominantFamily: "Soft Amber" }]);
    expect(calls[0]!.sql).toContain("n.mapped"); // unmapped notes must never autocomplete
    expect(calls[0]!.params).toEqual(["van", 20]);
  });

  it("escapes LIKE wildcards in the search text", async () => {
    const { app, calls } = appWith([[/FROM notes n/, []]]);
    await request(app).get("/api/notes").query({ q: "50%_off" });
    expect(calls[0]!.params[0]).toBe("50\\%\\_off");
  });

  it("rejects a limit above 50", async () => {
    const { app } = appWith([]);
    const res = await request(app).get("/api/notes?limit=500");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });
});

describe("GET /api/fragrances", () => {
  const listRoutes = (total: number) =>
    [
      [/count\(\*\)/, [{ total }]],
      // A brand page asks which brand a spelling means first (DECISIONS B42).
      [/FROM brand_aliases a/, (params: unknown[]) => (["YSL", "Yves Saint Laurent"].includes(params[0] as string) ? [{ brand: "Yves Saint Laurent" }] : [])],
      [/FROM fragrances f/, [{ id: 7, slug: "a-b-2000", name: "B", brand: "A", gender: "male", release_year: 2000,
        image_url: null, community_rating: 4.1, rating_votes: 900, strength: 3, family: "Woods",
        price_tier: 3, value_score: 3.2468, value_votes: 1873 }]],
      [/FROM families WHERE lower/, [{ id: 3 }]],
    ] as Parameters<typeof appWith>[0];

  it("gives each bottle its approximate tier and value votes", async () => {
    const { app } = appWith(listRoutes(1));
    const res = await request(app).get("/api/fragrances");
    expect(res.body.items[0]).toMatchObject({
      price: { tier: 3, minCad: 150, maxCad: 300 },
      value: { score: 3.25, votes: 1873 },
    });
    expect(res.body.brand).toBeNull();
  });

  it("filters to one brand, reached by its name or an alias, and names it for the heading", async () => {
    const { app, calls } = appWith(listRoutes(1));
    const res = await request(app).get("/api/fragrances").query({ brand: "YSL" });
    expect(res.status).toBe(200);
    expect(res.body.brand).toBe("Yves Saint Laurent");
    expect(calls.at(-1)!.params).toEqual([null, null, null, "Yves Saint Laurent", 0]);
    const unknown = await request(app).get("/api/fragrances").query({ brand: "Nobody" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("unknown_brand");
  });

  it("returns a page of summaries with paging info", async () => {
    const { app, calls } = appWith(listRoutes(50));
    const res = await request(app).get("/api/fragrances?page=2");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 2, pageSize: 24, total: 50, totalPages: 3 });
    expect(res.body.items[0]).toMatchObject({ id: 7, slug: "a-b-2000", dominantFamily: "Woods", releaseYear: 2000 });
    expect(calls.at(-1)!.params).toEqual([null, null, null, null, 24]); // page 2 skips 24
  });

  it("turns the search text into a prefix query and passes filters through", async () => {
    const { app, calls } = appWith(listRoutes(1));
    await request(app).get("/api/fragrances").query({ q: "cool wat", gender: "male", family: "woods" });
    expect(calls.at(-1)!.params).toEqual(["cool:* & wat:*", "male", 3, null, 0]);
  });

  it("rejects a bad gender, a bad page, and an unknown family", async () => {
    const { app } = appWith([[/FROM families WHERE lower/, []]]);
    expect((await request(app).get("/api/fragrances?gender=other")).status).toBe(400);
    expect((await request(app).get("/api/fragrances?page=0")).status).toBe(400);
    const res = await request(app).get("/api/fragrances?family=Nonsense");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("unknown family");
  });
});

describe("toPrefixQuery", () => {
  it("keeps letters and digits, drops tsquery syntax, and returns null for no words", () => {
    expect(toPrefixQuery("Cool Water")).toBe("Cool:* & Water:*");
    expect(toPrefixQuery("a'; DROP | & ! (x)")).toBe("a:* & DROP:* & x:*");
    expect(toPrefixQuery("Hermès")).toBe("Hermès:*");
    expect(toPrefixQuery("  !! ")).toBeNull();
  });

  it("searches an alias with punctuation as a phrase, with one-letter words exact", () => {
    expect(toPrefixQuery("d&g")).toBe("(d <-> g)");
    expect(toPrefixQuery("ysl myself")).toBe("ysl:* & myself:*");
    expect(toPrefixQuery("jpg le male")).toBe("jpg:* & le:* & male:*");
    expect(toPrefixQuery("marc-anto")).toBe("(marc:* <-> anto:*)");
  });
});

describe("searchWords", () => {
  it("lists the words the typo fallback compares, without one-letter words", () => {
    expect(searchWords("Sauvge Elixr")).toEqual(["Sauvge", "Elixr"]);
    expect(searchWords("angel's share")).toEqual(["angel", "share"]);
    expect(searchWords("a b")).toEqual([]);
    expect(searchWords("one two three four five six seven")).toHaveLength(6);
  });
});

describe("GET /api/fragrances sorting and the typo fallback", () => {
  const row = { id: 9, slug: "dior-sauvage-2015", name: "Sauvage", brand: "Dior", gender: "male", release_year: 2015,
    image_url: null, community_rating: 4.2, rating_votes: 30000, strength: 3, family: "Aromatic Fougère" };
  // The first matching pattern answers, so the fuzzy queries (which also say "count" and
  // "FROM fragrances f") come first.
  const routes = (exact: number, textMatches: boolean) =>
    [
      [/WITH scored[\s\S]*count\(\*\)/, [{ total: 1 }]],
      [/WITH scored/, [row]],
      [/EXISTS/, [{ found: textMatches }]],
      [/count\(\*\)/, [{ total: exact }]],
      [/FROM fragrances f/, exact ? [row] : []],
    ] as Parameters<typeof appWith>[0];
  const fuzzyCalls = (calls: { sql: string; params: unknown[] }[]) => calls.filter((c) => c.sql.includes("WITH scored"));

  it("orders by the chosen sort, popular by default", async () => {
    const orderOf = async (sort?: string) => {
      const { app, calls } = appWith(routes(1, true));
      await request(app).get("/api/fragrances").query(sort ? { sort } : {});
      return calls.at(-1)!.sql;
    };
    expect(await orderOf()).toContain(`ORDER BY ${orderByClause("popular", settings)}`);
    expect(await orderOf("least-popular")).toContain("f.rating_votes ASC NULLS LAST, f.id");
    const rated = await orderOf("highest-rated");
    expect(rated).toContain(`ORDER BY ${orderByClause("highest-rated", settings)}`);
    expect(rated).toContain(`${settings.ratingWeightVotes} *`); // the constant comes from scoring.yaml
  });

  it("gives every sort its own order and ends each with the id", () => {
    const clauses = SORTS.map((sort) => orderByClause(sort, settings));
    expect(new Set(clauses).size).toBe(SORTS.length);
    for (const clause of clauses) expect(clause).toMatch(/f\.id$/);
  });

  it("rejects an unknown sort", async () => {
    const { app } = appWith(routes(1, true));
    const res = await request(app).get("/api/fragrances?sort=cheapest");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("falls back to near-miss matching when nothing matches the text", async () => {
    const { app, calls } = appWith(routes(0, false));
    const res = await request(app).get("/api/fragrances").query({ q: "sauvge", gender: "male" });
    expect(res.body).toMatchObject({ fuzzy: true, total: 1 });
    expect(res.body.items[0]).toMatchObject({ name: "Sauvage" });
    // words, minimum similarity from scoring.yaml, then gender, family, offset
    expect(fuzzyCalls(calls).at(-1)!.params).toEqual([["sauvge"], settings.fuzzyMinSimilarity, "male", null, null, 0]);
  });

  it("does not fall back when the text matches and only the filters excluded it", async () => {
    const { app, calls } = appWith(routes(0, true));
    const res = await request(app).get("/api/fragrances").query({ q: "sauvage", gender: "female" });
    expect(res.body).toMatchObject({ fuzzy: false, total: 0, items: [] });
    expect(fuzzyCalls(calls)).toHaveLength(0);
  });

  it("does not fall back for an empty search or when the text matched", async () => {
    for (const query of [{}, { q: "sauvage" }]) {
      const { app, calls } = appWith(routes(1, true));
      const res = await request(app).get("/api/fragrances").query(query);
      expect(res.body.fuzzy).toBe(false);
      expect(fuzzyCalls(calls)).toHaveLength(0);
    }
  });
});

describe("GET /api/fragrances/:slug", () => {
  const fragrance = {
    id: 7, slug: "a-b-2000", name: "B", brand: "A", gender: "male", release_year: 2000, image_url: null,
    community_rating: 4.1, rating_votes: 900, strength: 3, family: "Woods", harshness: 0.4,
    profile: profileAt(3), facets: { sweet: 0.1 }, seasons: { winter: 1 }, daynight: { day: 0.5, night: 0.5 },
  };

  it("returns the full detail with notes grouped by layer", async () => {
    const { app } = appWith([
      [/FROM fragrances f/, [fragrance]],
      [/FROM families ORDER BY id/, familyRows],
      [/FROM fragrance_notes/, [
        { layer: "top", name: "Lemon", mapped: true },
        { layer: "base", name: "Odd Resin", mapped: false },
      ]],
      [/FROM fragrance_accords/, [{ accord: "woody", strength: 100 }]],
    ]);
    const res = await request(app).get("/api/fragrances/a-b-2000");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 7, slug: "a-b-2000" }); // the Own/Want buttons store this id
    expect(res.body.notes.top).toEqual([{ name: "Lemon", mapped: true }]);
    expect(res.body.notes.base).toEqual([{ name: "Odd Resin", mapped: false }]); // unmapped still shown
    expect(res.body.notes.heart).toEqual([]);
    expect(res.body.familyProfile).toHaveLength(14);
    expect(res.body.familyProfile[3]).toEqual({ id: 3, name: "Woods", share: 1 });
    expect(res.body.accords).toEqual([{ accord: "woody", strength: 100 }]);
    expect(res.body).not.toHaveProperty("concentration"); // the dataset has none
  });

  it("returns 404 for an unknown slug", async () => {
    const { app } = appWith([[/FROM fragrances f/, []]]);
    const res = await request(app).get("/api/fragrances/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});

describe("POST /api/pairing/notes", () => {
  const mapped = [
    { name: "Cedar", profile: profileAt(3), harshness: 0.5 },
    { name: "Sandalwood", profile: profileAt(4), harshness: 0.3 },
    { name: "Rose", profile: profileAt(11), harshness: 0.2 },
  ];
  const routes = (existing: unknown[] = []) =>
    [
      [/WHERE mapped/, mapped],
      [/SELECT name FROM families/, familyRows],
      [/SELECT 1 FROM notes/, existing],
    ] as Parameters<typeof appWith>[0];

  it("ranks mapped notes, ignoring input case, and excludes the inputs", async () => {
    const { app } = appWith(routes());
    const res = await request(app).post("/api/pairing/notes").send({ notes: ["cedar"], goal: "enhance" });
    expect(res.status).toBe(200);
    expect(res.body.inputs).toEqual(["Cedar"]);
    expect(res.body.results[0]).toEqual({ note: "Sandalwood", rank: 1, score: 100, dominantFamily: "Mossy Woods" });
    expect(res.body.results.map((r: { note: string }) => r.note)).not.toContain("Cedar");
    expect(res.body.total).toBe(2);
  });

  it("rejects an unmapped note with its own error code", async () => {
    const { app } = appWith(routes([{ "?column?": 1 }]));
    const res = await request(app).post("/api/pairing/notes").send({ notes: ["Cedar", "Odd Resin"], goal: "soften" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("unmapped_note");
  });

  it("rejects a note that does not exist at all", async () => {
    const { app } = appWith(routes([]));
    const res = await request(app).post("/api/pairing/notes").send({ notes: ["Zzzz"], goal: "soften" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("unknown_note");
  });

  it.each([
    ["missing goal", { notes: ["Cedar"] }],
    ["bad goal", { notes: ["Cedar"], goal: "boost" }],
    ["empty notes", { notes: [], goal: "enhance" }],
    ["too many notes", { notes: Array.from({ length: 11 }, (_, i) => `n${i}`), goal: "enhance" }],
    ["notes not an array", { notes: "Cedar", goal: "enhance" }],
    ["blank note", { notes: ["  "], goal: "enhance" }],
  ])("returns 400 for %s", async (_label, body) => {
    const { app, calls } = appWith(routes());
    const res = await request(app).post("/api/pairing/notes").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
    expect(calls).toHaveLength(0); // validation runs before any database work
  });
});

describe("GET /api/pairing/fragrances/:slug", () => {
  const base = { id: 1, slug: "base", name: "Base", brand: "B", family: "Woods" };
  const partner = { rank: 1, score: 100, id: 2, slug: "p", name: "P", brand: "Q", image_url: null, family: "Amber" };
  // The whole list has 30 partners; 1 of them is in any owned list (see ownedListSize).
  const counts = (sqlParams: unknown[]) => [{ total: sqlParams.length === 3 ? 1 : 30 }];
  const routes = [
    [/WHERE f.slug/, [base]],
    [/count\(\*\)/, counts],
    [/FROM pair_scores ps/, [partner]],
  ] as Parameters<typeof appWith>[0];

  it("returns ranked partners with their ids and flags owned ones", async () => {
    const { app } = appWith(routes);
    const res = await request(app).get("/api/pairing/fragrances/base?goal=soften&owned=2,9");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ goal: "soften", page: 1, total: 30, matching: 30, totalPages: 2 });
    expect(res.body.base).toEqual({ id: 1, slug: "base", name: "Base", brand: "B", dominantFamily: "Woods" });
    expect(res.body.items[0]).toMatchObject({ id: 2, rank: 1, score: 100, slug: "p", owned: true });
  });

  it("marks partners not in the owned list as not owned", async () => {
    const { app } = appWith(routes);
    const res = await request(app).get("/api/pairing/fragrances/base?goal=enhance&owned=99");
    expect(res.body.items[0].owned).toBe(false);
  });

  it("does not filter unless ownedOnly is true", async () => {
    const { app, calls } = appWith(routes);
    await request(app).get("/api/pairing/fragrances/base?goal=enhance&owned=2&ownedOnly=false");
    expect(calls.at(-1)!.params[3]).toBeNull();
  });

  it("filters to owned partners in SQL with ownedOnly, keeping the whole-list total", async () => {
    const { app, calls } = appWith(routes);
    const res = await request(app).get("/api/pairing/fragrances/base?goal=enhance&owned=2,9&ownedOnly=true");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 30, matching: 1, totalPages: 1 });
    const list = calls.at(-1)!;
    expect(list.sql).toContain("ANY($4)");
    expect(list.params[3]).toEqual([2, 9]); // only these partners can come back
  });

  it("accepts an owned list as long as the 1,000-fragrance catalogue (it was capped at 300)", async () => {
    const { app } = appWith(routes);
    const everyId = Array.from({ length: 1000 }, (_, i) => i + 1).join(",");
    const res = await request(app).get(`/api/pairing/fragrances/base?goal=enhance&owned=${everyId}&ownedOnly=true`);
    expect(res.status).toBe(200);
  });

  it.each([
    ["missing goal", "/api/pairing/fragrances/base"],
    ["bad goal", "/api/pairing/fragrances/base?goal=x"],
    ["bad owned list", "/api/pairing/fragrances/base?goal=enhance&owned=1,abc"],
    ["negative owned id", "/api/pairing/fragrances/base?goal=enhance&owned=-4"],
    ["page zero", "/api/pairing/fragrances/base?goal=enhance&page=0"],
    ["ownedOnly not true or false", "/api/pairing/fragrances/base?goal=enhance&ownedOnly=yes"],
  ])("returns 400 for %s", async (_label, url) => {
    const { app } = appWith(routes);
    expect((await request(app).get(url)).status).toBe(400);
  });

  it("returns 404 for an unknown base slug", async () => {
    const { app } = appWith([[/WHERE f.slug/, []]]);
    const res = await request(app).get("/api/pairing/fragrances/nope?goal=enhance");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/pairing/fragrances/:slug/rank/:partnerSlug", () => {
  const fragranceFor = (params: unknown[]) =>
    [{ id: params[0] === "base" ? 1 : 2, slug: params[0], name: "N", brand: "B", family: "Woods" }];
  const listSize = (n: number): [RegExp, unknown[]] => [/count\(\*\)/, [{ total: n }]];

  it("returns status ranked with the real list size", async () => {
    const { app } = appWith([
      [/WHERE f.slug/, fragranceFor],
      listSize(214),
      [/SELECT rank, score/, [{ rank: 12, score: 71.234 }]],
    ]);
    const res = await request(app).get("/api/pairing/fragrances/base/rank/partner?goal=soften");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ranked", rank: 12, total: 214, score: 71.2 });
  });

  it("returns status too_harsh, not a 404, when Soften dropped the partner", async () => {
    const { app } = appWith([[/WHERE f.slug/, fragranceFor], listSize(214), [/SELECT rank, score/, []]]);
    const res = await request(app).get("/api/pairing/fragrances/base/rank/partner?goal=soften");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "too_harsh", total: 214 });
  });

  it("returns 404 when either slug is unknown", async () => {
    const { app } = appWith([[/WHERE f.slug/, (p) => (p[0] === "base" ? fragranceFor(p) : [])]]);
    const res = await request(app).get("/api/pairing/fragrances/base/rank/ghost?goal=enhance");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a missing goal or when a fragrance is ranked against itself", async () => {
    const { app } = appWith([]);
    expect((await request(app).get("/api/pairing/fragrances/a/rank/b")).status).toBe(400);
    const same = await request(app).get("/api/pairing/fragrances/a/rank/a?goal=enhance");
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe("same_fragrance");
  });
});
