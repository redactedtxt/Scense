import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { cookieOptions, SESSION_COOKIE } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { byIp, byIpAndEmail, createLimiter, rateLimit } from "../middleware/rateLimit.js";
import { parseInput } from "../middleware/validate.js";
import {
  hashPassword,
  MAX_PASSWORD_BYTES,
  passwordBytes,
  readSession,
  signSession,
  verifyPassword,
} from "../services/auth.js";

const email = z.string().trim().max(254).pipe(z.email("enter a valid email address"));

const signupBody = z.object({
  email,
  displayName: z.string().trim().min(1, "enter a display name").max(40),
  password: z
    .string()
    .min(10, "use at least 10 characters")
    .refine((p) => passwordBytes(p) <= MAX_PASSWORD_BYTES, `use at most ${MAX_PASSWORD_BYTES} bytes`),
});

const loginBody = z.object({ email, password: z.string().min(1).max(200) });

type UserRow = { id: number; email: string; display_name: string };

function publicUser(row: UserRow) {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

// Unique violation on users.email: a second account with the same address.
const UNIQUE_VIOLATION = "23505";

// The limiters are created here, once per app, so each test's app starts with a clean count.
export function authRouter(db: Db, settings: AuthSettings, now: () => number = Date.now): Router {
  const router = Router();
  const signupLimit = rateLimit(createLimiter(settings.signupLimit, now), byIp);
  const loginLimit = rateLimit(createLimiter(settings.loginLimit, now), byIpAndEmail);

  async function startSession(res: Response, userId: number) {
    const token = await signSession(userId, settings.jwtSecret, settings.sessionDays);
    res.cookie(SESSION_COOKIE, token, cookieOptions(settings));
  }

  // The limiter runs before validation, so a loop of malformed signups is counted too.
  router.post("/auth/signup", signupLimit, async (req, res) => {
    const body = parseInput(signupBody, req.body);
    const hash = await hashPassword(body.password, settings.bcryptCost);
    let row: UserRow;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
         RETURNING id, email, display_name`,
        [body.email, body.displayName, hash],
      );
      row = rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.");
      }
      throw err;
    }
    await startSession(res, row.id);
    res.status(201).json({ user: publicUser(row) });
  });

  router.post("/auth/login", loginLimit, async (req, res) => {
    const body = parseInput(loginBody, req.body);
    const { rows } = await db.query(
      "SELECT id, email, display_name, password_hash FROM users WHERE email = $1",
      [body.email],
    );
    // One message for "no such email" and "wrong password", so the form doesn't
    // reveal which emails have accounts.
    if (!(await verifyPassword(body.password, rows[0]?.password_hash ?? null))) {
      throw new ApiError(401, "invalid_credentials", "That email and password don't match.");
    }
    await startSession(res, rows[0].id);
    res.json({ user: publicUser(rows[0]) });
  });

  // The token is not revoked, only removed from this browser (DECISIONS B31). The
  // options must match the ones it was set with, or the browser keeps the cookie;
  // Express 5's clearCookie drops maxAge itself and sends an expiry in 1970.
  router.post("/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions(settings));
    res.status(204).end();
  });

  router.get("/auth/me", async (req, res) => {
    const userId = await readSession(req.cookies?.[SESSION_COOKIE], settings.jwtSecret);
    const { rows } = userId === null
      ? { rows: [] }
      : await db.query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
    if (!rows[0]) throw new ApiError(401, "unauthenticated", "Not signed in.");
    res.json({ user: publicUser(rows[0]) });
  });

  return router;
}
