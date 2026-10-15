import express from "express";
import type { Db } from "./db.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { familiesRouter } from "./routes/families.js";
import { fragrancesRouter } from "./routes/fragrances.js";
import { healthRouter } from "./routes/health.js";
import { notesRouter } from "./routes/notes.js";
import { pairingRouter } from "./routes/pairing.js";
import type { Matrices } from "./services/scoring.js";

// Built from its dependencies (not module globals) so tests can pass a fake db.
export function createApp(db: Db, matrices: Matrices): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", healthRouter(db));
  app.use("/api", familiesRouter(db));
  app.use("/api", fragrancesRouter(db));
  app.use("/api", notesRouter(db));
  app.use("/api", pairingRouter(db, matrices));
  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
