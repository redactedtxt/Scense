import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("GET /api/health", () => {
  it("returns 200 after pinging the database", async () => {
    const queries: string[] = [];
    const db = { query: async (sql: string) => (queries.push(sql), { rows: [] }) };

    const res = await request(createApp(db as never)).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(queries).toEqual(["SELECT 1"]);
  });

  it("returns 503 when the database is down", async () => {
    const db = { query: async () => { throw new Error("connection refused"); } };

    const res = await request(createApp(db as never)).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("db_unavailable");
  });
});
