import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { auth, matrices, settings } from "./helpers.js";

// Reviews and pair ratings against a real Postgres with migrations up to 004 applied and
// the catalogue loaded. Skipped without TEST_DATABASE_URL, like the other integration
// tests. Two fresh users are signed up and deleted afterwards (their rows cascade away).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("reviews and pair ratings against Postgres", () => {
  const pool = new pg.Pool({ connectionString: url });
  const app = createApp(pool, matrices, settings, auth);
  const emails = [`it-${randomUUID()}@example.com`, `it-${randomUUID()}@example.com`];
  const cookies: string[] = [];
  // A fragrance nobody else's tests touch, so the counts below are ours alone.
  let fragranceId = 0;

  beforeAll(async () => {
    for (const [index, email] of emails.entries()) {
      const res = await request(app)
        .post("/api/auth/signup")
        .set("X-Forwarded-For", `198.51.100.${index + 10}`)
        .send({ email, displayName: `Tester ${index + 1}`, password: "long enough pw" });
      cookies.push(String(res.headers["set-cookie"]).split(";")[0]!);
    }
    const { rows } = await pool.query(
      "SELECT id FROM fragrances WHERE id NOT IN (SELECT fragrance_id FROM reviews) ORDER BY id DESC LIMIT 1",
    );
    fragranceId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE email = ANY($1)", [emails]);
    await pool.end();
  });

  const reviews = () => `/api/fragrances/${fragranceId}/reviews`;

  it("one review per user per fragrance: a second POST is a 409, PUT edits it", async () => {
    const first = await request(app).post(reviews()).set("Cookie", cookies[0]!).send({ stars: 4, body: "Warm and soft." });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ stars: 4, authorName: "Tester 1", mine: true });
    const again = await request(app).post(reviews()).set("Cookie", cookies[0]!).send({ stars: 2, body: "Again" });
    expect(again.status).toBe(409);
    const edited = await request(app).put(reviews()).set("Cookie", cookies[0]!).send({ stars: 2, body: "Faded fast." });
    expect(edited.body).toMatchObject({ id: first.body.id, stars: 2, body: "Faded fast." });
    expect(Date.parse(edited.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(edited.body.createdAt));
  });

  it("lists newest first, flags the viewer's own, and stores a script tag as plain text", async () => {
    const script = `<script>alert("x")</script>`;
    await request(app).post(reviews()).set("Cookie", cookies[1]!).send({ stars: 5, body: script });
    const asGuest = await request(app).get(reviews());
    expect(asGuest.body.total).toBe(2);
    expect(asGuest.body.items.map((r: { authorName: string }) => r.authorName)).toEqual(["Tester 2", "Tester 1"]);
    expect(asGuest.body.items[0].body).toBe(script);
    expect(asGuest.body.mine).toBeNull();
    const asFirst = await request(app).get(reviews()).set("Cookie", cookies[0]!);
    expect(asFirst.body.mine).toMatchObject({ authorName: "Tester 1" });
    expect(asFirst.body.items.map((r: { mine: boolean }) => r.mine)).toEqual([false, true]);
  });

  it("DELETE removes only the caller's own review", async () => {
    expect((await request(app).delete(reviews()).set("Cookie", cookies[0]!)).status).toBe(204);
    const list = await request(app).get(reviews());
    expect(list.body.items.map((r: { authorName: string }) => r.authorName)).toEqual(["Tester 2"]);
  });

  it("the database itself refuses a review over 2,000 characters", async () => {
    const userId = (await pool.query("SELECT id FROM users WHERE email = $1", [emails[0]])).rows[0].id;
    await expect(
      pool.query("INSERT INTO reviews (user_id, fragrance_id, stars, body) VALUES ($1, $2, 3, $3)", [
        userId, fragranceId, "a".repeat(2001),
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it("a pair rating is stored, replaced on a second PUT, and kept apart per goal", async () => {
    const put = (goal: string, stars: number) =>
      request(app).put("/api/pair-ratings").set("Cookie", cookies[0]!).send({ baseId: 1, partnerId: 2, goal, stars });
    expect((await put("soften", 3)).status).toBe(200);
    expect((await put("soften", 5)).status).toBe(200);
    expect((await put("enhance", 1)).status).toBe(200);
    const soften = await request(app).get("/api/pair-ratings?baseId=1&goal=soften").set("Cookie", cookies[0]!);
    expect(soften.body.items).toEqual([{ partnerId: 2, stars: 5 }]);
    const enhance = await request(app).get("/api/pair-ratings?baseId=1&goal=enhance").set("Cookie", cookies[0]!);
    expect(enhance.body.items).toEqual([{ partnerId: 2, stars: 1 }]);
    const other = await request(app).get("/api/pair-ratings?baseId=1&goal=soften").set("Cookie", cookies[1]!);
    expect(other.body.items).toEqual([]);
    expect((await request(app).put("/api/pair-ratings").set("Cookie", cookies[0]!)
      .send({ baseId: 1, partnerId: 999999, goal: "soften", stars: 3 })).status).toBe(404);
  });

  it("ratings change no score: the pairing list reads the same before and after", async () => {
    const { rows } = await pool.query("SELECT slug FROM fragrances WHERE id = 1");
    const before = await request(app).get(`/api/pairing/fragrances/${rows[0].slug}?goal=enhance`);
    await request(app).put("/api/pair-ratings").set("Cookie", cookies[1]!).send({ baseId: 1, partnerId: before.body.items[5].id, goal: "enhance", stars: 5 });
    const after = await request(app).get(`/api/pairing/fragrances/${rows[0].slug}?goal=enhance`);
    expect(after.body.items).toEqual(before.body.items);
  });
});
