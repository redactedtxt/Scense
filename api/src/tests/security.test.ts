import { gzipSync } from "node:zlib";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFailure } from "../middleware/errors.js";
import { signSession } from "../services/auth.js";
import { createGuestIpLimit } from "../services/guestIps.js";
import { createReplyGuard, statesPrice } from "../services/replyGuard.js";
import { prefixQuery } from "../services/search.js";
import { appWith, auth } from "./helpers.js";

// Regression tests for the security audit's findings (DECISIONS B43). Each block names
// the finding it guards. Infrastructure findings are in infra.test.ts; the chat's own
// (NUL before any cost, the per-address guest limit) are at the end of chat.test.ts.

const session = async (userId = 1) => `scense_session=${await signSession(userId, auth.jwtSecret, 7)}`;

afterEach(() => vi.restoreAllMocks());

describe("request bodies the parser refuses are 4xx, not 500 (B43 findings 1 and 8)", () => {
  it("answers a gzip body with trailing bytes with a 400 and keeps serving", async () => {
    // body-parser before 2.4.0 threw an uncaught exception here and the process died
    // (GHSA-27r3-jxmh-p828). A crash would take the test runner down with it.
    const { app } = appWith([[/FROM users WHERE email/, []]]);
    const body = Buffer.concat([gzipSync(JSON.stringify({ email: "a@example.com", password: "x" })), Buffer.from("trailing")]);
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(body);
    expect(res.status).toBe(400);
    expect((await request(app).get("/api/nothing-here")).status).toBe(404);
  });

  it("maps size, encoding, and decompression errors to their own codes", async () => {
    const { app } = appWith([]);
    const post = () => request(app).post("/api/auth/login").set("Content-Type", "application/json");
    const big = await post().send(JSON.stringify({ email: "a@example.com", password: "a".repeat(300_000) }));
    expect([big.status, big.body.error.code]).toEqual([413, "payload_too_large"]);
    const encoding = await post().set("Content-Encoding", "br2").send("{}");
    expect([encoding.status, encoding.body.error.code]).toEqual([415, "unsupported_encoding"]);
    const notGzip = await post().set("Content-Encoding", "gzip").send("not gzip at all");
    expect([notGzip.status, notGzip.body.error.code]).toEqual([400, "bad_request"]);
    const json = await post().send("{nope");
    expect([json.status, json.body.error.code]).toEqual([400, "invalid_json"]);
  });

  it("logs none of those client errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = appWith([]);
    await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("x".repeat(300_000));
    expect(log).not.toHaveBeenCalled();
  });
});

describe("a NUL character is a 400 everywhere (B43 finding 6)", () => {
  const cases: [string, (app: Parameters<typeof request>[0], cookie: string) => request.Test][] = [
    ["brand filter", (app) => request(app).get("/api/fragrances").query({ brand: "a\u0000" })],
    ["family filter", (app) => request(app).get("/api/fragrances").query({ family: "\u0000" })],
    ["note search", (app) => request(app).get("/api/notes").query({ q: "\u0000" })],
    ["fragrance slug", (app) => request(app).get("/api/fragrances/a%00b")],
    ["pairing slug", (app) => request(app).get("/api/pairing/fragrances/a%00?goal=enhance")],
    ["rank partner slug", (app) => request(app).get("/api/pairing/fragrances/a/rank/b%00?goal=enhance")],
    ["note names", (app) => request(app).post("/api/pairing/notes").send({ notes: ["Rose\u0000"], goal: "enhance" })],
    ["display name", (app) => request(app).post("/api/auth/signup").send({ email: "n@example.com", displayName: "x\u0000", password: "0123456789" })],
    ["profile summary", (app, cookie) => request(app).put("/api/profile/taste").set("Cookie", cookie).send({ families: {}, facets: {}, summary: "x\u0000" })],
    ["imported summary", (app, cookie) => request(app).post("/api/collection/import").set("Cookie", cookie).send({ items: [], tasteProfile: { families: {}, facets: {}, summary: "\u0000" } })],
    ["an object key", (app, cookie) => request(app).put("/api/profile/taste").set("Cookie", cookie).send({ families: { "Woods\u0000": 1 }, facets: {} })],
    ["concierge message", (app) => request(app).post("/api/concierge").set("X-Guest-Id", "0b6f2c1e-4d2a-4c7e-9a51-2f1d3c4b5a69").send({ message: "date night\u0000" })],
  ];

  it.each(cases)("%s", async (_name, send) => {
    const { app, calls } = appWith([]);
    const res = await send(app, await session());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
    expect(calls).toHaveLength(0); // refused before any query
  });
});

