import request from "supertest";
import { describe, expect, it } from "vitest";
import { signSession } from "../services/auth.js";
import { aiWith, appWith, auth } from "./helpers.js";

// The taste profile endpoints, the guest import's profile half, and the admin usage
// report, with a fake database.

async function cookieFor(userId: number) {
  return `scense_session=${await signSession(userId, auth.jwtSecret, 7)}`;
}

describe("GET/PUT /api/profile/taste", () => {
  it("needs a signed-in user", async () => {
    const { app } = appWith([]);
    expect((await request(app).get("/api/profile/taste")).status).toBe(401);
    expect((await request(app).put("/api/profile/taste").send({ families: {}, facets: {} })).status).toBe(401);
  });

  it("returns null before the user has a profile, and the full shape after", async () => {
    const { app } = appWith([[/FROM taste_profiles/, []]]);
    const res = await request(app).get("/api/profile/taste").set("Cookie", await cookieFor(7));
    expect(res.body).toEqual({ profile: null });

    const stored = { families: { Amber: 0.5 }, facets: { sweet: 0.2 }, summary: "You like amber." };
    const { app: app2 } = appWith([[/FROM taste_profiles/, [stored]]]);
    const full = await request(app2).get("/api/profile/taste").set("Cookie", await cookieFor(7));
    expect(Object.keys(full.body.profile.families)).toHaveLength(14);
    expect(Object.keys(full.body.profile.facets)).toHaveLength(6);
    expect(full.body.profile).toMatchObject({ families: { Amber: 0.5, Citrus: 0 }, summary: "You like amber." });
  });

  it("saves slider edits, rebuilds the summary from the numbers, and rejects bad weights", async () => {
    const { app, calls } = appWith([[/INSERT INTO taste_profiles/, []]]);
    const cookie = await cookieFor(7);
    const res = await request(app)
      .put("/api/profile/taste")
      .set("Cookie", cookie)
      .send({ families: { Citrus: 0.9 }, facets: { smoky: -0.5 } });
    expect(res.body.profile.summary).toBe("You lean toward Citrus scents and avoid smoky ones.");
    expect(calls[0]!.params[0]).toBe(7);

    const bad = await request(app).put("/api/profile/taste").set("Cookie", cookie).send({ families: { Citrus: 2 }, facets: {} });
    expect(bad.status).toBe(400);
  });
});

describe("guest import with a taste profile", () => {
  const items = [{ fragranceId: 5, status: "own" }];
  const tasteProfile = { families: { Amber: 0.6 }, facets: {}, summary: "You like amber." };

  it("fills an empty account profile", async () => {
    const { app, calls } = appWith([[/INSERT INTO collection/, [{ fragrance_id: 5 }]], [/INSERT INTO taste_profiles/, [{ user_id: 7 }]]]);
    const res = await request(app).post("/api/collection/import").set("Cookie", await cookieFor(7)).send({ items, tasteProfile });
    expect(res.body).toEqual({ imported: 1, skipped: 0, tasteProfile: "imported" });
    expect(JSON.parse(calls[1]!.params[1] as string).Amber).toBe(0.6);
  });

  it("keeps an account's existing profile, and says so", async () => {
    const { app } = appWith([[/INSERT INTO collection/, []], [/INSERT INTO taste_profiles/, []]]);
    const res = await request(app).post("/api/collection/import").set("Cookie", await cookieFor(7)).send({ items: [], tasteProfile });
    expect(res.body.tasteProfile).toBe("kept");
  });

  it("reports none when the guest has no profile", async () => {
    const { app, calls } = appWith([[/INSERT INTO collection/, []]]);
    const res = await request(app).post("/api/collection/import").set("Cookie", await cookieFor(7)).send({ items });
    expect(res.body.tasteProfile).toBe("none");
    expect(calls.some((c) => /taste_profiles/.test(c.sql))).toBe(false);
  });
});

describe("GET /api/admin/usage", () => {
  const TOKEN = "test-admin-token-0123456789";
  const day = { day: "2026-10-21", visitors: 3, guests: 2, chats_started: 5, user_messages: 10, input_tokens: "12000", output_tokens: "2000" };

  it("does not exist without an ADMIN_TOKEN, and needs the right token when there is one", async () => {
    const { app: off } = appWith([], undefined, aiWith(null, { adminToken: "" }));
    expect((await request(off).get("/api/admin/usage").set("X-Admin-Token", "")).status).toBe(404);
    const { app } = appWith([], undefined, aiWith(null));
    expect((await request(app).get("/api/admin/usage")).status).toBe(401);
    expect((await request(app).get("/api/admin/usage").set("X-Admin-Token", "wrong")).status).toBe(401);
  });

  it("sums tokens per day and estimates the cost at Haiku 5.5 prices", async () => {
    const now = () => Date.UTC(2026, 9, 21, 16);
    const { app, calls } = appWith([[/FROM llm_usage/, [day]]], now, aiWith(null));
    const res = await request(app).get("/api/admin/usage?days=7").set("X-Admin-Token", TOKEN);
    expect(res.status).toBe(200);
    // 12,000 × $0.10/M + 2,000 × $0.50/M = $0.0012 + $0.001
    expect(res.body.days[0]).toMatchObject({ day: "2026-10-21", inputTokens: 12000, outputTokens: 2000, estimatedUsd: 0.0022 });
    expect(res.body.days[0]).toMatchObject({ visitors: 3, guests: 2, chatsStarted: 5, userMessages: 10 });
    expect(res.body.monthToDate).toMatchObject({ chatsStarted: 5, userMessages: 10, estimatedUsd: 0.0022 });
    expect(res.body.monthToDate).not.toHaveProperty("visitors");
    expect(res.body).toMatchObject({ model: "claude-haiku-5-5", today: "2026-10-21", guestDailyConversationCap: 100 });
    expect(calls[0]!.params).toEqual(["2026-10-21", 7]);
  });
});
