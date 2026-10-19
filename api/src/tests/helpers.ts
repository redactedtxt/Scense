import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { loadCatalogueSettings } from "../services/catalogue.js";
import { loadMatrices } from "../services/scoring.js";

// The real scoring.yaml, so tests fail if the file and the API drift apart.
export const SCORING_PATH = fileURLToPath(new URL("../../../pipeline/config/scoring.yaml", import.meta.url));
export const matrices = loadMatrices(SCORING_PATH);
export const settings = loadCatalogueSettings(SCORING_PATH);

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

export function appWith(routes: Route[]) {
  const { db, calls } = fakeDb(routes);
  return { app: createApp(db as never, matrices, settings), calls };
}

// A 14-value family profile with all its weight on one ring position.
export function profileAt(index: number): number[] {
  return Array.from({ length: 14 }, (_, i) => (i === index ? 1 : 0));
}
