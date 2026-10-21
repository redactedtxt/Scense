import type { Request } from "express";
import { z } from "zod";

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
