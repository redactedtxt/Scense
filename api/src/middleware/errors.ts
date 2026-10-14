import type { ErrorRequestHandler } from "express";

// Every error leaves the API in the same shape: { error: { code, message } }.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong." } });
};
