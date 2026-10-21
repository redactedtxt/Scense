import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { auth, matrices, settings } from "./helpers.js";

// The accounts and collection SQL against a real Postgres with migration 003 applied and
// the catalogue loaded. Skipped without TEST_DATABASE_URL, like integration.test.ts.
// Each run signs up a fresh user and deletes it afterwards (its rows cascade away).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("accounts against Postgres", () => {
  const pool = new pg.Pool({ connectionString: url });
  const app = createApp(pool, matrices, settings, auth);
  const email = `it-${randomUUID()}@example.com`;
  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
    await pool.end();
  });

  let cookie = "";
  const agent = (method: "get" | "put" | "post" | "delete", path: string) =>
    request(app)[method](path).set("Cookie", cookie);

  it("signs up, and the email is unique whatever its case (citext)", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email, displayName: "IT", password: "long enough pw" });
    expect(res.status).toBe(201);
    cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    const again = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", "198.51.100.1")
      .send({ email: email.toUpperCase(), displayName: "IT", password: "long enough pw" });
    expect(again.status).toBe(409);
    const login = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password: "long enough pw" });
    expect(login.status).toBe(200);
  });

  it("saves, moves, lists, and removes bottles, one list per bottle", async () => {
    expect((await agent("put", "/api/collection/1").send({ status: "want" })).body.status).toBe("want");
    const moved = await agent("put", "/api/collection/1").send({ status: "own" });
    expect(moved.body).toMatchObject({ id: 1, status: "own" });
    expect(typeof moved.body.dominantFamily).toBe("string");
    const list = await agent("get", "/api/collection");
    expect(list.body.items.map((i: { id: number }) => i.id)).toEqual([1]);
    expect((await agent("put", "/api/collection/999999").send({ status: "own" })).status).toBe(404);
    expect((await agent("delete", "/api/collection/1")).status).toBe(204);
    expect((await agent("get", "/api/collection/1")).body.status).toBeNull();
  });

  it("imports a guest list: unknown ids skipped, the account's status wins, duplicates once", async () => {
    await agent("put", "/api/collection/2").send({ status: "own" });
    const res = await agent("post", "/api/collection/import").send({
      items: [
        { fragranceId: 2, status: "want" }, // already Own in the account: stays Own
        { fragranceId: 3, status: "want", addedAt: "2026-10-01T09:00:00.000Z" },
        { fragranceId: 3, status: "own" }, // the same bottle twice in one import
        { fragranceId: 999999, status: "own" }, // not in the catalogue
        { fragranceId: 4, status: "own", addedAt: "2999-01-01T00:00:00.000Z" }, // future time clamped
      ],
    });
    expect(res.body).toEqual({ imported: 2, skipped: 3, tasteProfile: "none" });
    const items = (await agent("get", "/api/collection")).body.items as { id: number; status: string; addedAt: string }[];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[2]!.status).toBe("own");
    expect(byId[3]).toMatchObject({ status: "want", addedAt: "2026-10-01T09:00:00.000Z" });
    expect(Date.parse(byId[4]!.addedAt)).toBeLessThanOrEqual(Date.now());
  });
});
