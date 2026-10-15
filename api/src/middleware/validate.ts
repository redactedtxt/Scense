import type { z } from "zod";
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
