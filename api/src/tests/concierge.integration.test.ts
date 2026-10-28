import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { CATALOGUE_LINE } from "../routes/concierge.js";
import { reserveMessage, torontoDay } from "../services/caps.js";
import type { Llm } from "../services/llm.js";
import { aiWith, auth, matrices, modelJson, settings } from "./helpers.js";

// The concierge against a real Postgres with every migration (008 included) and the
// catalogue loaded: its own budget, the guest cap shared with the chat, the race, and a
// whole outing. Skipped without TEST_DATABASE_URL. The model is a fake: no test calls
// Anthropic. Every row made here is deleted.
const url = process.env.TEST_DATABASE_URL;

const NONE = { value: null, evidence: "" };

// Answers like the real model would, from the message alone: a date night at 8 on a
// restaurant terrace fills four slots; a reasons request gets a plain sentence per pick.
function scriptedLlm(): Llm {
  return {
    async complete({ system, messages, schema }) {
      const usage = { stopReason: "end_turn", inputTokens: 500, outputTokens: 80 };
      if (system.includes("in one sentence each")) {
        const keys = Object.keys((schema as { properties: object }).properties);
        return { ...usage, text: JSON.stringify(Object.fromEntries(keys.map((k) => [k, "Easy to wear for this outing."]))) };
      }
      const said = messages.at(-1)!.content.toLowerCase();
      const slots = {
        occasion: said.includes("date") ? { value: "date_night", evidence: "date" } : NONE,
        time_of_day: said.includes("at 8") ? { value: "night", evidence: "at 8" } : NONE,
        season: NONE,
        setting: said.includes("terrace") ? { value: "outdoor", evidence: "terrace" } : NONE,
        projection: said.includes("subtle") ? { value: "low", evidence: "subtle" } : NONE,
        budget: NONE,
        source: NONE,
      };
      return { ...usage, text: JSON.stringify({ slots, next_question: "", question_slot: null }) };
    },
  };
}

