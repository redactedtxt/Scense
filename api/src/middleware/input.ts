import type { RequestHandler } from "express";
import { ApiError } from "./errors.js";

// Postgres text can't hold a NUL character (U+0000): a query that receives one fails with
// "invalid byte sequence", which used to surface as a 500 from a dozen routes (the brand
// filter, slugs, note names, display names, profile summaries, chat messages; DECISIONS
// B43). In a chat message it failed only after the model had answered, so the visitor
// lost a message and we paid for the tokens. No field anywhere has a use for it, so one
// check in front of every route refuses it with a 400 before anything else runs.
export const rejectNul: RequestHandler = (req, _res, next) => {
  if (pathHasNul(req.path) || hasNul(req.query) || hasNul(req.body)) {
    return next(new ApiError(400, "invalid_request", "Remove the NUL character (U+0000) from the request."));
  }
  next();
};

// The path is still percent-encoded here ("%00"), and route params are decoded later.
function pathHasNul(path: string): boolean {
  try {
    return decodeURIComponent(path).includes("\0");
  } catch {
    return false; // a malformed escape is the router's 400 to give, not ours
  }
}

// Strings, and the keys and values of arrays and objects, all the way down. The JSON body
// is at most 200 kB (app.ts), so walking it is cheap.
function hasNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(hasNul);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, inner]) => key.includes("\0") || hasNul(inner));
  }
  return false;
}
