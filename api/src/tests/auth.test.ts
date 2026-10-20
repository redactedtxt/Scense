import { SignJWT } from "jose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createLimiter } from "../middleware/rateLimit.js";
import { readSession, signSession, verifyPassword } from "../services/auth.js";
import { appWith, auth } from "./helpers.js";

// Auth endpoints against an in-memory users table (the fake db answers by SQL pattern).
// The SQL itself is checked against Postgres in accounts.integration.test.ts.

type User = { id: number; email: string; display_name: string; password_hash: string };

function usersApp(now?: () => number) {
  const users: User[] = [];
  const byEmail = (email: unknown) => users.filter((u) => u.email.toLowerCase() === String(email).toLowerCase());
  const { app, calls } = appWith(
    [
      [/INSERT INTO users/, (params) => {
        const [email, display_name, password_hash] = params as string[];
        // Postgres would raise this for the UNIQUE (citext) email column.
        if (byEmail(email).length) throw Object.assign(new Error("duplicate"), { code: "23505" });
        const user = { id: users.length + 1, email: email!, display_name: display_name!, password_hash: password_hash! };
        users.push(user);
        return [user];
      }],
      [/FROM users WHERE email/, (params) => byEmail(params[0])],
      [/FROM users WHERE id/, (params) => users.filter((u) => u.id === params[0])],
    ],
    now,
  );
  return { app, users, calls };
}

const ANA = { email: "ana@example.com", displayName: "Ana", password: "correct horse battery" };

// "scense_session=<token>", ready to send back as a Cookie header.
function sessionCookie(res: request.Response): string {
  const header = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return header.find((c) => c.startsWith("scense_session="))!.split(";")[0]!;
}

describe("POST /api/auth/signup", () => {
  it("creates the account, hashes the password, and sets a locked-down session cookie", async () => {
    const { app, users } = usersApp();
    const res = await request(app).post("/api/auth/signup").send(ANA);
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: 1, email: ANA.email, displayName: "Ana" });

    expect(users[0]!.password_hash).not.toContain(ANA.password);
    expect(await verifyPassword(ANA.password, users[0]!.password_hash)).toBe(true);

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=604800/); // 7 days
  });

  it("rejects a short password, an over-long one, and a bad email", async () => {
    const { app } = usersApp();
    const cases = [
      { ...ANA, password: "nine char" },
      { ...ANA, password: "é".repeat(37) }, // 37 characters but 74 bytes: bcrypt would drop the end
      { ...ANA, email: "not-an-email" },
      { ...ANA, displayName: "   " },
    ];
    for (const body of cases) {
      const res = await request(app).post("/api/auth/signup").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    }
  });

  it("refuses a second account for the same email, whatever its case", async () => {
    const { app } = usersApp();
    await request(app).post("/api/auth/signup").send(ANA);
    const res = await request(app).post("/api/auth/signup").send({ ...ANA, email: "ANA@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("email_taken");
  });
});

describe("login, me, logout", () => {
  let app: ReturnType<typeof usersApp>["app"];
  beforeEach(async () => {
    app = usersApp().app;
    await request(app).post("/api/auth/signup").send(ANA);
  });

  it("logs in, and /me answers with the user for that cookie", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: "Ana@Example.com", password: ANA.password });
    expect(login.status).toBe(200);
    const me = await request(app).get("/api/auth/me").set("Cookie", sessionCookie(login));
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe("Ana");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email: ANA.email, password: "wrong password" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "bo@example.com", password: "anything" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("answers 401 on /me with no cookie, a forged token, or an expired one", async () => {
    const forged = await signSession(1, "some-other-secret-that-is-32-chars-long", 7);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(auth.jwtSecret));
    for (const cookie of [undefined, `scense_session=${forged}`, `scense_session=${expired}`, "scense_session=junk"]) {
      const req = request(app).get("/api/auth/me");
      const res = cookie ? await req.set("Cookie", cookie) : await req;
      expect(res.status).toBe(401);
    }
  });

  it("logout clears the cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/scense_session=;.*Expires=Thu, 01 Jan 1970/);
  });
});

describe("session tokens", () => {
  it("round-trip the user id and refuse an unsigned token", async () => {
    expect(await readSession(await signSession(42, auth.jwtSecret, 7), auth.jwtSecret)).toBe(42);
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "42" })).toString("base64url");
    expect(await readSession(`${header}.${body}.`, auth.jwtSecret)).toBeNull();
  });
});

