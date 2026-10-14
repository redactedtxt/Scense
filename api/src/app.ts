import express from "express";
import type { Db } from "./db.js";
import { errorHandler } from "./middleware/errors.js";
import { healthRouter } from "./routes/health.js";

// Built from its dependencies (not module globals) so tests can pass a fake db.
export function createApp(db: Db): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", healthRouter(db));
  app.use(errorHandler);
  return app;
}
