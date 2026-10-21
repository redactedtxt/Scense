import type { CookieOptions, RequestHandler, Response } from "express";
import type { AuthSettings } from "../config.js";
import { readSession } from "../services/auth.js";
import { ApiError } from "./errors.js";

export const SESSION_COOKIE = "scense_session";

// httpOnly: page scripts can't read the token, so an XSS bug can't steal it.
// sameSite=lax: the browser leaves the cookie off cross-site POSTs, which blocks CSRF
// against our JSON endpoints. secure: HTTPS only (SPEC section 7).
export function cookieOptions(settings: AuthSettings): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: settings.sessionDays * 24 * 60 * 60 * 1000,
  };
}

// For routes that need an account. Puts the user id on res.locals or answers 401.
// It trusts the signed token alone; a deleted user's token fails later on the foreign
// keys or the /me lookup, which is fine for a demo (see DECISIONS B31 on logout).
export function requireUser(settings: AuthSettings): RequestHandler {
  return async (req, res, next) => {
    const userId = await readSession(req.cookies?.[SESSION_COOKIE], settings.jwtSecret);
    if (userId === null) return next(new ApiError(401, "unauthenticated", "Sign in first."));
    res.locals.userId = userId;
    next();
  };
}

// For public routes that show a little more to a signed-in visitor (which review is
// theirs). Never rejects: a missing or bad cookie just means "a guest".
export function optionalUser(settings: AuthSettings): RequestHandler {
  return async (req, res, next) => {
    res.locals.userId = await readSession(req.cookies?.[SESSION_COOKIE], settings.jwtSecret);
    next();
  };
}

export function userIdOf(res: Response): number {
  return res.locals.userId as number;
}
