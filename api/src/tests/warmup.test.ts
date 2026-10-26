import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDefaults } from "../config.js";
import { reserveMessage } from "../services/caps.js";
import { EXTRACTION_SCHEMA, reasonsSchema } from "../services/conciergePrompt.js";
import { LlmUnavailableError } from "../services/llm.js";
import { OUTPUT_SCHEMA } from "../services/prompt.js";
import { startWarmups, WARMUP_SUBJECT, warmSchemas, warmupSchemas, warmupsEnabled } from "../services/warmup.js";
import type { Db } from "../db.js";
import { fakeDb as anyFakeDb, fakeLlm } from "./helpers.js";

// Schema warm-ups (DECISIONS B40), with the fake model and the fake database: which
// schemas, how often, whose budget, and what a failure does.

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = () => Date.UTC(2026, 9, 26, 16);
const quiet = () => ({ info: vi.fn(), error: vi.fn() });
const ok = { text: "", stopReason: "max_tokens", inputTokens: 300, outputTokens: 1 };

// The helper's stand-in, typed as the pool the warm-ups take.
const fakeDb = (...args: Parameters<typeof anyFakeDb>) => {
  const { db, calls } = anyFakeDb(...args);
  return { db: db as unknown as Db, calls };
};

// Lets the warm-up's awaited calls finish without moving the fake clock.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("which schemas", () => {
  it("are exactly the objects the real calls send, one per pick count", () => {
    const schemas = warmupSchemas();
    expect(schemas.map((s) => s.name)).toEqual([
      "chat",
      "concierge extraction",
      "concierge picks (1)",
      "concierge picks (2)",
      "concierge picks (3)",
    ]);
    expect(schemas[0]!.schema).toBe(OUTPUT_SCHEMA);
    expect(schemas[1]!.schema).toBe(EXTRACTION_SCHEMA);
    for (const n of [1, 2, 3]) expect(schemas[n + 1]!.schema).toEqual(reasonsSchema(n));
    expect(schemas.map((s) => s.feature)).toEqual(["chat", "concierge", "concierge", "concierge", "concierge"]);
  });

  it("are sent with the smallest prompt and one output token", async () => {
    const { llm, requests } = fakeLlm([ok]);
    const { db } = fakeDb([[/INSERT INTO llm_usage/, []]]);
    await warmSchemas(llm, db, warmupSchemas().slice(0, 1), NOW, quiet());
    expect(requests[0]).toEqual({
      system: "Reply with JSON.",
      messages: [{ role: "user", content: "{}" }],
      schema: OUTPUT_SCHEMA,
      maxTokens: 1,
    });
  });
});

describe("when they run", () => {
  it("is off without a key, with an interval of 0, and under tests", () => {
    const on = { ...aiDefaults(), apiKey: "sk-test" };
    expect(warmupsEnabled(on, {})).toBe(true);
    expect(warmupsEnabled({ ...on, apiKey: "" }, {})).toBe(false);
    expect(warmupsEnabled({ ...on, warmupIntervalMs: 0 }, {})).toBe(false);
    expect(warmupsEnabled(on, { VITEST: "true" })).toBe(false);
    expect(warmupsEnabled(on, { NODE_ENV: "test" })).toBe(false);
    // This very process is a test run.
    expect(warmupsEnabled(on)).toBe(false);
  });

  it("defaults to every 20 hours, with a 45 second timeout on real calls", () => {
    const ai = aiDefaults();
    expect(ai.warmupIntervalMs).toBe(20 * HOUR);
    expect(ai.warmupRetryMs).toBe(15 * MINUTE);
    expect(ai.timeoutMs).toBe(45_000);
  });
});

describe("the schedule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("warms every schema at once, then again every interval, until stopped", async () => {
    const { llm, requests } = fakeLlm(Array.from({ length: 15 }, () => ok));
    const { db } = fakeDb([[/INSERT INTO llm_usage/, []]]);
    const stop = startWarmups({ llm, db, schemas: warmupSchemas(), intervalMs: 20 * HOUR, retryMs: 15 * MINUTE, now: NOW, log: quiet() });
    await settle();
    expect(requests).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(20 * HOUR - 1);
    expect(requests).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(20 * HOUR);
    expect(requests).toHaveLength(15);

    stop();
    await vi.advanceTimersByTimeAsync(40 * HOUR);
    expect(requests).toHaveLength(15);
  });

  it("returns before any warm-up finishes, so startup never waits", () => {
    const never = { complete: () => new Promise<never>(() => {}) };
    const { db } = fakeDb([]);
    const stop = startWarmups({ llm: never, db, schemas: warmupSchemas(), intervalMs: HOUR, retryMs: MINUTE, now: NOW, log: quiet() });
    expect(typeof stop).toBe("function");
    stop();
  });
});