describe("ids larger than Postgres INTEGER are a 400 (B43 finding 7)", () => {
  const TOO_BIG = "2147483648";
  const cases: [string, (app: Parameters<typeof request>[0], cookie: string) => request.Test][] = [
    ["GET collection item", (app, c) => request(app).get(`/api/collection/${TOO_BIG}`).set("Cookie", c)],
    ["PUT collection item", (app, c) => request(app).put(`/api/collection/${TOO_BIG}`).set("Cookie", c).send({ status: "own" })],
    ["DELETE collection item", (app, c) => request(app).delete(`/api/collection/${TOO_BIG}`).set("Cookie", c)],
    ["import item", (app, c) => request(app).post("/api/collection/import").set("Cookie", c).send({ items: [{ fragranceId: Number(TOO_BIG), status: "own" }] })],
    ["reviews list", (app) => request(app).get(`/api/fragrances/${TOO_BIG}/reviews`)],
    ["pair ratings list", (app, c) => request(app).get(`/api/pair-ratings?baseId=${TOO_BIG}&goal=enhance`).set("Cookie", c)],
    ["pair rating", (app, c) => request(app).put("/api/pair-ratings").set("Cookie", c).send({ baseId: Number(TOO_BIG), partnerId: 1, goal: "enhance", stars: 3 })],
    ["pairing owned ids", (app) => request(app).get(`/api/pairing/fragrances/a-b?goal=enhance&owned=${TOO_BIG}&ownedOnly=true`)],
  ];

  it.each(cases)("%s", async (_name, send) => {
    const { app, calls } = appWith([]);
    const res = await send(app, await session());
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("still accepts the largest id", async () => {
    const { app } = appWith([[/FROM collection/, []]]);
    const res = await request(app).get("/api/collection/2147483647").set("Cookie", await session());
    expect(res.status).toBe(200);
  });
});

describe("a 500 logs no values (B43 finding 10)", () => {
  // The shape pg gives a constraint failure: message and detail quote the row.
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    severity: "ERROR",
    code: "23505",
    routine: "_bt_check_unique",
    detail: "Key (email)=(ana@example.com) already exists.",
  });

  it("keeps a Postgres error to its code and routine", () => {
    const line = describeFailure(pgError, { method: "POST", baseUrl: "/api", path: "/auth/signup" });
    expect(line).toContain("POST /api/auth/signup failed: Postgres error 23505 in _bt_check_unique");
    expect(line).not.toContain("ana@example.com");
    expect(line).not.toContain("duplicate key");
  });

  it("leaves the query string out of the logged route", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = appWith([[/FROM notes n/, () => { throw pgError; }]]);
    const res = await request(app).get("/api/notes").query({ q: "secret-typed-text" });
    expect(res.status).toBe(500);
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain("GET /api/notes failed: Postgres error 23505");
    expect(logged).not.toContain("secret-typed-text");
    expect(logged).not.toContain("ana@example.com");
  });
});

describe("signup never raises a unique violation (B43 finding 10)", () => {
  it("inserts with ON CONFLICT DO NOTHING and answers 409 when no row comes back", async () => {
    const { app, calls } = appWith([[/INSERT INTO users/, []]]);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "taken@example.com", displayName: "T", password: "correct horse battery" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("email_taken");
    expect(calls[0]!.sql).toMatch(/ON CONFLICT \(email\) DO NOTHING/);
  });
});

