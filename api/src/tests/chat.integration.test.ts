import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { signSession } from "../services/auth.js";
import { reserveMessage, torontoDay } from "../services/caps.js";
import { LlmUnavailableError, type Llm } from "../services/llm.js";
import { bestMatch } from "../services/search.js";
import { aiWith, auth, matrices, modelJson, settings } from "./helpers.js";

// The cap SQL, the chats, and the taste profile against a real Postgres with every
// migration (007 included) and the catalogue loaded. Skipped without TEST_DATABASE_URL.
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
  const guests = Array.from({ length: 10 }, () => randomUUID());
  const subjects = guests.map((g) => `guest:${g}`);
  let userId = 0;
  const day = torontoDay(Date.now());

  afterAll(async () => {
    const all = [...subjects, `user:${userId}`];
    // Deleting a chat deletes its messages (ON DELETE CASCADE, migration 007).
    await pool.query("DELETE FROM chat_conversations WHERE subject = ANY($1)", [all]);
    await pool.query("DELETE FROM llm_usage WHERE subject = ANY($1)", [all]);
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  async function guestsToday(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT count(DISTINCT subject)::int AS n FROM llm_usage WHERE day = $1 AND subject LIKE 'guest:%'",
      [day],
    );
    return rows[0].n;
  }

  const appFor = (llm: Llm, cap = 100) => createApp(pool, matrices, settings, auth, Date.now, aiWith(llm, { guestDailyConversationCap: cap }));
  type App = ReturnType<typeof appFor>;
  const say = (app: App, guest: string, message: string, conversationId?: string) =>
    request(app).post("/api/chat").set("X-Guest-Id", guest).send({ message, conversationId });

  it("shares one budget of 8 messages across all of a visitor's chats", async () => {
    const app = appFor(scriptedLlm());
    const first = await say(app, guests[0]!, "I like amber, chat A message 1");
    const chatA = first.body.conversation.id as string;
    for (let n = 2; n <= 5; n++) {
      const res = await say(app, guests[0]!, `chat A message ${n}`, chatA);
      expect(res.body.messagesUsed, `message ${n}`).toBe(n);
    }
    // A new chat starts free but draws on the same budget: messages 6 to 8.
    const chatB = (await say(app, guests[0]!, "chat B message 1")).body.conversation.id as string;
    expect(chatB).not.toBe(chatA);
    expect((await say(app, guests[0]!, "chat B message 2", chatB)).body.messagesUsed).toBe(7);
    expect((await say(app, guests[0]!, "chat B message 3", chatB)).body.messagesUsed).toBe(8);

    // The 9th is refused in an old chat, the newest chat, and a brand-new one.
    for (const conversationId of [chatA, chatB, undefined]) {
      const ninth = await say(app, guests[0]!, "one more", conversationId);
      expect(ninth.status).toBe(429);
      expect(ninth.body.error.code).toBe("chat_limit");
    }

    const { rows } = await pool.query("SELECT * FROM llm_usage WHERE subject = $1", [subjects[0]]);
    expect(rows).toHaveLength(1); // one budget row for the day, whatever the number of chats
    expect(rows[0]).toMatchObject({ user_messages: 8, input_tokens: 7200, output_tokens: 960 });

    // The list shows both chats, most recently used first, each titled from its first message.
    const page = await request(app).get("/api/chat").set("X-Guest-Id", guests[0]!);
    expect(page.body.messagesUsed).toBe(8);
    expect(page.body.conversations.map((c: { id: string; title: string }) => [c.id, c.title])).toEqual([
      [chatB, "chat B message 1"],
      [chatA, "I like amber, chat A message 1"],
    ]);
    // Each chat keeps its own transcript.
    const a = await request(app).get(`/api/chat/${chatA}`).set("X-Guest-Id", guests[0]!);
    expect(a.body.messages).toHaveLength(10);
    expect(a.body.messages[0]).toMatchObject({ role: "user", content: "I like amber, chat A message 1" });
    expect(a.body.messages[9].recommendations.length).toBeGreaterThan(0);
  });

  it("sends the model only the open chat's history", async () => {
    const seen: string[][] = [];
    const llm: Llm = {
      async complete(req) {
        seen.push(req.messages.map((m) => m.content));
        return scriptedLlm().complete(req);
      },
    };
    const app = appFor(llm);
    const chatA = (await say(app, guests[1]!, "smoky leather")).body.conversation.id;
    await say(app, guests[1]!, "fresh citrus");
    await say(app, guests[1]!, "more please", chatA);
    expect(seen[1]).toEqual(["fresh citrus"]); // a new chat starts with no history
    expect(seen[2]![0]).toBe("smoky leather");
    expect(seen[2]).not.toContain("fresh citrus");
  });

  it("counts guests, not chats, toward the site-wide cap", async () => {
    const app = appFor(scriptedLlm(), (await guestsToday()) + 1);
    // One guest under the cap opens three chats: still one guest.
    for (let n = 1; n <= 3; n++) {
      expect((await say(app, guests[2]!, `new chat ${n}`)).status, `chat ${n}`).toBe(200);
    }
    expect(await guestsToday()).toBeGreaterThan(0);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM chat_conversations WHERE subject = $1", [subjects[2]]);
    expect(rows[0].n).toBe(3);

    // A second guest is over the cap.
    const refused = await say(app, guests[3]!, "second guest over the cap");
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toBe("Today's guest demos are used up. Sign up or come back tomorrow.");
    // The first guest can still start another chat.
    expect((await say(app, guests[2]!, "a fourth chat")).status).toBe(200);
  });

  it("counts a guest once across features, so using the concierge too takes no second slot", async () => {
    // guests[8] used the concierge earlier today (M10 will write these rows).
    await pool.query("INSERT INTO llm_usage (subject, feature, day, user_messages) VALUES ($1, 'concierge', $2, 2)", [subjects[8], day]);
    const counted = await guestsToday();
    // The cap is full, but this guest is already counted, so their first chat goes through...
    expect((await say(appFor(scriptedLlm(), counted), guests[8]!, "first chat after the concierge")).status).toBe(200);
    // ...and they still count once, though they now have two budget rows.
    expect(await guestsToday()).toBe(counted);
    // With room for exactly one more guest, a new guest fits. Counting rows instead of
    // guests would count guests[8] twice and refuse them.
    expect((await say(appFor(scriptedLlm(), counted + 1), guests[9]!, "a new guest")).status).toBe(200);
  });

  it("lets only one of several simultaneous messages, in different chats, become message 8", async () => {
    // The claim itself, from separate pool connections at once: the per-visitor lock in
    // the route is in memory, so it can't be what keeps the count right.
    const key = { subject: subjects[4]!, feature: "chat" as const, day };
    await pool.query("INSERT INTO llm_usage (subject, feature, day, user_messages) VALUES ($1, 'chat', $2, 7)", [key.subject, day]);
    const caps = { maxUserMessages: 8, guestDailyConversationCap: 100_000 };
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveMessage(pool, key, caps)));
    expect(results.filter((r) => typeof r === "object")).toEqual([{ userMessages: 8 }]);
    expect(results.filter((r) => r === "daily_limit")).toHaveLength(4);

    // And through HTTP: two API processes (two apps, two in-memory locks) each get a
    // message for a different chat of a visitor at 7 used. One succeeds, one is refused.
    const [app1, app2] = [appFor(scriptedLlm()), appFor(scriptedLlm())];
    const chatA = (await say(app1, guests[5]!, "chat A")).body.conversation.id;
    const chatB = (await say(app1, guests[5]!, "chat B")).body.conversation.id;
    await pool.query("UPDATE llm_usage SET user_messages = 7 WHERE subject = $1", [subjects[5]]);
    const both = await Promise.all([say(app1, guests[5]!, "race A", chatA), say(app2, guests[5]!, "race B", chatB)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(both.find((r) => r.status === 200)!.body.messagesUsed).toBe(8);
    const { rows } = await pool.query("SELECT user_messages FROM llm_usage WHERE subject = $1", [subjects[5]]);
    expect(rows[0].user_messages).toBe(8);
  });

  it("deletes a chat and its messages, refunds nothing, and keeps it from other visitors", async () => {
    const app = appFor(scriptedLlm());
    const chat = (await say(app, guests[6]!, "a chat to delete")).body.conversation.id;
    // Another visitor can neither read, continue, nor delete it.
    expect((await request(app).get(`/api/chat/${chat}`).set("X-Guest-Id", guests[7]!)).status).toBe(404);
    expect((await say(app, guests[7]!, "hijack", chat)).status).toBe(404);
    await request(app).delete(`/api/chat/${chat}`).set("X-Guest-Id", guests[7]!);
    expect((await request(app).get(`/api/chat/${chat}`).set("X-Guest-Id", guests[6]!)).status).toBe(200);

    expect((await request(app).delete(`/api/chat/${chat}`).set("X-Guest-Id", guests[6]!)).status).toBe(204);
    expect((await request(app).get(`/api/chat/${chat}`).set("X-Guest-Id", guests[6]!)).status).toBe(404);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1", [chat]);
    expect(rows[0].n).toBe(0);
    expect((await request(app).get("/api/chat").set("X-Guest-Id", guests[6]!)).body.messagesUsed).toBe(1);
  });

  it("deletes chats 30 days after their last message, when a new chat starts", async () => {
    const app = appFor(scriptedLlm());
    const old = (await say(app, guests[6]!, "an old chat")).body.conversation.id;
    const recent = (await say(app, guests[6]!, "a recent chat")).body.conversation.id;
    await pool.query("UPDATE chat_conversations SET last_message_at = now() - interval '31 days' WHERE id = $1", [old]);
    await pool.query("UPDATE chat_conversations SET last_message_at = now() - interval '29 days' WHERE id = $1", [recent]);
    await say(app, guests[6]!, "a new chat");
    const { rows } = await pool.query("SELECT id FROM chat_conversations WHERE id = ANY($1)", [[old, recent]]);
    expect(rows.map((r) => r.id)).toEqual([recent]);
    const messages = await pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1", [old]);
    expect(messages.rows[0].n).toBe(0);
  });

  it("gives the message back when Anthropic is down, and leaves no empty chat", async () => {
    const guest = guests[7]!;
    const before = await pool.query("SELECT count(*)::int AS n FROM chat_conversations WHERE subject = $1", [`guest:${guest}`]);
    const app = appFor(scriptedLlm(new Set(["are you there?"])));
    const res = await say(app, guest, "are you there?");
    expect(res.status).toBe(503);
    const after = await pool.query("SELECT count(*)::int AS n FROM chat_conversations WHERE subject = $1", [`guest:${guest}`]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const { rows } = await pool.query("SELECT * FROM llm_usage WHERE subject = $1", [`guest:${guest}`]);
    expect(rows).toHaveLength(0); // an empty budget row doesn't hold a guest-cap slot
    expect((await say(app, guest, "back now")).body.messagesUsed).toBe(1);
  });

  it("finds named bottles with the catalogue search, and only real ones (DECISIONS B35)", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM fragrances WHERE brand = 'Jo Malone London' AND name = 'Myrrh & Tonka'",
    );
    // Tejas's first real test: "my favourites are Myrrh and Tonka, SWY Intensely, Hawas Fire".
    expect(await bestMatch(pool, "Myrrh and Tonka", settings.fuzzyMinSimilarity)).toBe(rows[0].id);
    // The "swy" name alias (name_aliases.csv) covers all three Stronger With You bottles;
    // "Intensely" picks the one meant.
    const swy = await pool.query("SELECT id FROM fragrances WHERE name = 'Emporio Armani Stronger With You Intensely'");
    expect(await bestMatch(pool, "SWY Intensely", settings.fuzzyMinSimilarity)).toBe(swy.rows[0].id);
    expect(await bestMatch(pool, "Hawas Fire", settings.fuzzyMinSimilarity)).toBeNull(); // not in the catalogue
    // The most voted bottle wins, and a typo still finds it.
    const aventus = await pool.query("SELECT id FROM fragrances WHERE brand = 'Creed' AND name = 'Aventus'");
    expect(await bestMatch(pool, "aventus", settings.fuzzyMinSimilarity)).toBe(aventus.rows[0].id);
    expect(await bestMatch(pool, "Aventis", settings.fuzzyMinSimilarity)).toBe(aventus.rows[0].id);
  });

  it("saves a signed-in user's profile, shared by every chat, and a guest import never overwrites it", async () => {
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
    // A second chat merges into the same profile: 0.6 × 0.4 + 0.4 × 1.
    const second = await request(app).post("/api/chat").set("Cookie", cookie).send({ message: "a second chat" });
    expect(second.body.conversation.id).not.toBe(res.body.conversation.id);
    expect(second.body.profile.families["Woody Amber"]).toBe(0.64);

    const imported = await request(app).post("/api/collection/import").set("Cookie", cookie)
      .send({ items: [], tasteProfile: { families: { Citrus: 1 }, facets: {} } });
    expect(imported.body.tasteProfile).toBe("kept");
    const after = await request(app).get("/api/profile/taste").set("Cookie", cookie);
    expect(after.body.profile.families.Citrus).toBe(0);
  });
});
