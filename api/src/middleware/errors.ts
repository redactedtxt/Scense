import type { ErrorRequestHandler, RequestHandler } from "express";

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

// Every error leaves the API in the same shape: { error: { code, message } }.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    send(res, err.status, err.code, err.message);
    return;
  }
  // express.json() throws this when the request body is not valid JSON.
  if (err?.type === "entity.parse.failed") {
    send(res, 400, "invalid_json", "Request body is not valid JSON.");
    return;
  }
  console.error(err);
  send(res, 500, "internal_error", "Something went wrong.");
};
