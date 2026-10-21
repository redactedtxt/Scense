import request from "supertest";
import { describe, expect, it } from "vitest";
import { signSession } from "../services/auth.js";
import { appWith, auth } from "./helpers.js";

// HTTP behaviour of reviews and pair ratings with a fake db. The real SQL (one review
// per user per fragrance, newest-first order, the rating upsert) runs in
// reviews.integration.test.ts.

const reviewRow = {
  id: 3, user_id: 7, stars: 4, body: "Lovely in the cold.", display_name: "Ana",
  created_at: "2026-10-20T12:00:00.000Z", updated_at: "2026-10-20T12:00:00.000Z",
};

async function cookieFor(userId: number) {
  return `scense_session=${await signSession(userId, auth.jwtSecret, 7)}`;
}

describe("reviews", () => {
  it("guests can read but not write, and a refused write never reaches the database", async () => {
    const { app, calls } = appWith([[/AS found/, [{ found: true, total: 1 }]], [/FROM reviews r/, [reviewRow]]]);
    const list = await request(app).get("/api/fragrances/5/reviews");
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ authorName: "Ana", stars: 4, mine: false });
    expect(list.body.mine).toBeNull();
    const before = calls.length;
    for (const method of ["post", "put", "delete"] as const) {
      const res = await request(app)[method]("/api/fragrances/5/reviews").send({ stars: 5, body: "x" });
      expect(res.status).toBe(401);
    }
    expect(calls).toHaveLength(before);
  });

  it("lists a page newest first with paging numbers, and marks the viewer's own review", async () => {
    const { app, calls } = appWith([[/AS found/, [{ found: true, total: 23 }]], [/FROM reviews r/, [reviewRow]]]);
    const res = await request(app).get("/api/fragrances/5/reviews?page=3").set("Cookie", await cookieFor(7));
    expect(res.body).toMatchObject({ page: 3, pageSize: 10, total: 23, totalPages: 3 });
    expect(res.body.items[0].mine).toBe(true);
    expect(res.body.mine).toMatchObject({ id: 3, mine: true });
    expect(calls[1]!.sql).toMatch(/ORDER BY r\.created_at DESC, r\.id DESC/);
    expect(calls[1]!.params).toEqual([5, 20]);
  });

  it("answers 404 for a fragrance id that does not exist", async () => {
    const { app } = appWith([[/AS found/, [{ found: false, total: 0 }]]]);
    expect((await request(app).get("/api/fragrances/99999/reviews")).status).toBe(404);
  });

  it("checks stars and text: 1 to 5 stars, some words, at most 2,000 characters", async () => {
    const { app, calls } = appWith([]);
    const cookie = await cookieFor(7);
    const post = (body: object) => request(app).post("/api/fragrances/5/reviews").set("Cookie", cookie).send(body);
    for (const body of [
      { stars: 0, body: "ok" }, { stars: 6, body: "ok" }, { stars: 3.5, body: "ok" },
      { stars: 3, body: "   " }, { stars: 3, body: "a".repeat(2001) }, { stars: 3, body: "a\0b" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("counts characters the way Postgres does, so 2,000 emoji fit", async () => {
    const { app, calls } = appWith([[/INSERT INTO reviews/, [reviewRow]]]);
    const res = await request(app)
      .post("/api/fragrances/5/reviews")
      .set("Cookie", await cookieFor(7))
      .send({ stars: 5, body: "🌹".repeat(2000) }); // 4,000 UTF-16 units, 2,000 characters
    expect(res.status).toBe(201);
    expect(calls[0]!.params).toEqual([7, 5, 5, "🌹".repeat(2000)]);
  });

  it("stores the text exactly as typed: no HTML escaping on the way in", async () => {
    const { app, calls } = appWith([[/INSERT INTO reviews/, [reviewRow]]]);
    const text = `<script>alert("hi")</script> & <b>bold</b>`;
    await request(app).post("/api/fragrances/5/reviews").set("Cookie", await cookieFor(7)).send({ stars: 2, body: text });
    expect(calls[0]!.params[3]).toBe(text);
  });

  it("a second review of the same fragrance is a 409, and an unknown fragrance a 404", async () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    const cookie = await cookieFor(7);
    const dup = appWith([[/INSERT INTO reviews/, fail("23505")]]).app;
    const res = await request(dup).post("/api/fragrances/5/reviews").set("Cookie", cookie).send({ stars: 3, body: "again" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("review_exists");
    const missing = appWith([[/INSERT INTO reviews/, fail("23503")]]).app;
    expect((await request(missing).post("/api/fragrances/9/reviews").set("Cookie", cookie).send({ stars: 3, body: "x" })).status).toBe(404);
  });

  it("PUT edits only the caller's own review, and 404s when there is none", async () => {
    const { app, calls } = appWith([[/UPDATE reviews/, []]]);
    const res = await request(app).put("/api/fragrances/5/reviews").set("Cookie", await cookieFor(7)).send({ stars: 1, body: "Changed my mind" });
    expect(res.status).toBe(404);
    expect(calls[0]!.sql).toMatch(/WHERE user_id = \$1 AND fragrance_id = \$2/);
    expect(calls[0]!.params).toEqual([7, 5, 1, "Changed my mind"]);
  });

  it("DELETE removes only the caller's own review", async () => {
    const { app, calls } = appWith([[/DELETE FROM reviews/, []]]);
    const res = await request(app).delete("/api/fragrances/5/reviews").set("Cookie", await cookieFor(8));
    expect(res.status).toBe(204);
    expect(calls[0]!.params).toEqual([8, 5]);
  });

  it("limits writes per user: the 11th in an hour is refused, another user is not affected", async () => {
    let time = 0;
    const { app } = appWith([[/DELETE FROM reviews/, []]], () => time);
    const ana = await cookieFor(7);
    for (let i = 0; i < auth.reviewLimit.max; i++) {
      expect((await request(app).delete("/api/fragrances/5/reviews").set("Cookie", ana)).status).toBe(204);
    }
    const blocked = await request(app).delete("/api/fragrances/5/reviews").set("Cookie", ana);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await request(app).delete("/api/fragrances/5/reviews").set("Cookie", await cookieFor(8))).status).toBe(204);
    // Once the hour has passed, Ana can write again.
    time += auth.reviewLimit.windowMs + 1;
    expect((await request(app).delete("/api/fragrances/5/reviews").set("Cookie", ana)).status).toBe(204);
  });
});

describe("pair ratings", () => {
  const rating = { baseId: 5, partnerId: 9, goal: "soften", stars: 4 };

  it("need a signed-in user", async () => {
    const { app, calls } = appWith([]);
    expect((await request(app).put("/api/pair-ratings").send(rating)).status).toBe(401);
    expect((await request(app).get("/api/pair-ratings?baseId=5&goal=soften")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("PUT stores or replaces the user's rating for that pair and goal", async () => {
    const { app, calls } = appWith([[/INSERT INTO pair_ratings/, []]]);
    const res = await request(app).put("/api/pair-ratings").set("Cookie", await cookieFor(7)).send(rating);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rating);
    expect(calls[0]!.sql).toMatch(/ON CONFLICT \(user_id, base_id, partner_id, goal\)/);
    expect(calls[0]!.params).toEqual([7, 5, 9, "soften", 4]);
  });

  it("PUT rejects bad stars, an unknown goal, and a fragrance paired with itself", async () => {
    const { app, calls } = appWith([]);
    const cookie = await cookieFor(7);
    for (const body of [{ ...rating, stars: 0 }, { ...rating, stars: 6 }, { ...rating, goal: "brighten" }, { ...rating, partnerId: 5 }]) {
      expect((await request(app).put("/api/pair-ratings").set("Cookie", cookie).send(body)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("PUT answers 404 for a fragrance id that does not exist", async () => {
    const { app } = appWith([[/INSERT INTO pair_ratings/, () => {
      throw Object.assign(new Error("fk"), { code: "23503" });
    }]]);
    expect((await request(app).put("/api/pair-ratings").set("Cookie", await cookieFor(7)).send({ ...rating, partnerId: 99999 })).status).toBe(404);
  });

  it("GET lists the user's ratings for one base and goal", async () => {
    const { app, calls } = appWith([[/FROM pair_ratings/, [{ partner_id: 9, stars: 4 }]]]);
    const res = await request(app).get("/api/pair-ratings?baseId=5&goal=soften").set("Cookie", await cookieFor(7));
    expect(res.body).toEqual({ baseId: 5, goal: "soften", items: [{ partnerId: 9, stars: 4 }] });
    expect(calls[0]!.params).toEqual([7, 5, "soften"]);
  });

  it("limits rating writes per user", async () => {
    const { app } = appWith([[/INSERT INTO pair_ratings/, []], [/FROM pair_ratings/, []]], () => 0);
    const cookie = await cookieFor(7);
    for (let i = 0; i < auth.pairRatingLimit.max; i++) {
      await request(app).put("/api/pair-ratings").set("Cookie", cookie).send(rating);
    }
    expect((await request(app).put("/api/pair-ratings").set("Cookie", cookie).send(rating)).status).toBe(429);
    // Reading your ratings back is not a write, so it still works.
    expect((await request(app).get("/api/pair-ratings?baseId=5&goal=soften").set("Cookie", cookie)).status).toBe(200);
  });
});