// A clock the test moves by hand, so "15 minutes later" takes no time.
function fakeClock() {
  let time = Date.UTC(2026, 9, 19, 12);
  return { now: () => time, advance: (ms: number) => (time += ms) };
}
const MINUTE = 60_000;

describe("the login rate limit: 5 attempts per 15 minutes per IP + email", () => {
  // Caddy sets X-Forwarded-For to the visitor's address; supertest plays Caddy here.
  const attempt = (app: Parameters<typeof request>[0], ip: string, email = ANA.email) =>
    request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email, password: "wrong password" });

  it("blocks the 6th attempt with 429 and Retry-After, then lets one through after the window", async () => {
    const clock = fakeClock();
    const { app } = usersApp(clock.now);
    for (let i = 0; i < 5; i++) expect((await attempt(app, "203.0.113.7")).status).toBe(401);
    const blocked = await attempt(app, "203.0.113.7");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBe(15 * 60);

    clock.advance(15 * MINUTE + 1);
    expect((await attempt(app, "203.0.113.7")).status).toBe(401);
  });

  it("counts the visitor's address from X-Forwarded-For, not the proxy's", async () => {
    // If trust proxy were off, every request here would come from 127.0.0.1 (Caddy's
    // position) and the second visitor would be blocked by the first one's attempts.
    const { app } = usersApp();
    for (let i = 0; i < 5; i++) await attempt(app, "203.0.113.7");
    expect((await attempt(app, "203.0.113.7")).status).toBe(429);
    expect((await attempt(app, "198.51.100.20")).status).toBe(401);
  });

  it("can't be dodged by sending a fake X-Forwarded-For entry", async () => {
    // A visitor sends "X-Forwarded-For: <anything>"; a proxy that appends would forward
    // "<anything>, <real address>". Trusting one hop reads the rightmost entry only.
    const { app } = usersApp();
    for (let i = 0; i < 5; i++) await attempt(app, `10.0.0.${i}, 203.0.113.7`);
    expect((await attempt(app, "10.9.9.9, 203.0.113.7")).status).toBe(429);
  });

  it("counts each email separately, so one account's lockout doesn't block others", async () => {
    const { app } = usersApp();
    for (let i = 0; i < 5; i++) await attempt(app, "203.0.113.7");
    expect((await attempt(app, "203.0.113.7", "ANA@example.com ")).status).toBe(429); // same email, normalised
    expect((await attempt(app, "203.0.113.7", "bo@example.com")).status).toBe(401);
  });
});

describe("the signup rate limit: 5 per hour per IP", () => {
  const signup = (app: Parameters<typeof request>[0], ip: string, n: number) =>
    request(app).post("/api/auth/signup").set("X-Forwarded-For", ip).send({ ...ANA, email: `user${n}@example.com` });

  it("blocks the 6th signup from one address for an hour, but not other addresses", async () => {
    const clock = fakeClock();
    const { app, users } = usersApp(clock.now);
    for (let i = 0; i < 5; i++) expect((await signup(app, "203.0.113.7", i)).status).toBe(201);
    const blocked = await signup(app, "203.0.113.7", 5);
    expect(blocked.status).toBe(429);
    expect(users).toHaveLength(5); // never reached the database (or bcrypt)
    expect((await signup(app, "198.51.100.20", 6)).status).toBe(201);

    clock.advance(59 * MINUTE);
    expect((await signup(app, "203.0.113.7", 7)).status).toBe(429);
    clock.advance(2 * MINUTE);
    expect((await signup(app, "203.0.113.7", 8)).status).toBe(201);
  });

  it("counts malformed signups too, so a junk loop is stopped as well", async () => {
    const { app } = usersApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/signup").set("X-Forwarded-For", "203.0.113.7").send({});
    }
    expect((await signup(app, "203.0.113.7", 1)).status).toBe(429);
  });
});

describe("createLimiter", () => {
  it("slides: an attempt frees up exactly when the oldest one leaves the window", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ max: 2, windowMs: 10 * MINUTE }, clock.now);
    expect(limiter.hit("k")).toBe(0);
    clock.advance(4 * MINUTE);
    expect(limiter.hit("k")).toBe(0);
    expect(limiter.hit("k")).toBe(6 * 60); // the first attempt expires in 6 minutes
    clock.advance(6 * MINUTE + 1);
    expect(limiter.hit("k")).toBe(0);
    expect(limiter.hit("other")).toBe(0);
  });
});
