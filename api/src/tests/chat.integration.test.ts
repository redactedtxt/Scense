import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { signSession } from "../services/auth.js";
import { torontoDay } from "../services/caps.js";
import { LlmUnavailableError, type Llm } from "../services/llm.js";
import { aiWith, auth, matrices, modelJson, settings } from "./helpers.js";

// The cap SQL, the transcript, and the taste profile against a real Postgres with
// migrations up to 005 and the catalogue loaded. Skipped without TEST_DATABASE_URL.
// The model is still a fake: no test calls Anthropic. Every row made here is deleted.
const url = process.env.TEST_DATABASE_URL;

// Answers every call with a valid reply, or fails the calls listed in `failFor`.
function scriptedLlm(failFor: Set<string> = new Set()): Llm {
  return {
    async complete({ messages }) {
      if (failFor.has(messages.at(-1)!.content)) throw new LlmUnavailableError("down");
      return { ...modelJson({ ready_to_recommend: true }), text: modelJson({ ready_to_recommend: true }).text!, stopReason: "end_turn", inputTokens: 900, outputTokens: 120 };
    },
  };
}

describe.skipIf(!url)("chat caps against Postgres", () => {
  const pool = new pg.Pool({ connectionString: url });
  const guests = Array.from({ length: 4 }, () => randomUUID());
  const subjects = guests.map((g) => `guest:${g}`);
  let userId = 0;
  const day = torontoDay(Date.now());

  afterAll(async () => {
    const all = [...subjects, `user:${userId}`];
    await pool.query(
      `DELETE FROM chat_messages WHERE conversation_id IN (SELECT conversation_id FROM llm_usage WHERE subject = ANY($1))`,
      [all],
    );
    await pool.query("DELETE FROM llm_usage WHERE subject = ANY($1)", [all]);
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  async function guestConversationsToday(): Promise<number> {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM llm_usage WHERE day = $1 AND subject LIKE 'guest:%'", [day]);
    return rows[0].n;
  }

  const appFor = (llm: Llm, cap = 100) => createApp(pool, matrices, settings, auth, Date.now, aiWith(llm, { guestDailyConversationCap: cap }));
  const say = (app: ReturnType<typeof appFor>, guest: string, message: string) =>
    request(app).post("/api/chat").set("X-Guest-Id", guest).send({ message });

  it("allows 8 messages in one conversation and refuses the 9th", async () => {
    const app = appFor(scriptedLlm());
    for (let n = 1; n <= 8; n++) {
      const res = await say(app, guests[0]!, `I like amber, message ${n}`);
      expect(res.status, `message ${n}`).toBe(200);
      expect(res.body.messagesUsed).toBe(n);
    }
    const ninth = await say(app, guests[0]!, "one more");
    expect(ninth.status).toBe(429);
    expect(ninth.body.error.code).toBe("chat_limit");

    const { rows } = await pool.query("SELECT * FROM llm_usage WHERE subject = $1", [subjects[0]]);
    expect(rows).toHaveLength(1); // one conversation for the day
    expect(rows[0]).toMatchObject({ user_messages: 8, input_tokens: 7200, output_tokens: 960 });

    const page = await request(app).get("/api/chat").set("X-Guest-Id", guests[0]!);
    expect(page.body.messages).toHaveLength(16);
    expect(page.body.messages[0]).toMatchObject({ role: "user", content: "I like amber, message 1" });
    expect(page.body.messages[15].recommendations.length).toBeGreaterThan(0);
  });

  it("stops new guest conversations at the site-wide cap, but lets started ones continue", async () => {
    const app = appFor(scriptedLlm(), (await guestConversationsToday()) + 1);
    expect((await say(app, guests[1]!, "first guest under the cap")).status).toBe(200);
    const refused = await say(app, guests[2]!, "second guest over the cap");
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toBe("Today's guest demos are used up. Sign up or come back tomorrow.");
    expect((await say(app, guests[1]!, "still my conversation")).status).toBe(200);
  });

  it("gives the message back when Anthropic is down", async () => {
    const app = appFor(scriptedLlm(new Set(["are you there?"])));
    const res = await say(app, guests[3]!, "are you there?");
    expect(res.status).toBe(503);
    const { rows } = await pool.query("SELECT * FROM llm_usage WHERE subject = $1", [subjects[3]]);
    expect(rows).toHaveLength(0); // an empty conversation doesn't hold a guest-cap slot
    expect((await say(app, guests[3]!, "back now")).body.messagesUsed).toBe(1);
  });

  it("saves a signed-in user's profile, and a guest import never overwrites it", async () => {
    const { rows } = await pool.query(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Chat IT', 'x') RETURNING id",
      [`chat-it-${randomUUID()}@example.com`],
    );
    userId = rows[0].id;
    const cookie = `scense_session=${await signSession(userId, auth.jwtSecret, 7)}`;
    const app = appFor(scriptedLlm());
    const res = await request(app).post("/api/chat").set("Cookie", cookie).send({ message: "warm spicy woods" });
    expect(res.status).toBe(200);
    const saved = await request(app).get("/api/profile/taste").set("Cookie", cookie);
    expect(saved.body.profile.families["Woody Amber"]).toBe(0.4);

    const imported = await request(app).post("/api/collection/import").set("Cookie", cookie)
      .send({ items: [], tasteProfile: { families: { Citrus: 1 }, facets: {} } });
    expect(imported.body.tasteProfile).toBe("kept");
    const after = await request(app).get("/api/profile/taste").set("Cookie", cookie);
    expect(after.body.profile.families.Citrus).toBe(0);
  });
});
