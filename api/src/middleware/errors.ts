import type { ErrorRequestHandler, Request, RequestHandler } from "express";

// An error we raise on purpose, with the HTTP status and code the client should see.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function send(res: Parameters<RequestHandler>[1], status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

// Unknown /api paths get the same JSON error shape instead of Express's HTML page.
export const notFoundHandler: RequestHandler = (_req, res) => {
  send(res, 404, "not_found", "No such endpoint.");
};

// express.json() rejects a body with an error carrying a 4xx status and, usually, a
// `type`. These used to fall through to the 500 below (DECISIONS B43): a body over the
// size limit, a compressed body that doesn't decompress, an unknown Content-Encoding.
// The message is ours, never the library's, which can quote the request.
const BODY_ERRORS: Record<string, { code: string; message: string }> = {
  "entity.parse.failed": { code: "invalid_json", message: "Request body is not valid JSON." },
  "entity.too.large": { code: "payload_too_large", message: "The request body is too large." },
  "encoding.unsupported": { code: "unsupported_encoding", message: "That Content-Encoding is not supported." },
  "charset.unsupported": { code: "unsupported_charset", message: "Send the body as UTF-8." },
};

type HttpError = { status?: unknown; expose?: unknown; type?: unknown };

function clientError(err: unknown): { status: number; code: string; message: string } | null {
  const e = (err ?? {}) as HttpError;
  if (typeof e.status !== "number" || e.status < 400 || e.status > 499 || e.expose !== true) return null;
  const known = typeof e.type === "string" ? BODY_ERRORS[e.type] : undefined;
  return { status: e.status, ...(known ?? { code: "bad_request", message: "The request could not be read." }) };
}

// Every error leaves the API in the same shape: { error: { code, message } }.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    send(res, err.status, err.code, err.message);
    return;
  }
  const client = clientError(err);
  if (client) {
    send(res, client.status, client.code, client.message);
    return;
  }
  console.error(describeFailure(err, req));
  send(res, 500, "internal_error", "Something went wrong.");
};

// What a 500 logs: enough to find the bug, nothing a visitor typed (DECISIONS B43). A
// Postgres error's `message` and `detail` can quote values (an email in "Key (email)=",
// a whole row in "Failing row contains"), so for those only the SQLSTATE code and the
// routine are kept. The query string is left out too; the path holds only ids and slugs.
// The stack's first line repeats the message, so only the frames are logged.
export function describeFailure(err: unknown, req: Pick<Request, "method" | "baseUrl" | "path">): string {
  const e = (err ?? {}) as { name?: unknown; message?: unknown; code?: unknown; routine?: unknown; severity?: unknown; stack?: unknown };
  const isPostgres = typeof e.severity === "string" && typeof e.code === "string";
  const what = isPostgres
    ? `Postgres error ${String(e.code)} in ${String(e.routine ?? "?")}`
    : `${String(e.name ?? "Error")}: ${String(e.message ?? err)}`;
  const frames = typeof e.stack === "string" ? e.stack.split("\n").slice(1, 8).join("\n") : "";
  return `${req.method} ${req.baseUrl}${req.path} failed: ${what}${frames ? `\n${frames}` : ""}`;
}