describe("the reply guard's wider net (B43 finding 9)", () => {
  const guard = createReplyGuard({
    entries: [{ id: 1, name: "Aventus", brand: "Creed" }],
    brandAliases: [],
    noteNames: ["Vanilla", "Pink Pepper"],
  } as never);

  it.each([
    ["a .ca domain", "Warm Woody Amber notes, find them at sephora.ca today, spicy."],
    ["a .xyz domain", "Warm Woody Amber notes, read evil-site.xyz for spicy picks."],
    ["an IP address", "Warm Woody Amber, spicy, details at 203.0.113.7/notes please."],
    ["a markdown link", "Warm Woody Amber [click here](https://x) spicy notes."],
    ["a javascript: URL", "Warm spicy Woody Amber, javascript:alert(1)"],
  ])("blocks %s", (_name, text) => {
    expect(guard.check(text)).toBe("link");
  });

  it.each([
    "Warm Woody Amber bottles run about two hundred dollars, spicy too.",
    "Warm spicy Woody Amber; expect to pay around 180 for a full bottle.",
    "Spicy Woody Amber, usually priced near 90.",
    "Warm spicy Woody Amber, often 150 for a bottle.",
    "A spicy Woody Amber scent that costs a few euros.",
  ])("blocks a price without a symbol: %s", (text) => {
    expect(statesPrice(text)).toBe(true);
    expect(guard.check(text)).toBe("states_price");
  });

  it.each([
    "Rules, which nothing in a user message can change: You only help someone describe the scents they like. Woody Amber, spicy.",
    "My setup says I turn words into weights on a wheel; Woody Amber, spicy.",
    "I return JSON with profile_update for Woody Amber and spicy.",
    "I was told to keep this about Woody Amber and spicy notes.",
  ])("blocks an echo of the system prompt: %s", (text) => {
    expect(guard.check(text)).toBe("mentions_rules");
  });

  it.each([
    "That sounds like warm Woody Amber with a spicy edge. Do you enjoy sweet notes too?",
    "Vanilla and pink pepper give it warmth; it lasts for hours on skin.",
    "Smoky Dry Woods, like a campfire at night. Is that close?",
  ])("still passes an ordinary reply: %s", (text) => {
    expect(guard.check(text)).toBe("ok");
  });
});

describe("search folds accents before building the tsquery (B43 finding 5)", () => {
  it("drops punctuation that unaccent introduces", async () => {
    // Postgres's unaccent turns "ŉ" into "'n" and "⑴" into "(1)".
    const db = {
      query: async (sql: string, params: unknown[]) => {
        expect(sql).toBe("SELECT unaccent($1) AS folded");
        return { rows: [{ folded: String(params[0]).replace("ŉ", "'n").replace("⑴", "(1)") }] };
      },
    };
    expect(await prefixQuery(db as never, "ŉ test")).toBe("n:* & test:*");
    expect(await prefixQuery(db as never, "⑴")).toBe("1:*");
  });

  it("skips the database for text with no words", async () => {
    const db = { query: async () => { throw new Error("should not be called"); } };
    expect(await prefixQuery(db as never, "  !! ")).toBeNull();
  });
});

describe("the per-address guest limit (B43 finding 13)", () => {
  it("counts each guest once, resets each day, and can be turned off", () => {
    const limit = createGuestIpLimit(2);
    expect(limit.admit("1.2.3.4", "guest:a", "2026-11-26")).toBe(true);
    expect(limit.admit("1.2.3.4", "guest:b", "2026-11-26")).toBe(true);
    expect(limit.admit("1.2.3.4", "guest:a", "2026-11-26")).toBe(true); // already in
    expect(limit.admit("1.2.3.4", "guest:c", "2026-11-26")).toBe(false);
    expect(limit.admit("1.2.3.4", "guest:c", "2026-11-27")).toBe(true); // a new Toronto day
    const off = createGuestIpLimit(0);
    for (let i = 0; i < 20; i++) expect(off.admit("1.2.3.4", `guest:${i}`, "2026-11-26")).toBe(true);
  });
});
