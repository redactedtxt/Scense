import type { Request, RequestHandler } from "express";
import type { Limit } from "../config.js";
import { ApiError } from "./errors.js";

// A sliding-window limiter kept in memory: for each key, the times of its recent
// attempts. One API container serves the site, so memory is enough; with several
// containers the counts would have to move to a shared store such as Redis.
//
// `now` is injectable so tests can move the clock instead of waiting 15 minutes.
export function createLimiter(limit: Limit, now: () => number = Date.now) {
  const attempts = new Map<string, number[]>();

  // Keys whose attempts have all expired are dropped now and then, so a flood of
  // made-up emails cannot grow the map forever.
  function sweep(cutoff: number) {
    for (const [key, times] of attempts) {
      if (times[times.length - 1]! <= cutoff) attempts.delete(key);
    }
  }

  // Records one attempt. Returns 0 if it is allowed, or the seconds until the oldest
  // attempt in the window expires and a new one would be allowed.
  function hit(key: string): number {
    const time = now();
    const cutoff = time - limit.windowMs;
    if (attempts.size > 10_000) sweep(cutoff);
    const recent = (attempts.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= limit.max) {
      attempts.set(key, recent);
      return Math.ceil((recent[0]! - cutoff) / 1000);
    }
    recent.push(time);
    attempts.set(key, recent);
    return 0;
  }

  return { hit };
}

export type Limiter = ReturnType<typeof createLimiter>;

// Express middleware: one attempt per request, keyed by `keyOf`. Over the limit it
// answers 429 with a Retry-After header and never reaches the route.
export function rateLimit(limiter: Limiter, keyOf: (req: Request) => string): RequestHandler {
  return (req, res, next) => {
    const waitSeconds = limiter.hit(keyOf(req));
    if (waitSeconds === 0) return next();
    res.setHeader("Retry-After", String(waitSeconds));
    const minutes = Math.ceil(waitSeconds / 60);
    next(new ApiError(429, "rate_limited", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`));
  };
}

// req.ip is the visitor's address only because app.ts sets "trust proxy" to the number
// of proxies in front of us (Caddy, one hop). With it unset, every visitor would share
// Caddy's address and one person's typos would lock everyone out.
export const byIp = (req: Request) => req.ip ?? "unknown";

// Login counts per address AND email (SPEC section 7), so one visitor guessing at one
// account is stopped without locking that account for everyone else.
export function byIpAndEmail(req: Request): string {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return `${byIp(req)}|${email}`;
}