describe("the budget", () => {
  it("logs the tokens under the system subject, never a visitor's, and claims no message", async () => {
    const { llm } = fakeLlm(Array.from({ length: 5 }, () => ok));
    const { db, calls } = fakeDb([[/INSERT INTO llm_usage/, []]]);
    await warmSchemas(llm, db, warmupSchemas(), NOW, quiet());

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      // addTokens' upsert: tokens only, user_messages untouched.
      expect(call.sql).toMatch(/input_tokens, output_tokens\) VALUES/);
      expect(call.sql).not.toMatch(/user_messages/);
      expect(call.params.slice(0, 3)).toEqual([WARMUP_SUBJECT, expect.any(String), "2026-10-26"]);
      expect(call.params.slice(3)).toEqual([300, 1]);
    }
    expect(calls.map((c) => c.params[1])).toEqual(["chat", "concierge", "concierge", "concierge", "concierge"]);
  });

  it("is a subject the guest cap does not count", async () => {
    // The cap counts subjects LIKE 'guest:%'; the warm-up subject is not one.
    expect(WARMUP_SUBJECT.startsWith("guest:")).toBe(false);
    expect(WARMUP_SUBJECT.startsWith("user:")).toBe(false);
    // And reserveMessage treats only 'guest:' subjects as guests.
    const { db, calls } = fakeDb([[/INSERT INTO llm_usage/, [{ user_messages: 1 }]]]);
    await reserveMessage(db, { subject: "guest:abc", feature: "chat", day: "2026-10-26" }, { maxUserMessages: 8, guestDailyConversationCap: 1 });
    expect(calls[0]!.sql).toMatch(/subject LIKE 'guest:%'/);
  });
});

describe("failures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("logs a failed call, skips its token write, and carries on with the rest", async () => {
    const log = quiet();
    const { llm, requests } = fakeLlm([new LlmUnavailableError("The model could not be reached."), ok, ok, ok, ok]);
    const { db, calls } = fakeDb([[/INSERT INTO llm_usage/, []]]);
    const failed = await warmSchemas(llm, db, warmupSchemas(), NOW, log);
    expect(requests).toHaveLength(5);
    expect(calls).toHaveLength(4);
    expect(failed.map((s) => s.name)).toEqual(["chat"]);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/warm-up failed for chat/));
  });

  it("logs a failed token write without retrying the warmed schema", async () => {
    const log = quiet();
    const { llm } = fakeLlm([ok]);
    const db = { query: async () => Promise.reject(new Error("database is starting up")) } as unknown as Db;
    const failed = await warmSchemas(llm, db, warmupSchemas().slice(0, 1), NOW, log);
    expect(failed).toEqual([]);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/could not log its tokens/));
  });

  it("retries only the failed schemas after the retry delay, until they succeed", async () => {
    const down = new LlmUnavailableError("The model could not be reached.");
    // Run 1: chat fails. Retry 1: chat fails again. Retry 2: chat succeeds.
    const { llm, requests } = fakeLlm([down, ok, ok, ok, ok, down, ok]);
    const { db } = fakeDb([[/INSERT INTO llm_usage/, []]]);
    const stop = startWarmups({ llm, db, schemas: warmupSchemas(), intervalMs: 20 * HOUR, retryMs: 15 * MINUTE, now: NOW, log: quiet() });
    await settle();
    expect(requests).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(requests).toHaveLength(6);
    expect(requests[5]!.schema).toBe(OUTPUT_SCHEMA);
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(requests).toHaveLength(7);
    // Warm now: no more retries before the next full run.
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    expect(requests).toHaveLength(7);
    stop();
  });

  it("never throws out of the schedule, even when the model is down every time", async () => {
    const down = () => Promise.reject(new Error("socket hang up"));
    const llm = { complete: vi.fn(down) };
    const { db } = fakeDb([]);
    const log = quiet();
    const stop = startWarmups({ llm, db, schemas: warmupSchemas(), intervalMs: 20 * HOUR, retryMs: 15 * MINUTE, now: NOW, log });
    await settle();
    await vi.advanceTimersByTimeAsync(HOUR);
    // 5 at start, then 5 at each of the 4 retries in the hour.
    expect(llm.complete).toHaveBeenCalledTimes(25);
    expect(log.error).toHaveBeenCalledTimes(25);
    stop();
  });
});
