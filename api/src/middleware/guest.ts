import type { Request, Response } from "express";
import { z } from "zod";
import { subjectOf } from "../services/caps.js";
import type { GuestIpLimit } from "../services/guestIps.js";
import { ApiError } from "./errors.js";

// The guest id the web client sends in X-Guest-Id on every request (SPEC section 6).
// The API uses it for one thing only: counting a guest's AI conversations. It proves
// nothing about who the visitor is, so it never unlocks any data.
const uuid = z.uuid();

export function guestIdOf(req: Request): string | null {
  const header = req.get("X-Guest-Id");
  if (!header) return null;
  // Lower case, so "ABC..." and "abc..." can't count as two guests.
  const parsed = uuid.safeParse(header.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

// 'user:<id>' for a signed-in visitor, 'guest:<uuid>' from X-Guest-Id otherwise: who owns
// a chat or an outing, and whose daily budget a message draws on. Needs optionalUser.
export function requireSubject(req: Request, res: Response): string {
  const subject = subjectOf(res.locals.userId as number | null, guestIdOf(req));
  if (subject === null) throw new ApiError(400, "missing_guest_id", "Reload the page and try again.");
  return subject;
}

// A guest's message to the chat or the concierge is refused once their network address
// has brought too many different guest ids today (services/guestIps.ts; DECISIONS B43).
// Signed-in users pass straight through: their budget is tied to the account.
export function admitGuest(req: Request, subject: string, limit: GuestIpLimit, day: string): void {
  if (!subject.startsWith("guest:")) return;
  if (limit.admit(req.ip ?? "unknown", subject, day)) return;
  throw new ApiError(
    429,
    "guest_ip_limit",
    "Too many guest visitors from your network today. Sign up (it's free) or come back tomorrow.",
  );
}