describe.skipIf(!url)("the concierge against Postgres", () => {
  const pool = new pg.Pool({ connectionString: url });
  const guests = Array.from({ length: 8 }, () => randomUUID());
  const subjects = guests.map((g) => `guest:${g}`);
  const day = torontoDay(Date.now());
  const appFor = (cap = 100) =>
    createApp(pool, matrices, settings, auth, Date.now, aiWith(scriptedLlm(), { guestDailyConversationCap: cap }));
  type App = ReturnType<typeof appFor>;
  const ask = (app: App, guest: string, message: string, conversationId?: string, owned: number[] = []) =>
    request(app).post("/api/concierge").set("X-Guest-Id", guest).send({ message, conversationId, owned });
  let firstIds: number[] = [];

  beforeAll(async () => {
    const { rows } = await pool.query("SELECT id FROM fragrances ORDER BY id LIMIT 3");
    firstIds = rows.map((r) => r.id as number);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM chat_conversations WHERE subject = ANY($1)", [subjects]);
    await pool.query("DELETE FROM llm_usage WHERE subject = ANY($1)", [subjects]);
    await pool.end();
  });

  async function guestsToday(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT count(DISTINCT subject)::int AS n FROM llm_usage WHERE day = $1 AND subject LIKE 'guest:%'",
      [day],
    );
    return rows[0].n;
  }

  it("asks for what's missing, one slot at a time, then picks from the whole catalogue for an empty Own list", async () => {
    const app = appFor();
    const first = await ask(app, guests[0]!, "Date night, dinner at 8 on a restaurant terrace");
    expect(first.status).toBe(200);
    const id = first.body.conversation.id as string;
    // Occasion, time, and setting came from the message; the season is asked next.
    expect(first.body.outing.map((s: { value: string | null }) => s.value)).toEqual(["Date night", "Night", null, "Outdoor", null, null]);
    expect(first.body.options).toHaveLength(4); // the four seasons, today's first
    const season = await ask(app, guests[0]!, first.body.options[0], id);
    expect(season.body.options).toEqual(["Low", "Medium", "High"]);
    const done = await ask(app, guests[0]!, "Medium", id);
    expect(done.body.picks).toHaveLength(3);
    expect(done.body.reply.split("\n")[1]).toBe(CATALOGUE_LINE);
    // Only the typed first message counted; the two chip answers were free (B38).
    expect(done.body.messagesUsed).toBe(1);
    const usage = await pool.query("SELECT user_messages, input_tokens, output_tokens FROM llm_usage WHERE subject = $1", [subjects[0]]);
    // Tokens: the first message's slot call, and the sentence call the last chip set off.
    expect(usage.rows).toEqual([{ user_messages: 1, input_tokens: 1000, output_tokens: 160 }]);

    // The outing reopens with its slots, chips, picks, and sentences.
    const reopened = await request(app).get(`/api/concierge/${id}`).set("X-Guest-Id", guests[0]!);
    expect(reopened.body.messages).toHaveLength(6);
    expect(reopened.body.messages[1].options).toEqual(first.body.options);
    expect(reopened.body.messages[5].picks.map((p: { id: number }) => p.id)).toEqual(done.body.picks.map((p: { id: number }) => p.id));
    expect(reopened.body.messages[5].picks[0].reason).toBe("Easy to wear for this outing.");
    const { rows } = await pool.query("SELECT feature, slots FROM chat_conversations WHERE id = $1", [id]);
    expect(rows[0]).toMatchObject({ feature: "concierge", slots: { occasion: "date_night", projection: "medium" } });
  });

  it("logs a free chip's tokens even on a day with no budget row yet", async () => {
    const app = appFor();
    const first = await ask(app, guests[7]!, "date night at 8 on a terrace, something subtle");
    // As if the outing were continued on a new day: today's row is gone.
    await pool.query("DELETE FROM llm_usage WHERE subject = $1", [subjects[7]]);
    const done = await ask(app, guests[7]!, "Winter", first.body.conversation.id);
    expect(done.body.picks).toHaveLength(3);
    const { rows } = await pool.query("SELECT user_messages, input_tokens FROM llm_usage WHERE subject = $1", [subjects[7]]);
    expect(rows).toEqual([{ user_messages: 0, input_tokens: 500 }]);
  });

  it("picks only from the Own list when there is one", async () => {
    const app = appFor();
    const first = await ask(app, guests[1]!, "date night at 8 on a terrace, something subtle", undefined, firstIds);
    const id = first.body.conversation.id as string;
    const done = await ask(app, guests[1]!, "Winter", id, firstIds);
    expect(done.body.picks.map((p: { id: number }) => p.id).sort()).toEqual([...firstIds].sort());
    expect(done.body.reply).not.toContain(CATALOGUE_LINE);
  });

  it("keeps outings and chats apart: neither list, nor either page, shows the other", async () => {
    const app = appFor();
    const outing = (await ask(app, guests[2]!, "date night")).body.conversation.id as string;
    const chat = { ...modelJson(), stopReason: "end_turn", inputTokens: 1, outputTokens: 1 };
    const chatApp = createApp(pool, matrices, settings, auth, Date.now, aiWith({ complete: async () => ({ ...chat, text: chat.text! }) }));
    const chatId = (await request(chatApp).post("/api/chat").set("X-Guest-Id", guests[2]!).send({ message: "warm amber" })).body
      .conversation.id as string;

    const chats = await request(app).get("/api/chat").set("X-Guest-Id", guests[2]!);
    const outings = await request(app).get("/api/concierge").set("X-Guest-Id", guests[2]!);
    expect(chats.body.conversations.map((c: { id: string }) => c.id)).toEqual([chatId]);
    expect(outings.body.conversations.map((c: { id: string }) => c.id)).toEqual([outing]);
    expect((await request(app).get(`/api/chat/${outing}`).set("X-Guest-Id", guests[2]!)).status).toBe(404);
    expect((await request(app).get(`/api/concierge/${chatId}`).set("X-Guest-Id", guests[2]!)).status).toBe(404);
    // Deleting through the wrong feature deletes nothing.
    await request(app).delete(`/api/chat/${outing}`).set("X-Guest-Id", guests[2]!);
    expect((await request(app).get(`/api/concierge/${outing}`).set("X-Guest-Id", guests[2]!)).status).toBe(200);
  });

  it("has its own 8 messages a day, separate from the chat's", async () => {
    const caps = { maxUserMessages: 8, guestDailyConversationCap: 100 };
    // The chat's budget is used up...
    for (let n = 0; n < 8; n++) await reserveMessage(pool, { subject: subjects[3]!, feature: "chat", day }, caps);
    const app = appFor();
    // ...but the concierge still has all 8.
    let id: string | undefined;
    for (let n = 1; n <= 8; n++) {
      const res = await ask(app, guests[3]!, `date night, message ${n}`, id);
      expect(res.body.messagesUsed, `message ${n}`).toBe(n);
      id = res.body.conversation.id;
    }
    for (const conversationId of [id, undefined]) {
      const ninth = await ask(app, guests[3]!, "one more", conversationId);
      expect(ninth.status).toBe(429);
      expect(ninth.body.error.code).toBe("concierge_limit");
    }
    const { rows } = await pool.query("SELECT feature, user_messages FROM llm_usage WHERE subject = $1 ORDER BY feature", [subjects[3]]);
    expect(rows).toEqual([{ feature: "chat", user_messages: 8 }, { feature: "concierge", user_messages: 8 }]);
  });

  it("counts a guest once for the site-wide cap, whichever features they use", async () => {
    const before = await guestsToday();
    const app = appFor(before + 1);
    // Guest 4 takes the last slot through the concierge...
    expect((await ask(app, guests[4]!, "date night")).status).toBe(200);
    expect(await guestsToday()).toBe(before + 1);
    // ...and may still use the chat, which takes no second slot.
    const chat = { ...modelJson(), stopReason: "end_turn", inputTokens: 1, outputTokens: 1 };
    const chatApp = createApp(pool, matrices, settings, auth, Date.now, aiWith({ complete: async () => ({ ...chat, text: chat.text! }) }, { guestDailyConversationCap: before + 1 }));
    expect((await request(chatApp).post("/api/chat").set("X-Guest-Id", guests[4]!).send({ message: "amber" })).status).toBe(200);
    expect(await guestsToday()).toBe(before + 1);
    // A new guest is refused in either feature.
    const refused = await ask(app, guests[5]!, "date night");
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("guest_cap");
    expect((await request(chatApp).post("/api/chat").set("X-Guest-Id", guests[5]!).send({ message: "amber" })).body.error.code).toBe("guest_cap");
  });

  it("lets only one of several simultaneous messages become message 8", async () => {
    const key = { subject: subjects[6]!, feature: "concierge" as const, day };
    const caps = { maxUserMessages: 8, guestDailyConversationCap: 100 };
    for (let n = 0; n < 7; n++) await reserveMessage(pool, key, caps);
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveMessage(pool, key, caps)));
    expect(results.filter((r) => typeof r === "object")).toEqual([{ userMessages: 8 }]);
    expect(results.filter((r) => r === "daily_limit")).toHaveLength(4);
  });
});
