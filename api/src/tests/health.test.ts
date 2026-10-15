import request from "supertest";
import { describe, expect, it } from "vitest";
import { appWith } from "./helpers.js";

describe("GET /api/health", () => {
  it("returns 200 after pinging the database", async () => {
    const { app, calls } = appWith([[/SELECT 1/, []]]);

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(calls.map((c) => c.sql)).toEqual(["SELECT 1"]);
  });

  it("returns 503 when the database is down", async () => {
    const { app } = appWith([[/SELECT 1/, () => { throw new Error("connection refused"); }]]);

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("db_unavailable");
  });
});

describe("unknown routes and bad JSON", () => {
  it("returns the JSON error shape for an unknown /api path", async () => {
    const { app } = appWith([]);
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "No such endpoint." } });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const { app } = appWith([]);
    const res = await request(app).post("/api/pairing/notes").set("Content-Type", "application/json").send("{oops");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });
});
