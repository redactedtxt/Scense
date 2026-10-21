import request from "supertest";
import { describe, expect, it } from "vitest";
import { signSession } from "../services/auth.js";
import { appWith, auth } from "./helpers.js";

// HTTP behaviour of the collection endpoints with a fake db. The real SQL (the import's
// skip rules, the one-list-per-bottle key) runs in accounts.integration.test.ts.

const row = {
  id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", image_url: null,
  family: "Fruity", status: "own", added_at: "2026-10-19T12:00:00.000Z",
};

async function cookieFor(userId: number) {
  return `scense_session=${await signSession(userId, auth.jwtSecret, 7)}`;
}

describe("the collection API", () => {
  it("needs a signed-in user on every route", async () => {
    const { app, calls } = appWith([]);
    for (const [method, path] of [["get", "/api/collection"], ["put", "/api/collection/5"],
      ["delete", "/api/collection/5"], ["post", "/api/collection/import"]] as const) {
      const res = await request(app)[method](path).send({ status: "own" });
      expect(res.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("lists the user's bottles in the guest store's shape, scoped to that user", async () => {
    const { app, calls } = appWith([[/FROM collection c/, [row]]]);
    const res = await request(app).get("/api/collection").set("Cookie", await cookieFor(7));
    expect(res.body.items).toEqual([{
      id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", imageUrl: null,
      dominantFamily: "Fruity", status: "own", addedAt: "2026-10-19T12:00:00.000Z",
    }]);
    expect(calls[0]!.params).toEqual([7]);
  });

  it("PUT saves a status and rejects anything but own or want", async () => {
    const { app, calls } = appWith([[/INSERT INTO collection/, []], [/FROM collection c/, [row]]]);
    const cookie = await cookieFor(7);
    const ok = await request(app).put("/api/collection/5").set("Cookie", cookie).send({ status: "own" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("own");
    expect(calls[0]!.params).toEqual([7, 5, "own"]);

    const bad = await request(app).put("/api/collection/5").set("Cookie", cookie).send({ status: "tried" });
    expect(bad.status).toBe(400);
  });

  it("PUT answers 404 for a fragrance id that does not exist", async () => {
    const { app } = appWith([[/INSERT INTO collection/, () => {
      throw Object.assign(new Error("fk"), { code: "23503" });
    }]]);
    const res = await request(app).put("/api/collection/99999").set("Cookie", await cookieFor(7)).send({ status: "want" });
    expect(res.status).toBe(404);
  });

  it("GET one answers status null for a bottle not in the collection", async () => {
    const { app } = appWith([[/FROM collection c/, []]]);
    const res = await request(app).get("/api/collection/5").set("Cookie", await cookieFor(7));
    expect(res.body).toEqual({ fragranceId: 5, status: null });
  });

  it("import reports how many were added and skipped", async () => {
    const { app, calls } = appWith([[/INSERT INTO collection/, [{ fragrance_id: 5 }]]]);
    const res = await request(app)
      .post("/api/collection/import")
      .set("Cookie", await cookieFor(7))
      .send({ items: [
        { fragranceId: 5, status: "own", addedAt: "2026-10-01T10:00:00.000Z" },
        { fragranceId: 99999, status: "want" },
      ] });
    expect(res.body).toEqual({ imported: 1, skipped: 1, tasteProfile: "none" });
    expect(calls[0]!.params).toEqual([7, [5, 99999], ["own", "want"], ["2026-10-01T10:00:00.000Z", null]]);
  });

  it("import rejects a bad item and more items than the catalogue could hold", async () => {
    const { app } = appWith([]);
    const cookie = await cookieFor(7);
    const bad = await request(app).post("/api/collection/import").set("Cookie", cookie)
      .send({ items: [{ fragranceId: "five", status: "own" }] });
    expect(bad.status).toBe(400);
    const huge = Array.from({ length: 2001 }, (_, i) => ({ fragranceId: i + 1, status: "own" }));
    const tooMany = await request(app).post("/api/collection/import").set("Cookie", cookie).send({ items: huge });
    expect(tooMany.status).toBe(400);
  });
});
