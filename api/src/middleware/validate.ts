import { z } from "zod";
import { ApiError } from "./errors.js";

// Parse a body, query, or params object with a Zod schema. Returns the typed,
// coerced result, or throws a 400 that lists every problem at once.
// Express 5 makes req.query read-only, so routes keep the returned copy instead
// of writing it back onto the request.
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const where = issue.path.join(".");
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  throw new ApiError(400, "invalid_request", problems.join("; "));
}

// Postgres INTEGER's largest value. No row can have a larger id, and sending one makes
// Postgres fail the whole query ("out of range for type integer"), which was a 500
// (DECISIONS B43). Every id the API reads goes through one of these two schemas, so a
// too-large id is a 400 like any other bad input.
export const MAX_DB_ID = 2_147_483_647;
// An id in a JSON body (a number already).
export const dbId = z.number().int().positive().max(MAX_DB_ID);
// An id in a path or query string (text that should read as a number).
export const dbIdParam = z.coerce.number().int().positive().max(MAX_DB_ID);
