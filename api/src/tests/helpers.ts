import { fileURLToPath } from "node:url";
import { createApp, type AiDeps } from "../app.js";
import { aiDefaults, authSettings, loadConfig } from "../config.js";
import type { Llm, LlmRequest, LlmResponse } from "../services/llm.js";
import { loadCatalogueSettings } from "../services/catalogue.js";
import { loadMatrices } from "../services/scoring.js";

// The real scoring.yaml, so tests fail if the file and the API drift apart.
export const SCORING_PATH = fileURLToPath(new URL("../../../pipeline/config/scoring.yaml", import.meta.url));
export const matrices = loadMatrices(SCORING_PATH);
export const settings = loadCatalogueSettings(SCORING_PATH);

// The real config loader with test values: cost 4 so hashing is quick, and the default
// limits (5 per 15 minutes for login, 5 per hour for signup) so the tests check them.
export const auth = authSettings(
  loadConfig({ DATABASE_URL: "unused", JWT_SECRET: "test-secret-that-is-at-least-32-chars", BCRYPT_COST: "4" }),
);

type Route = [match: RegExp, rows: unknown[] | ((params: unknown[]) => unknown[])];

// A stand-in for the database: the first route whose pattern matches the SQL answers.
// Endpoint tests check HTTP behaviour (validation, shapes, status codes); the real SQL
// is checked against Postgres in integration.test.ts.
export function fakeDb(routes: Route[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const route = routes.find(([match]) => match.test(sql));
      if (!route) throw new Error(`fakeDb: no route for SQL: ${sql}`);
      const rows = typeof route[1] === "function" ? route[1](params) : route[1];
      return { rows };
    },
  };
  return { db, calls };
}

export function appWith(routes: Route[], now?: () => number, ai?: AiDeps) {
  const { db, calls } = fakeDb(routes);
  return { app: createApp(db as never, matrices, settings, auth, now, ai), calls };
}

// The stand-in for Anthropic (SPEC section 14: no test ever calls the real API). Each
// call takes the next scripted answer; an Error in the script is thrown instead, the way
// llm.ts throws LlmUnavailableError. Every request is kept so tests can read the prompt.
export function fakeLlm(script: (Partial<LlmResponse> | Error)[]) {
  const requests: LlmRequest[] = [];
  const llm: Llm = {
    async complete(request) {
      requests.push(request);
      const next = script.shift();
      if (next === undefined) throw new Error("fakeLlm: no scripted answer left");
      if (next instanceof Error) throw next;
      return { text: "", stopReason: "end_turn", inputTokens: 100, outputTokens: 50, ...next };
    },
  };
  return { llm, requests };
}

// A model answer in the SPEC section 8 shape, as the text the API would send back.
export function modelJson(overrides: Record<string, unknown> = {}): Partial<LlmResponse> {
  return {
    text: JSON.stringify({
      reply: "That sounds like warm Woody Amber with a spicy edge. Do you enjoy sweet notes too?",
      profile_update: { families: { "Woody Amber": 1 }, facets: { spicy: 0.5 } },
      summary: "You lean toward warm spicy scents.",
      ready_to_recommend: false,
      ...overrides,
    }),
  };
}

// AI settings with test-friendly defaults; pass overrides for the number under test.
export function aiWith(llm: Llm | null, overrides: Partial<AiDeps["settings"]> = {}): AiDeps {
  return { settings: { ...aiDefaults(), adminToken: "test-admin-token-0123456789", ...overrides }, llm };
}

// A 14-value family profile with all its weight on one ring position.
export function profileAt(index: number): number[] {
  return Array.from({ length: 14 }, (_, i) => (i === index ? 1 : 0));
}
